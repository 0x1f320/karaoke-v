import { execFile } from "node:child_process"
import { closeSync, createReadStream, fstatSync, openSync, writeSync } from "node:fs"
import { lstat, unlink } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { promisify } from "node:util"
import type { PipeChannel } from "../shared/bridgeRendezvous"

const execFileAsync = promisify(execFile)
const FIFO_REOPEN_DELAY_MS = 25
const FIFO_DRAIN_GRACE_MS = 300
const FIFO_READER_CLOSE_TIMEOUT_MS = 100

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

export interface PipeEndpointStat {
  dev: number
  ino: number
  isFIFO(): boolean
}

export interface PipeEndpointServerDependencies {
  files?: {
    lstat(path: string): Promise<PipeEndpointStat>
    unlink(path: string): Promise<void>
  }
  sleep?(delayMs: number): Promise<void>
}

const REAL_PIPE_FILES = { lstat, unlink }
const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })

export function createPipeEndpointServer(
  options: PipeEndpointServerOptions,
  dependencies: PipeEndpointServerDependencies = {},
): PipeEndpointServer {
  if (options.platform === "darwin") {
    return new DarwinPipeEndpointServer(
      options.path,
      dependencies.files ?? REAL_PIPE_FILES,
      dependencies.sleep ?? sleep,
    )
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
  private shutdownPromise: Promise<void> | null = null
  private stopped = false
  private shuttingDown = false
  private fatalReported = false
  private onData: (chunk: Uint8Array) => void = () => {}
  private onDisconnect: () => void = () => {}
  private onFatal: (error: Error) => void = () => {}

  constructor(
    private readonly path: string,
    private readonly files: NonNullable<PipeEndpointServerDependencies["files"]>,
    private readonly sleep: NonNullable<PipeEndpointServerDependencies["sleep"]>,
  ) {}

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
      await this.shutdownEndpoint()
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
    let existing: PipeEndpointStat | null = null
    try {
      existing = await this.files.lstat(this.path)
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    if (existing && !existing.isFIFO()) {
      throw new Error(`Refusing to replace non-FIFO pipe endpoint: ${this.path}`)
    }
    if (existing) {
      await this.files.unlink(this.path)
    }
    if (this.stopped) {
      throw new Error("Pipe endpoint stopped before startup")
    }

    await execFileAsync("/usr/bin/mkfifo", [this.path])
    const created = await this.files.lstat(this.path)
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
      if (this.stopped || this.shuttingDown) {
        reject(new Error("Pipe endpoint stopped before reader open"))
        return
      }

      const stream = createReadStream(this.path, { flags: "r" })
      this.stream = stream
      let opened = false
      let ended = false
      let failed = false

      stream.on("data", (chunk) => {
        if (this.stopped || this.shuttingDown) {
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
        if (!this.stopped && !this.shuttingDown) {
          this.ensureKeepalive()
          this.onDisconnect()
        }
      })
      stream.once("error", (error) => {
        failed = true
        if (opened) {
          if (!this.shuttingDown) {
            this.reportFatal(error)
          }
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
        if (this.stopped || this.shuttingDown || failed) {
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
    if (this.stopped || this.shuttingDown || this.fatalReported) {
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
    await this.shutdownEndpoint()
    try {
      await this.startPromise
    } catch {}
    await this.shutdownEndpoint()
  }

  private shutdownEndpoint(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise
    }
    const shutdown = this.shutdownEndpointInternal()
    this.shutdownPromise = shutdown
    void shutdown
      .finally(() => {
        if (this.shutdownPromise === shutdown) {
          this.shutdownPromise = null
        }
      })
      .catch(() => {})
    return shutdown
  }

  private async shutdownEndpointInternal(): Promise<void> {
    this.shuttingDown = true
    this.establishShutdownKeepalive()
    const readerNeedsShutdown = this.stream !== null && !this.stream.closed
    try {
      // Keep RDWR alive while withdrawing the name so late non-creating opens fail promptly.
      await this.withdrawOwnedFifo()
      if (readerNeedsShutdown) {
        await this.sleep(FIFO_DRAIN_GRACE_MS)
      }
    } finally {
      try {
        await this.closeStream()
      } finally {
        this.closeKeepalive()
        this.identity = null
      }
    }
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
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (): void => {
        stream.off("close", finish)
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        resolve()
      }
      stream.once("close", finish)
      timer = setTimeout(() => {
        stream.on("error", () => {})
        finish()
      }, FIFO_READER_CLOSE_TIMEOUT_MS)
      stream.destroy()
      // A byte is required to release a Darwin FIFO read already blocked in libuv.
      this.wakeReader()
    })
  }

  private ensureKeepalive(): void {
    if (this.keepaliveFd !== null || this.stopped || this.shuttingDown) {
      return
    }
    try {
      this.keepaliveFd = openSync(this.path, "r+")
    } catch (error) {
      this.reportFatal(asError(error))
    }
  }

  private wakeReader(): void {
    const fd = this.keepaliveFd
    if (fd === null) {
      return
    }
    try {
      writeSync(fd, Uint8Array.of(0))
    } catch {}
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

  private establishShutdownKeepalive(): void {
    if (this.keepaliveFd !== null || !this.stream || this.stream.closed) {
      return
    }
    const identity = this.identity
    if (!identity) {
      return
    }
    let fd: number | null = null
    try {
      fd = openSync(this.path, "r+")
      const opened = fstatSync(fd)
      if (opened.isFIFO() && opened.dev === identity.dev && opened.ino === identity.ino) {
        this.keepaliveFd = fd
        fd = null
      }
    } catch {
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {}
      }
    }
  }

  private async withdrawOwnedFifo(): Promise<void> {
    const identity = this.identity
    if (!identity) {
      return
    }
    try {
      // POSIX has no inode-conditional unlink; the final lstat/unlink pair relies on this
      // directory remaining app-owned and never unlinks after a known identity mismatch.
      const current = await this.files.lstat(this.path)
      if (current.isFIFO() && current.dev === identity.dev && current.ino === identity.ino) {
        await this.files.unlink(this.path)
      }
    } catch (error) {
      if (!isMissing(error)) throw error
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
