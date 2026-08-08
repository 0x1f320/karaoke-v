import { execFile } from "node:child_process"
import { closeSync, createReadStream, openSync, writeSync } from "node:fs"
import { lstat, unlink } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { promisify } from "node:util"
import type { PipeChannel } from "../shared/bridgeRendezvous"

const execFileAsync = promisify(execFile)
const FIFO_REOPEN_DELAY_MS = 25

export interface PipeEndpointServer {
  start(
    onData: (chunk: Uint8Array) => void,
    onDisconnect: () => void,
    onFatal: (error: Error) => void,
  ): Promise<void>
  stop(): Promise<void>
}

export interface PipeEndpointServerOptions {
  platform: NodeJS.Platform
  path: string
  channel: PipeChannel
}

export function createPipeEndpointServer(options: PipeEndpointServerOptions): PipeEndpointServer {
  if (options.platform === "darwin") {
    return new DarwinPipeEndpointServer(options.path)
  }
  if (options.platform === "win32") {
    return new WindowsPipeEndpointServer(options.path)
  }
  throw new Error(`Unsupported pipe platform: ${options.platform}`)
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT"
}

class DarwinPipeEndpointServer implements PipeEndpointServer {
  private stream: ReturnType<typeof createReadStream> | null = null
  private keepaliveFd: number | null = null
  private identity: { dev: number; ino: number } | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private stopped = false
  private fatalReported = false
  private onData: (chunk: Uint8Array) => void = () => {}
  private onDisconnect: () => void = () => {}
  private onFatal: (error: Error) => void = () => {}

  constructor(private readonly path: string) {}

  start(
    onData: (chunk: Uint8Array) => void,
    onDisconnect: () => void,
    onFatal: (error: Error) => void,
  ): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }
    this.onData = onData
    this.onDisconnect = onDisconnect
    this.onFatal = onFatal
    this.startPromise = this.startInternal().catch(async (error: unknown) => {
      await this.closeStream()
      this.closeKeepalive()
      await this.removeOwnedFifo()
      throw asError(error)
    })
    return this.startPromise
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.stopInternal()
    }
    return this.stopPromise
  }

  private async startInternal(): Promise<void> {
    let existing: Awaited<ReturnType<typeof lstat>> | null = null
    try {
      existing = await lstat(this.path)
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    if (existing && !existing.isFIFO()) {
      throw new Error(`Refusing to replace non-FIFO pipe endpoint: ${this.path}`)
    }
    if (existing) {
      await unlink(this.path)
    }
    if (this.stopped) {
      throw new Error("Pipe endpoint stopped before startup")
    }

    await execFileAsync("/usr/bin/mkfifo", [this.path])
    const created = await lstat(this.path)
    if (!created.isFIFO()) {
      throw new Error(`mkfifo did not create a FIFO: ${this.path}`)
    }
    this.identity = { dev: created.dev, ino: created.ino }
    if (this.stopped) {
      throw new Error("Pipe endpoint stopped before startup")
    }

    // RDWR bootstraps both sides so SynthV's first write-only open cannot block.
    this.keepaliveFd = openSync(this.path, "r+")
    await this.openReader()
  }

  private openReader(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(new Error("Pipe endpoint stopped before reader open"))
        return
      }

      const stream = createReadStream(this.path, { flags: "r" })
      this.stream = stream
      let opened = false
      let ended = false
      let failed = false

      stream.on("data", (chunk) => {
        if (this.stopped) {
          return
        }
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
        try {
          this.onData(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
          this.closeKeepalive()
        } catch (error) {
          this.reportFatal(asError(error))
        }
      })
      stream.once("open", () => {
        opened = true
        resolve()
      })
      stream.once("end", () => {
        ended = true
        if (!this.stopped) {
          this.ensureKeepalive()
          this.onDisconnect()
        }
      })
      stream.once("error", (error) => {
        failed = true
        if (opened) {
          this.reportFatal(error)
        } else {
          reject(error)
        }
      })
      stream.once("close", () => {
        if (this.stream === stream) {
          this.stream = null
        }
        if (!opened && !failed) {
          reject(new Error("FIFO reader closed before readiness"))
          return
        }
        if (this.stopped || failed) {
          return
        }
        if (!ended) {
          this.reportFatal(new Error(`FIFO reader closed unexpectedly: ${this.path}`))
          return
        }
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          void this.openReader().catch((error: unknown) => this.reportFatal(asError(error)))
        }, FIFO_REOPEN_DELAY_MS)
      })
    })
  }

  private reportFatal(error: Error): void {
    if (this.stopped || this.fatalReported) {
      return
    }
    this.fatalReported = true
    this.onFatal(error)
  }

  private async stopInternal(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    await this.closeStream()
    try {
      await this.startPromise
    } catch {}
    await this.closeStream()
    this.closeKeepalive()
    await this.removeOwnedFifo()
  }

  private async closeStream(): Promise<void> {
    const stream = this.stream
    if (!stream) {
      return
    }
    this.stream = null
    if (stream.closed) {
      return
    }
    await new Promise<void>((resolve) => {
      stream.once("close", resolve)
      stream.destroy()
      // A byte is required to release a Darwin FIFO read already blocked in libuv.
      this.wakeReader()
    })
  }

  private ensureKeepalive(): void {
    if (this.keepaliveFd !== null || this.stopped) {
      return
    }
    try {
      this.keepaliveFd = openSync(this.path, "r+")
    } catch (error) {
      this.reportFatal(asError(error))
    }
  }

  private wakeReader(): void {
    let temporaryFd: number | null = null
    try {
      let fd = this.keepaliveFd
      if (fd === null) {
        temporaryFd = openSync(this.path, "r+")
        fd = temporaryFd
      }
      writeSync(fd, Uint8Array.of(0))
    } catch {
    } finally {
      if (temporaryFd !== null) {
        try {
          closeSync(temporaryFd)
        } catch {}
      }
    }
  }

  private closeKeepalive(): void {
    if (this.keepaliveFd === null) {
      return
    }
    try {
      closeSync(this.keepaliveFd)
    } catch {}
    this.keepaliveFd = null
  }

  private async removeOwnedFifo(): Promise<void> {
    const identity = this.identity
    if (!identity) {
      return
    }
    try {
      const current = await lstat(this.path)
      if (current.isFIFO() && current.dev === identity.dev && current.ino === identity.ino) {
        await unlink(this.path)
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    } finally {
      this.identity = null
    }
  }
}

class WindowsPipeEndpointServer implements PipeEndpointServer {
  private server: Server | null = null
  private activeSocket: Socket | null = null
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private stopped = false
  private fatalReported = false
  private onData: (chunk: Uint8Array) => void = () => {}
  private onDisconnect: () => void = () => {}
  private onFatal: (error: Error) => void = () => {}

  constructor(private readonly path: string) {}

  start(
    onData: (chunk: Uint8Array) => void,
    onDisconnect: () => void,
    onFatal: (error: Error) => void,
  ): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }
    this.onData = onData
    this.onDisconnect = onDisconnect
    this.onFatal = onFatal
    this.startPromise = this.startInternal()
    return this.startPromise
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.stopInternal()
    }
    return this.stopPromise
  }

  private startInternal(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(new Error("Pipe endpoint stopped before startup"))
        return
      }

      const server = createServer((socket) => this.accept(socket))
      this.server = server
      let settled = false
      server.on("error", (error) => {
        if (!settled) {
          settled = true
          reject(error)
        } else {
          this.reportFatal(error)
        }
      })
      server.listen(this.path, () => {
        if (settled) {
          return
        }
        if (this.stopped) {
          settled = true
          void this.closeServer(server).finally(() => {
            reject(new Error("Pipe endpoint stopped before startup"))
          })
          return
        }
        settled = true
        resolve()
      })
    })
  }

  private accept(socket: Socket): void {
    if (this.stopped || (this.activeSocket && !this.activeSocket.destroyed)) {
      socket.on("error", () => {})
      socket.destroy()
      return
    }

    this.activeSocket = socket
    let failed = false
    socket.on("data", (chunk) => {
      try {
        this.onData(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      } catch (error) {
        this.reportFatal(asError(error))
      }
    })
    socket.on("error", (error) => {
      failed = true
      this.reportFatal(error)
    })
    socket.on("close", () => {
      if (this.activeSocket === socket) {
        this.activeSocket = null
      }
      if (!this.stopped && !failed) {
        this.onDisconnect()
      }
    })
  }

  private reportFatal(error: Error): void {
    if (this.stopped || this.fatalReported) {
      return
    }
    this.fatalReported = true
    this.onFatal(error)
  }

  private async stopInternal(): Promise<void> {
    this.stopped = true
    this.activeSocket?.destroy()
    this.activeSocket = null

    try {
      await this.startPromise
    } catch {}

    const server = this.server
    this.server = null
    if (server) {
      await this.closeServer(server)
    }
  }

  private closeServer(server: Server): Promise<void> {
    return new Promise((resolve) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close(() => resolve())
    })
  }
}
