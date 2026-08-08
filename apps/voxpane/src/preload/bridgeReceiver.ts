import { randomBytes } from "node:crypto"
import { open, readdir, readFile, lstat as realLstat, unlink } from "node:fs/promises"
import { join } from "node:path"
import {
  BRIDGE_CHANNEL_NOTES,
  BRIDGE_CHANNEL_SCROLL,
  BRIDGE_CHANNEL_SESSION,
  BRIDGE_CHANNEL_STATE,
} from "../shared/bridgeChannels"
import type {
  BridgeReceiptDiagnostics,
  BridgeTransportDiagnostics,
} from "../shared/bridgeDiagnostics"
import { bridgeDirectory, rendezvousPath } from "../shared/bridgePath"
import {
  decodeRendezvous,
  decodeRendezvousRecord,
  encodeRendezvous,
  PIPE_CHANNELS,
  type PipeChannel,
  pipeEndpoint,
} from "../shared/bridgeRendezvous"
import { BridgeFrameParser, type BridgeFramePolicy } from "./bridgeFrameParser"
import {
  createPipeEndpointServer,
  type PipeEndpointServer,
  type PipeEndpointServerOptions,
} from "./bridgePipeServer"

const HEARTBEAT_INTERVAL_MS = 500
const RECOVERY_DELAY_MS = 250
const LEGACY_CHANNELS = ["session.json", "state", "scroll", "notes"] as const
const STALE_FIFO = /^pipe-[0-9a-f]{32}-(?:state|scroll|notes)$/

const FRAME_POLICIES: Readonly<Record<PipeChannel, BridgeFramePolicy>> = {
  state: {
    allowedChannels: [BRIDGE_CHANNEL_SESSION, BRIDGE_CHANNEL_STATE],
    maximumPayloadBytes: {
      [BRIDGE_CHANNEL_SESSION]: 4 * 1024,
      [BRIDGE_CHANNEL_STATE]: 1024,
    },
  },
  scroll: {
    allowedChannels: [BRIDGE_CHANNEL_SCROLL],
    maximumPayloadBytes: { [BRIDGE_CHANNEL_SCROLL]: 1024 },
  },
  notes: {
    allowedChannels: [BRIDGE_CHANNEL_NOTES],
    maximumPayloadBytes: { [BRIDGE_CHANNEL_NOTES]: 64 * 1024 * 1024 },
  },
}

export interface BridgeReceiverStat {
  isFIFO(): boolean
  isFile(): boolean
}

export interface BridgeReceiverFileSystem {
  list(directory: string): Promise<string[]>
  lstat(path: string): Promise<BridgeReceiverStat>
  unlink(path: string): Promise<void>
  read(path: string): Promise<Uint8Array | null>
  writeRendezvous(path: string, bytes: Uint8Array, create: boolean): Promise<void>
}

export interface BridgeReceiverTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface BridgeFrameMessage {
  type: "session" | "state" | "scroll" | "schedule"
  bytes: ArrayBuffer
  diagnostics: BridgeReceiptDiagnostics | null
}

export type BridgeTransportMessage = { type: "transport" } & BridgeTransportDiagnostics
export type BridgeReceiverMessage = BridgeFrameMessage | BridgeTransportMessage

export interface BridgeReceiverDependencies {
  directory?: string
  platform?: NodeJS.Platform
  files?: BridgeReceiverFileSystem
  timers?: BridgeReceiverTimers
  nowMs?: () => number
  createSession?: () => string
  endpointFactory?: (options: PipeEndpointServerOptions) => PipeEndpointServer
  publish(message: BridgeReceiverMessage, transfer: ArrayBuffer[]): void
}

interface SessionResources {
  session: string
  endpoints: Readonly<Record<PipeChannel, PipeEndpointServer>>
  parsers: Readonly<Record<PipeChannel, BridgeFrameParser>>
  teardownPromise: Promise<void> | null
}

const REAL_FILES: BridgeReceiverFileSystem = {
  list: (directory) => readdir(directory),
  lstat: (path) => realLstat(path),
  unlink,
  read: async (path) => {
    try {
      return await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw error
    }
  },
  writeRendezvous: async (path, bytes, create) => {
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(path, create ? "w" : "r+")
    } catch (error) {
      if (create || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
      handle = await open(path, "w")
    }
    try {
      const result = await handle.write(bytes, 0, bytes.length, 0)
      if (result.bytesWritten !== bytes.length) {
        throw new Error(`Short rendezvous write: ${result.bytesWritten}/${bytes.length}`)
      }
      await handle.truncate(bytes.length)
    } finally {
      await handle.close()
    }
  },
}

const REAL_TIMERS: BridgeReceiverTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class BridgeReceiver {
  private readonly directory: string
  private readonly platform: NodeJS.Platform
  private readonly files: BridgeReceiverFileSystem
  private readonly timers: BridgeReceiverTimers
  private readonly nowMs: () => number
  private readonly createSession: () => string
  private readonly endpointFactory: (options: PipeEndpointServerOptions) => PipeEndpointServer
  private readonly publishMessage: (message: BridgeReceiverMessage, transfer: ArrayBuffer[]) => void
  private readonly transport: Omit<BridgeTransportDiagnostics, "status" | "session"> = {
    recoveries: 0,
    malformedFrames: 0,
    endpointFailures: 0,
    disconnects: { state: 0, scroll: 0, notes: 0 },
  }
  private current: SessionResources | null = null
  private heartbeatTimer: unknown = null
  private recoveryTimer: unknown = null
  private recoveryDelayResolve: (() => void) | null = null
  private recoveryRequested = false
  private recoveryPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private started = false
  private stopped = false
  private diagnosticsEnabled = false

  constructor(dependencies: BridgeReceiverDependencies) {
    this.directory = dependencies.directory ?? bridgeDirectory()
    this.platform = dependencies.platform ?? process.platform
    this.files = dependencies.files ?? REAL_FILES
    this.timers = dependencies.timers ?? REAL_TIMERS
    this.nowMs = dependencies.nowMs ?? Date.now
    this.createSession = dependencies.createSession ?? (() => randomBytes(16).toString("hex"))
    this.endpointFactory = dependencies.endpointFactory ?? createPipeEndpointServer
    this.publishMessage = dependencies.publish
  }

  start(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise
    }
    if (this.stopped) {
      return Promise.reject(new Error("Bridge receiver has been stopped"))
    }
    this.started = true
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    void this.startSession()
    return this.readyPromise
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.stopInternal()
    }
    return this.stopPromise
  }

  setDiagnosticsEnabled(enabled: boolean): void {
    this.diagnosticsEnabled = enabled
  }

  private async startSession(): Promise<void> {
    if (this.stopped) {
      return
    }

    const session = this.createSession()
    this.publishTransport("starting", session)
    await this.pruneStaleFifos()
    if (this.stopped) {
      return
    }

    const parsers = Object.fromEntries(
      PIPE_CHANNELS.map((channel) => [channel, new BridgeFrameParser(FRAME_POLICIES[channel])]),
    ) as unknown as Record<PipeChannel, BridgeFrameParser>
    const endpoints = Object.fromEntries(
      PIPE_CHANNELS.map((channel) => [
        channel,
        this.endpointFactory({
          platform: this.platform,
          path: pipeEndpoint(this.platform, this.directory, session, channel),
          channel,
        }),
      ]),
    ) as unknown as Record<PipeChannel, PipeEndpointServer>
    const resources: SessionResources = {
      session,
      endpoints,
      parsers,
      teardownPromise: null,
    }
    this.current = resources

    const results = await Promise.allSettled(
      PIPE_CHANNELS.map((channel) =>
        endpoints[channel].start(
          (chunk) => this.receive(resources, channel, chunk),
          () => this.disconnected(resources, channel),
          () => this.endpointFailed(resources),
        ),
      ),
    )
    if (this.stopped || this.current !== resources || this.recoveryRequested) {
      return
    }

    const failures = results.filter((result) => result.status === "rejected").length
    if (failures > 0) {
      this.transport.endpointFailures += failures
      this.requestRecovery(resources)
      return
    }

    try {
      await this.writeHeartbeat(resources, true)
    } catch {
      this.transport.endpointFailures += 1
      this.requestRecovery(resources)
      return
    }
    if (this.stopped || this.current !== resources || this.recoveryRequested) {
      return
    }

    await this.cleanupLegacyFiles()
    if (this.stopped || this.current !== resources || this.recoveryRequested) {
      return
    }
    this.publishTransport("ready", session)
    this.scheduleHeartbeat(resources)
    this.resolveReady?.()
    this.resolveReady = null
  }

  private receive(resources: SessionResources, channel: PipeChannel, chunk: Uint8Array): void {
    if (this.stopped || this.current !== resources || this.recoveryRequested) {
      return
    }
    const frames = resources.parsers[channel].push(chunk)
    if (frames === null) {
      this.transport.malformedFrames += 1
      this.requestRecovery(resources)
      return
    }
    for (const frame of frames) {
      const copy = Uint8Array.from(frame)
      const bytes = copy.buffer
      const message: BridgeFrameMessage = {
        type: this.messageType(frame),
        bytes,
        diagnostics: this.diagnosticsEnabled
          ? { receivedAtMs: this.nowMs(), sizeBytes: copy.byteLength }
          : null,
      }
      this.publishMessage(message, [bytes])
    }
  }

  private messageType(frame: Uint8Array): BridgeFrameMessage["type"] {
    const channel = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(
      6,
      true,
    )
    if (channel === BRIDGE_CHANNEL_SESSION) return "session"
    if (channel === BRIDGE_CHANNEL_STATE) return "state"
    if (channel === BRIDGE_CHANNEL_SCROLL) return "scroll"
    return "schedule"
  }

  private disconnected(resources: SessionResources, channel: PipeChannel): void {
    if (this.stopped || this.current !== resources || this.recoveryRequested) {
      return
    }
    resources.parsers[channel].reset()
    this.transport.disconnects[channel] += 1
    this.publishTransport("ready", resources.session)
  }

  private endpointFailed(resources: SessionResources): void {
    if (this.stopped || this.current !== resources || this.recoveryRequested) {
      return
    }
    this.transport.endpointFailures += 1
    this.requestRecovery(resources)
  }

  private requestRecovery(resources: SessionResources): void {
    if (
      this.stopped ||
      this.current !== resources ||
      this.recoveryRequested ||
      this.recoveryPromise
    ) {
      return
    }
    this.recoveryRequested = true
    this.publishTransport("error", resources.session)
    this.recoveryPromise = this.recover(resources)
  }

  private async recover(resources: SessionResources): Promise<void> {
    await this.teardown(resources)
    if (this.current === resources) {
      this.current = null
    }
    this.transport.recoveries += 1
    await this.waitForRecoveryDelay()
    this.recoveryRequested = false
    this.recoveryPromise = null
    if (!this.stopped) {
      void this.startSession()
    }
  }

  private scheduleHeartbeat(resources: SessionResources): void {
    this.clearHeartbeat()
    this.heartbeatTimer = this.timers.setTimeout(() => {
      this.heartbeatTimer = null
      void this.refreshHeartbeat(resources)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private async refreshHeartbeat(resources: SessionResources): Promise<void> {
    if (this.stopped || this.current !== resources || this.recoveryRequested) {
      return
    }
    try {
      await this.writeHeartbeat(resources, false)
    } catch {
      this.transport.endpointFailures += 1
      this.requestRecovery(resources)
      return
    }
    if (!this.stopped && this.current === resources && !this.recoveryRequested) {
      this.scheduleHeartbeat(resources)
    }
  }

  private writeHeartbeat(resources: SessionResources, create: boolean): Promise<void> {
    const bytes = encodeRendezvous({
      heartbeatSeconds: Math.floor(this.nowMs() / 1_000),
      session: resources.session,
    })
    return this.files.writeRendezvous(rendezvousPath(this.directory), bytes, create)
  }

  private waitForRecoveryDelay(): Promise<void> {
    return new Promise((resolve) => {
      this.recoveryDelayResolve = resolve
      this.recoveryTimer = this.timers.setTimeout(() => {
        this.recoveryTimer = null
        this.recoveryDelayResolve = null
        resolve()
      }, RECOVERY_DELAY_MS)
    })
  }

  private async stopInternal(): Promise<void> {
    this.stopped = true
    this.clearHeartbeat()
    this.cancelRecoveryDelay()
    const resources = this.current
    this.current = null
    if (resources) {
      await this.teardown(resources)
    }
    try {
      await this.recoveryPromise
    } catch {}
    this.resolveReady?.()
    this.resolveReady = null
    if (this.started) {
      this.publishTransport("stopped", null)
    }
  }

  private teardown(resources: SessionResources): Promise<void> {
    if (!resources.teardownPromise) {
      resources.teardownPromise = (async () => {
        this.clearHeartbeat()
        await Promise.allSettled(
          PIPE_CHANNELS.map((channel) => resources.endpoints[channel].stop()),
        )
        await this.removeOwnedRendezvous(resources.session)
      })()
    }
    return resources.teardownPromise
  }

  private async removeOwnedRendezvous(session: string): Promise<void> {
    const path = rendezvousPath(this.directory)
    try {
      const bytes = await this.files.read(path)
      if (bytes && decodeRendezvousRecord(bytes)?.session === session) {
        await this.files.unlink(path)
      }
    } catch {}
  }

  private async pruneStaleFifos(): Promise<void> {
    if (this.platform !== "darwin") {
      return
    }
    let names: string[]
    let liveSession: string | null = null
    try {
      names = await this.files.list(this.directory)
      const record = await this.files.read(rendezvousPath(this.directory))
      liveSession = record
        ? (decodeRendezvous(record, Math.floor(this.nowMs() / 1_000))?.session ?? null)
        : null
    } catch {
      return
    }
    await Promise.all(
      names.map(async (name) => {
        if (!STALE_FIFO.test(name)) {
          return
        }
        if (liveSession && name.startsWith(`pipe-${liveSession}-`)) {
          return
        }
        const path = join(this.directory, name)
        try {
          if ((await this.files.lstat(path)).isFIFO()) {
            await this.files.unlink(path)
          }
        } catch {}
      }),
    )
  }

  private async cleanupLegacyFiles(): Promise<void> {
    await Promise.all(
      LEGACY_CHANNELS.map(async (name) => {
        const path = join(this.directory, name)
        try {
          if ((await this.files.lstat(path)).isFile()) {
            await this.files.unlink(path)
          }
        } catch {}
      }),
    )
  }

  private publishTransport(
    status: BridgeTransportDiagnostics["status"],
    session: string | null,
  ): void {
    this.publishMessage(
      {
        type: "transport",
        status,
        session,
        recoveries: this.transport.recoveries,
        malformedFrames: this.transport.malformedFrames,
        endpointFailures: this.transport.endpointFailures,
        disconnects: { ...this.transport.disconnects },
      },
      [],
    )
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      this.timers.clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private cancelRecoveryDelay(): void {
    if (this.recoveryTimer !== null) {
      this.timers.clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
    const resolve = this.recoveryDelayResolve
    this.recoveryDelayResolve = null
    resolve?.()
  }
}
