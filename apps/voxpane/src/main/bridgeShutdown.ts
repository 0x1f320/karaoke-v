import { lstatSync, readFileSync, unlinkSync } from "node:fs"
import { rendezvousPath } from "../shared/bridgePath"
import { decodeRendezvousRecord, PIPE_CHANNELS, pipeEndpoint } from "../shared/bridgeRendezvous"

interface QuitEvent {
  preventDefault(): void
}

interface BridgeQuitDependencies {
  requestReceiverStop(): Promise<boolean>
  quiesceReceiverOwner(): Promise<void>
  withdrawAdvertisement(): void
  resumeQuit(): void
  cleanup(): void
  timeoutMs: number
  quiesceTimeoutMs: number
}

export class BridgeQuitCoordinator {
  private waiting = false
  private resuming = false
  private cleaned = false

  constructor(private readonly dependencies: BridgeQuitDependencies) {}

  beforeQuit(event: QuitEvent): void {
    if (this.resuming) {
      if (!this.cleaned) {
        this.cleaned = true
        this.dependencies.cleanup()
      }
      return
    }

    event.preventDefault()
    if (this.waiting) {
      return
    }
    this.waiting = true
    void this.finishShutdown()
  }

  private async finishShutdown(): Promise<void> {
    const receiverStopped = await this.waitForReceiver()
    if (!receiverStopped) {
      await this.waitForOwnerQuiescence()
      this.resuming = true
      try {
        this.dependencies.withdrawAdvertisement()
      } catch {}
    } else {
      this.resuming = true
    }
    this.dependencies.resumeQuit()
  }

  private async waitForReceiver(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        Promise.resolve()
          .then(() => this.dependencies.requestReceiverStop())
          .catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), this.dependencies.timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async waitForOwnerQuiescence(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        Promise.resolve()
          .then(() => this.dependencies.quiesceReceiverOwner())
          .catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.dependencies.quiesceTimeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

export interface BridgeStopIpc {
  on(channel: string, listener: (event: { sender: unknown }, stopped: unknown) => void): void
  off(channel: string, listener: (event: { sender: unknown }, stopped: unknown) => void): void
}

export interface BridgeStopSender {
  send(channel: string): void
  isDestroyed(): boolean
  once(event: "destroyed", listener: () => void): void
  off(event: "destroyed", listener: () => void): void
}

export function requestBridgeReceiverStop(
  ipc: BridgeStopIpc,
  sender: BridgeStopSender,
  requestChannel: string,
  completeChannel: string,
  timeoutMs: number,
): Promise<boolean> {
  if (sender.isDestroyed()) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (stopped: boolean): void => {
      if (settled) return
      settled = true
      ipc.off(completeChannel, complete)
      sender.off("destroyed", destroyed)
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      resolve(stopped)
    }
    const complete = (event: { sender: unknown }, stopped: unknown): void => {
      if (event.sender === sender) {
        finish(stopped === true)
      }
    }
    const destroyed = (): void => finish(false)

    ipc.on(completeChannel, complete)
    sender.once("destroyed", destroyed)
    timer = setTimeout(() => finish(false), timeoutMs)
    try {
      sender.send(requestChannel)
    } catch {
      finish(false)
    }
  })
}

interface BridgeReceiverOwnerContents {
  isDestroyed(): boolean
  once(event: "destroyed", listener: () => void): void
  off(event: "destroyed", listener: () => void): void
}

export interface BridgeReceiverOwner {
  readonly webContents: BridgeReceiverOwnerContents
  isDestroyed(): boolean
  once(event: "closed", listener: () => void): void
  off(event: "closed", listener: () => void): void
  destroy(): void
}

export function destroyBridgeReceiverOwner(owner: BridgeReceiverOwner): Promise<void> {
  if (owner.isDestroyed()) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const contents = owner.webContents
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      owner.off("closed", closed)
      contents.off("destroyed", destroyed)
      if (error) reject(error)
      else resolve()
    }
    const closed = (): void => finish()
    const destroyed = (): void => finish()
    owner.once("closed", closed)
    contents.once("destroyed", destroyed)
    try {
      owner.destroy()
      if (owner.isDestroyed() || contents.isDestroyed()) {
        finish()
      }
    } catch (error) {
      finish(error)
    }
  })
}

export interface BridgeShutdownStat {
  dev: number
  ino: number
  isFile(): boolean
  isFIFO(): boolean
  isSymbolicLink(): boolean
}

export interface BridgeShutdownFiles {
  read(path: string): Uint8Array
  lstat(path: string): BridgeShutdownStat
  unlink(path: string): void
}

const REAL_FILES: BridgeShutdownFiles = {
  read: (path) => readFileSync(path),
  lstat: (path) => lstatSync(path),
  unlink: (path) => unlinkSync(path),
}

export function withdrawAdvertisedBridge(
  directory: string,
  platform: NodeJS.Platform,
  files: BridgeShutdownFiles = REAL_FILES,
): boolean {
  const advertisement = rendezvousPath(directory)
  let first: BridgeShutdownStat
  let bytes: Uint8Array
  try {
    first = files.lstat(advertisement)
    if (!first.isFile() || first.isSymbolicLink()) {
      return false
    }
    bytes = files.read(advertisement)
  } catch {
    return false
  }

  const record = decodeRendezvousRecord(bytes)
  if (!record) {
    return false
  }

  try {
    const current = files.lstat(advertisement)
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== first.dev ||
      current.ino !== first.ino
    ) {
      return false
    }
    files.unlink(advertisement)
  } catch {
    return false
  }

  if (platform === "darwin") {
    for (const channel of PIPE_CHANNELS) {
      const path = pipeEndpoint(platform, directory, record.session, channel)
      try {
        const endpoint = files.lstat(path)
        if (endpoint.isFIFO() && !endpoint.isSymbolicLink()) {
          files.unlink(path)
        }
      } catch {}
    }
  }
  return true
}
