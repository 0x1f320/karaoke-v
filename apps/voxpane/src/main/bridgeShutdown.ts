import { lstatSync, readFileSync, unlinkSync } from "node:fs"
import { rendezvousPath } from "../shared/bridgePath"
import { decodeRendezvousRecord, PIPE_CHANNELS, pipeEndpoint } from "../shared/bridgeRendezvous"

interface QuitEvent {
  preventDefault(): void
}

interface BridgeQuitDependencies {
  requestReceiverStop(): Promise<boolean>
  withdrawAdvertisement(): void
  resumeQuit(): void
  cleanup(): void
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
        this.dependencies.withdrawAdvertisement()
      } catch {}
    }
    this.resuming = true
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
