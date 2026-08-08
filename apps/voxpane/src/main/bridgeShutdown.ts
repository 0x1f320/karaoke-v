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
  reportQuiesceFailure(error: unknown): void
  timeoutMs: number
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
      try {
        await this.dependencies.quiesceReceiverOwner()
      } catch (error) {
        try {
          this.dependencies.reportQuiesceFailure(error)
        } catch {}
        return
      }
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
  once(event: "render-process-gone", listener: () => void): void
  off(event: "destroyed", listener: () => void): void
  off(event: "render-process-gone", listener: () => void): void
  forcefullyCrashRenderer(): void
}

export interface BridgeReceiverOwner {
  readonly webContents: BridgeReceiverOwnerContents
  isDestroyed(): boolean
  once(event: "closed", listener: () => void): void
  off(event: "closed", listener: () => void): void
  destroy(): void
}

export interface BridgeReceiverDestroyBounds {
  normalTimeoutMs: number
  forceTimeoutMs: number
}

const DEFAULT_DESTROY_BOUNDS: BridgeReceiverDestroyBounds = {
  normalTimeoutMs: 250,
  forceTimeoutMs: 250,
}

interface DestructionConfirmation {
  promise: Promise<boolean>
  cancel(): void
}

function isOwnerDestroyed(
  owner: BridgeReceiverOwner,
  contents: BridgeReceiverOwnerContents,
): boolean {
  return owner.isDestroyed() || contents.isDestroyed()
}

function waitForDestruction(
  owner: BridgeReceiverOwner,
  contents: BridgeReceiverOwnerContents,
  timeoutMs: number,
  includeRendererGone: boolean,
): DestructionConfirmation {
  let timer: ReturnType<typeof setTimeout> | null = null
  let finish!: (confirmed: boolean) => void
  const promise = new Promise<boolean>((resolve) => {
    let settled = false
    const cleanup = (): void => {
      owner.off("closed", closed)
      contents.off("destroyed", destroyed)
      if (includeRendererGone) {
        contents.off("render-process-gone", rendererGone)
      }
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    finish = (confirmed) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(confirmed)
    }
    const closed = (): void => finish(true)
    const destroyed = (): void => finish(true)
    const rendererGone = (): void => finish(true)

    owner.once("closed", closed)
    contents.once("destroyed", destroyed)
    if (includeRendererGone) {
      contents.once("render-process-gone", rendererGone)
    }
    timer = setTimeout(() => finish(isOwnerDestroyed(owner, contents)), timeoutMs)
    if (isOwnerDestroyed(owner, contents)) {
      finish(true)
    }
  })
  return { promise, cancel: () => finish(false) }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function destroyBridgeReceiverOwner(
  owner: BridgeReceiverOwner,
  bounds: BridgeReceiverDestroyBounds = DEFAULT_DESTROY_BOUNDS,
): Promise<void> {
  const contents = owner.webContents
  if (isOwnerDestroyed(owner, contents)) {
    return
  }

  const normal = waitForDestruction(owner, contents, bounds.normalTimeoutMs, false)
  let normalError: unknown = null
  try {
    owner.destroy()
  } catch (error) {
    normalError = error
    normal.cancel()
  }
  if (!normalError && (await normal.promise)) {
    return
  }

  const forced = waitForDestruction(owner, contents, bounds.forceTimeoutMs, true)
  let forceError: unknown = null
  let retryError: unknown = null
  try {
    contents.forcefullyCrashRenderer()
  } catch (error) {
    forceError = error
  }
  try {
    owner.destroy()
  } catch (error) {
    retryError = error
  }
  if (await forced.promise) {
    return
  }

  const errors = [normalError, forceError, retryError]
    .filter((error) => error !== null)
    .map(errorText)
  const detail = errors.length > 0 ? `: ${errors.join("; ")}` : ""
  throw new Error(`bridge receiver owner destruction was not confirmed${detail}`)
}

export function quiesceBridgeReceiverOwner(
  owner: BridgeReceiverOwner | null,
  unfollow: () => void,
  reportNativeFailure: (error: unknown) => void,
  bounds: BridgeReceiverDestroyBounds = DEFAULT_DESTROY_BOUNDS,
): Promise<void> {
  let quiescing = Promise.resolve()
  try {
    unfollow()
  } catch (error) {
    try {
      reportNativeFailure(error)
    } catch {}
  } finally {
    quiescing = owner ? destroyBridgeReceiverOwner(owner, bounds) : Promise.resolve()
  }
  return quiescing
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
