import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  BRIDGE_CHANNEL_NOTES,
  BRIDGE_CHANNEL_SCROLL,
  BRIDGE_CHANNEL_SESSION,
  BRIDGE_CHANNEL_STATE,
  BRIDGE_HEADER_BYTES,
  BRIDGE_LAYOUT,
} from "../shared/bridgeChannels"
import {
  decodeRendezvous,
  encodeRendezvous,
  type PipeChannel,
  pipeEndpoint,
} from "../shared/bridgeRendezvous"
import type { PipeEndpointServer } from "./bridgePipeServer"
import {
  type BridgeFrameMessage,
  BridgeReceiver,
  type BridgeReceiverFileSystem,
  type BridgeReceiverMessage,
  type BridgeReceiverTimers,
} from "./bridgeReceiver"

const FIRST_SESSION = "0123456789abcdef0123456789abcdef"
const SECOND_SESSION = "fedcba9876543210fedcba9876543210"
const OTHER_SESSION = "11111111111111111111111111111111"
const START_MS = 1_786_176_000_000
const MAGIC = 0x31425056
const temporaryDirectories: string[] = []

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

class ManualTimers implements BridgeReceiverTimers {
  now = 0
  private nextId = 1
  private readonly tasks = new Map<number, { at: number; callback: () => void }>()

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId
    this.nextId += 1
    this.tasks.set(id, { at: this.now + delayMs, callback })
    return id
  }

  clearTimeout(id: unknown): void {
    this.tasks.delete(id as number)
  }

  async advanceBy(delayMs: number): Promise<void> {
    this.now += delayMs
    let ran = true
    while (ran) {
      ran = false
      for (const [id, task] of [...this.tasks]) {
        if (task.at <= this.now) {
          this.tasks.delete(id)
          task.callback()
          ran = true
          await flush()
        }
      }
    }
  }
}

type FileKind = "file" | "fifo" | "symlink" | "directory"

class MemoryFileSystem implements BridgeReceiverFileSystem {
  readonly entries = new Map<string, { kind: FileKind; bytes: Uint8Array }>()
  readonly writes: { path: string; bytes: Uint8Array; create: boolean }[] = []
  readonly unlinks: string[] = []
  readonly reads: string[] = []
  readonly writeGates = new Map<number, Deferred<void>>()
  onUnlink: ((path: string) => void) | null = null

  async list(directory: string): Promise<string[]> {
    const prefix = `${directory}/`
    return [...this.entries.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => path.slice(prefix.length))
  }

  async lstat(path: string) {
    const entry = this.entries.get(path)
    if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" })
    return {
      isFIFO: () => entry.kind === "fifo",
      isFile: () => entry.kind === "file",
    }
  }

  async unlink(path: string): Promise<void> {
    if (!this.entries.delete(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" })
    this.unlinks.push(path)
    this.onUnlink?.(path)
  }

  async read(path: string): Promise<Uint8Array | null> {
    this.reads.push(path)
    const entry = this.entries.get(path)
    return entry ? Uint8Array.from(entry.bytes) : null
  }

  async writeRendezvous(
    path: string,
    bytes: Uint8Array,
    create: boolean,
    _isCancelled?: () => boolean,
  ): Promise<void> {
    const copy = Uint8Array.from(bytes)
    const index = this.writes.length
    this.writes.push({ path, bytes: copy, create })
    await this.writeGates.get(index)?.promise
    this.entries.set(path, { kind: "file", bytes: copy })
  }

  set(path: string, kind: FileKind, bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0)): void {
    this.entries.set(path, { kind, bytes: Uint8Array.from(bytes) })
  }
}

class FakeEndpoint implements PipeEndpointServer {
  started = false
  stopped = false
  startFailure: Error | null = null
  synchronousStartFailure: Error | null = null
  startGate: Deferred<void> | null = null
  stopGate: Deferred<void> | null = null
  onStopBegin: (() => void) | null = null
  private onData: ((chunk: Uint8Array) => void) | null = null
  private onDisconnect: (() => void) | null = null
  private onFatal: ((error: Error) => void) | null = null

  start(
    onData: (chunk: Uint8Array) => void,
    onDisconnect: () => void,
    onFatal: (error: Error) => void,
  ): Promise<void> {
    this.onData = onData
    this.onDisconnect = onDisconnect
    this.onFatal = onFatal
    if (this.synchronousStartFailure) throw this.synchronousStartFailure
    return this.startInternal()
  }

  private async startInternal(): Promise<void> {
    if (this.startFailure) throw this.startFailure
    if (this.startGate) await this.startGate.promise
    this.started = true
  }

  async stop(): Promise<void> {
    this.onStopBegin?.()
    this.stopped = true
    this.startGate?.reject(new Error("stopped"))
    await this.stopGate?.promise
  }

  emitData(bytes: Uint8Array): void {
    this.onData?.(bytes)
  }

  emitDisconnect(): void {
    this.onDisconnect?.()
  }

  emitFatal(error = new Error("endpoint failed")): void {
    this.onFatal?.(error)
  }
}

interface Harness {
  receiver: BridgeReceiver
  files: MemoryFileSystem
  timers: ManualTimers
  messages: BridgeReceiverMessage[]
  endpoints: Map<string, FakeEndpoint>
  created: FakeEndpoint[]
}

function frame(channel: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(BRIDGE_HEADER_BYTES + payload.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint16(4, BRIDGE_LAYOUT, true)
  view.setUint16(6, channel, true)
  view.setUint32(8, payload.length, true)
  bytes.set(payload, BRIDGE_HEADER_BYTES)
  return bytes
}

function sessionFrame(appSession = FIRST_SESSION): Uint8Array {
  return frame(
    BRIDGE_CHANNEL_SESSION,
    new TextEncoder().encode(JSON.stringify({ v: 1, layout: 5, appSession })),
  )
}

function oversizedHeader(channel: number, payloadBytes: number): Uint8Array {
  const bytes = new Uint8Array(BRIDGE_HEADER_BYTES)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint16(4, BRIDGE_LAYOUT, true)
  view.setUint16(6, channel, true)
  view.setUint32(8, payloadBytes, true)
  return bytes
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function harness(
  options: {
    sessions?: string[]
    platform?: NodeJS.Platform
    files?: MemoryFileSystem
    createSession?: () => string
    beforeEndpointFactory?: (index: number) => void
    configureEndpoint?: (server: FakeEndpoint, index: number) => void
    beforePublish?: (message: BridgeReceiverMessage, index: number) => void
  } = {},
): Harness {
  const files = options.files ?? new MemoryFileSystem()
  const timers = new ManualTimers()
  const messages: BridgeReceiverMessage[] = []
  const endpoints = new Map<string, FakeEndpoint>()
  const created: FakeEndpoint[] = []
  const sessions = [...(options.sessions ?? [FIRST_SESSION, SECOND_SESSION])]
  let factoryCalls = 0
  let publishCalls = 0
  const receiver = new BridgeReceiver({
    directory: "/bridge",
    platform: options.platform ?? "darwin",
    files,
    timers,
    nowMs: () => START_MS + timers.now,
    createSession: options.createSession ?? (() => sessions.shift() ?? OTHER_SESSION),
    endpointFactory: ({ path }) => {
      const callIndex = factoryCalls
      factoryCalls += 1
      options.beforeEndpointFactory?.(callIndex)
      const endpoint = new FakeEndpoint()
      options.configureEndpoint?.(endpoint, created.length)
      endpoints.set(path, endpoint)
      created.push(endpoint)
      return endpoint
    },
    publish: (message) => {
      const callIndex = publishCalls
      publishCalls += 1
      options.beforePublish?.(message, callIndex)
      messages.push(message)
    },
  })
  return { receiver, files, timers, messages, endpoints, created }
}

function endpoint(values: Harness, session: string, channel: PipeChannel): FakeEndpoint {
  const value = values.endpoints.get(pipeEndpoint("darwin", "/bridge", session, channel))
  if (!value) throw new Error(`Missing ${channel} endpoint for ${session}`)
  return value
}

function rendezvous(files: MemoryFileSystem, nowMs = START_MS) {
  const bytes = files.entries.get("/bridge/pipe-session")?.bytes
  return bytes ? decodeRendezvous(bytes, Math.floor(nowMs / 1_000)) : null
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("BridgeReceiver", () => {
  it("publishes rendezvous only after all three endpoints are ready", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const values = harness({
      configureEndpoint: (server, index) => {
        server.startGate = gates[index] ?? null
      },
    })

    const starting = values.receiver.start()
    await flush()
    expect(values.created).toHaveLength(3)
    expect(values.files.writes).toEqual([])

    gates[0].resolve()
    gates[1].resolve()
    await flush()
    expect(values.files.writes).toEqual([])

    gates[2].resolve()
    await starting

    expect(values.created.map((server) => server.started)).toEqual([true, true, true])
    expect(rendezvous(values.files)?.session).toBe(FIRST_SESSION)
  })

  it("supervises a createSession throw and eventually resolves the original start", async () => {
    let calls = 0
    const values = harness({
      createSession: () => {
        calls += 1
        if (calls === 1) throw new Error("random source failed")
        return SECOND_SESSION
      },
    })

    let ready = false
    const starting = values.receiver.start().then(() => {
      ready = true
    })
    await flush()

    expect(calls).toBe(1)
    expect(values.created).toHaveLength(0)

    await values.timers.advanceBy(250)
    await flush()

    expect(ready).toBe(true)
    await starting
    expect(calls).toBe(2)
    expect(values.created).toHaveLength(3)
    expect(rendezvous(values.files)?.session).toBe(SECOND_SESSION)
    await values.receiver.stop()
  })

  it.each([0, 1])(
    "cleans partial resources when endpoint factory call %i throws",
    async (throwAt) => {
      let thrown = false
      const values = harness({
        beforeEndpointFactory: (index) => {
          if (!thrown && index === throwAt) {
            thrown = true
            throw new Error("endpoint factory failed")
          }
        },
      })

      let ready = false
      const starting = values.receiver.start().then(() => {
        ready = true
      })
      await flush()

      expect(values.created).toHaveLength(throwAt)
      expect(values.created.every((server) => server.stopped)).toBe(true)

      await values.timers.advanceBy(250)
      await flush()

      expect(ready).toBe(true)
      await starting
      expect(values.created).toHaveLength(throwAt + 3)
      expect(rendezvous(values.files)?.session).toBe(SECOND_SESSION)
      expect(
        values.messages.filter(
          (message) => message.type === "transport" && message.status === "error",
        ),
      ).toHaveLength(1)
      await values.receiver.stop()
    },
  )

  it.each(["starting", "ready"] as const)(
    "remains supervised when publishing %s transport status throws",
    async (status) => {
      let statusThrown = false
      let errorReportThrown = false
      const values = harness({
        beforePublish: (message) => {
          if (message.type !== "transport") {
            return
          }
          if (!statusThrown && message.status === status) {
            statusThrown = true
            throw new Error("status publish failed")
          }
          if (statusThrown && !errorReportThrown && message.status === "error") {
            errorReportThrown = true
            throw new Error("error publish failed")
          }
        },
      })

      let ready = false
      const starting = values.receiver.start().then(() => {
        ready = true
      })
      await flush()

      expect(values.created).toHaveLength(status === "starting" ? 0 : 3)
      expect(values.created.every((server) => server.stopped)).toBe(true)

      await values.timers.advanceBy(250)
      await flush()

      expect(ready).toBe(true)
      await starting
      expect(errorReportThrown).toBe(true)
      expect(rendezvous(values.files)?.session).toBe(SECOND_SESSION)
      await values.receiver.stop()
    },
  )

  it("captures a synchronous endpoint start throw and recovers all endpoints", async () => {
    const values = harness({
      configureEndpoint: (server, index) => {
        if (index === 1) server.synchronousStartFailure = new Error("sync listen failed")
      },
    })

    let ready = false
    const starting = values.receiver.start().then(() => {
      ready = true
    })
    await flush()

    expect(values.created).toHaveLength(3)
    expect(values.created.every((server) => server.stopped)).toBe(true)

    await values.timers.advanceBy(250)
    await flush()

    expect(ready).toBe(true)
    await starting
    expect(values.created).toHaveLength(6)
    expect(rendezvous(values.files)?.session).toBe(SECOND_SESSION)
    await values.receiver.stop()
  })

  it("writes one exact 128-byte record per heartbeat update", async () => {
    const values = harness()
    await values.receiver.start()

    expect(values.files.writes).toHaveLength(1)
    expect(values.files.writes[0]).toMatchObject({ create: true })
    expect(values.files.writes[0]?.bytes).toHaveLength(128)

    await values.timers.advanceBy(500)

    expect(values.files.writes).toHaveLength(2)
    const heartbeat = values.files.writes[1]
    expect(heartbeat).toMatchObject({ create: false })
    expect(heartbeat?.bytes).toHaveLength(128)
    expect(decodeRendezvous(heartbeat?.bytes ?? new Uint8Array(0), 1_786_176_000)).toEqual({
      heartbeatSeconds: 1_786_176_000,
      session: FIRST_SESSION,
    })

    await values.receiver.stop()
  })

  it.each(["explicit stop", "recovery"] as const)(
    "withdraws owned rendezvous before endpoint stop begins during %s",
    async (mode) => {
      const events: string[] = []
      const values = harness({
        configureEndpoint: (server, index) => {
          server.onStopBegin = () => events.push(`stop:${index}`)
        },
      })
      values.files.onUnlink = (path) => {
        if (path === "/bridge/pipe-session") events.push("rendezvous:unlink")
      }
      await values.receiver.start()

      if (mode === "recovery") {
        endpoint(values, FIRST_SESSION, "state").emitFatal()
        await flush()
      }
      await values.receiver.stop()

      expect(events[0]).toBe("rendezvous:unlink")
      expect(events.slice(1).every((event) => event.startsWith("stop:"))).toBe(true)
    },
  )

  it("joins an in-flight initial rendezvous write before stop cleanup", async () => {
    const files = new MemoryFileSystem()
    const writeGate = deferred<void>()
    files.writeGates.set(0, writeGate)
    const values = harness({ files })

    const starting = values.receiver.start()
    await flush()
    expect(files.writes).toHaveLength(1)

    let stopped = false
    const stopping = values.receiver.stop().then(() => {
      stopped = true
    })
    await flush()
    const joinedBeforeRelease = !stopped

    writeGate.resolve()
    await Promise.all([starting, stopping])

    expect(joinedBeforeRelease).toBe(true)
    expect(files.entries.has("/bridge/pipe-session")).toBe(false)
  })

  it("joins an in-flight heartbeat refresh before stop cleanup", async () => {
    const files = new MemoryFileSystem()
    const writeGate = deferred<void>()
    files.writeGates.set(1, writeGate)
    const values = harness({ files })
    await values.receiver.start()

    await values.timers.advanceBy(500)
    expect(files.writes).toHaveLength(2)

    let stopped = false
    const stopping = values.receiver.stop().then(() => {
      stopped = true
    })
    await flush()
    const joinedBeforeRelease = !stopped

    writeGate.resolve()
    await stopping
    await flush()

    expect(joinedBeforeRelease).toBe(true)
    expect(files.entries.has("/bridge/pipe-session")).toBe(false)
  })

  it("does not let an old in-flight heartbeat overwrite a recovered session", async () => {
    const files = new MemoryFileSystem()
    const writeGate = deferred<void>()
    const teardownGate = deferred<void>()
    const events: string[] = []
    files.writeGates.set(1, writeGate)
    files.onUnlink = (path) => {
      if (path === "/bridge/pipe-session") events.push("rendezvous:unlink")
    }
    const values = harness({
      files,
      configureEndpoint: (server, index) => {
        if (index === 0) server.stopGate = teardownGate
        server.onStopBegin = () => events.push(`stop:${index}`)
      },
    })
    await values.receiver.start()

    await values.timers.advanceBy(500)
    endpoint(values, FIRST_SESSION, "state").emitFatal()
    await flush()
    await values.timers.advanceBy(250)
    const sessionsBeforeOldWriteCompletes = values.created.length
    const endpointStoppedBeforeOldWriteCompletes = events.some((event) => event.startsWith("stop:"))

    writeGate.resolve()
    await flush()
    await flush()
    const unlinkIndex = events.indexOf("rendezvous:unlink")
    const stopIndex = events.findIndex((event) => event.startsWith("stop:"))
    await values.timers.advanceBy(250)
    const sessionsBeforeEndpointTeardownCompletes = values.created.length
    teardownGate.resolve()
    await flush()
    await flush()
    await values.timers.advanceBy(250)
    await flush()

    expect(sessionsBeforeOldWriteCompletes).toBe(3)
    expect(endpointStoppedBeforeOldWriteCompletes).toBe(false)
    expect(unlinkIndex).toBeGreaterThanOrEqual(0)
    expect(unlinkIndex).toBeLessThan(stopIndex)
    expect(sessionsBeforeEndpointTeardownCompletes).toBe(3)
    expect(values.created).toHaveLength(6)
    expect(rendezvous(files, START_MS + values.timers.now)?.session).toBe(SECOND_SESSION)
    await values.receiver.stop()
  })

  it("accepts only session/state on state, scroll on scroll, and notes on notes", async () => {
    const values = harness()
    await values.receiver.start()
    values.receiver.setDiagnosticsEnabled(true)

    const session = sessionFrame()
    endpoint(values, FIRST_SESSION, "state").emitData(session)
    endpoint(values, FIRST_SESSION, "state").emitData(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(2)))
    endpoint(values, FIRST_SESSION, "scroll").emitData(
      frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(3)),
    )
    endpoint(values, FIRST_SESSION, "notes").emitData(frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(4)))

    expect(values.messages.filter((message) => message.type !== "transport")).toMatchObject([
      { type: "session", diagnostics: { sizeBytes: session.byteLength } },
      { type: "state", diagnostics: { sizeBytes: 13 } },
      { type: "scroll", diagnostics: { sizeBytes: 13 } },
      { type: "schedule", diagnostics: { sizeBytes: 13 } },
    ])
    await values.receiver.stop()
  })

  it.each([
    ["scroll then notes", ["scroll", "notes"]],
    ["notes then scroll", ["notes", "scroll"]],
  ] as const)(
    "publishes a session before buffered indexed frames received %s",
    async (_label, arrivalOrder) => {
      const values = harness()
      await values.receiver.start()

      for (const channel of arrivalOrder) {
        if (channel === "scroll") {
          endpoint(values, FIRST_SESSION, "scroll").emitData(
            frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(3)),
          )
        } else {
          endpoint(values, FIRST_SESSION, "notes").emitData(
            frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(4)),
          )
        }
      }
      endpoint(values, FIRST_SESSION, "state").emitData(
        Uint8Array.from([...sessionFrame(), ...frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(2))]),
      )

      expect(
        values.messages
          .filter((message) => message.type !== "transport")
          .map((message) => message.type),
      ).toEqual(["session", "scroll", "schedule", "state"])
      await values.receiver.stop()
    },
  )

  it.each([
    [
      ["session", "scroll", "notes"],
      ["session", "scroll", "schedule"],
    ],
    [
      ["session", "notes", "scroll"],
      ["session", "schedule", "scroll"],
    ],
    [
      ["scroll", "session", "notes"],
      ["session", "scroll", "schedule"],
    ],
    [
      ["notes", "session", "scroll"],
      ["session", "schedule", "scroll"],
    ],
    [
      ["scroll", "notes", "session"],
      ["session", "scroll", "schedule"],
    ],
    [
      ["notes", "scroll", "session"],
      ["session", "scroll", "schedule"],
    ],
  ] as const)("gates every session/scroll/notes arrival permutation", async (arrival, expected) => {
    const values = harness()
    await values.receiver.start()

    for (const kind of arrival) {
      if (kind === "session") {
        endpoint(values, FIRST_SESSION, "state").emitData(sessionFrame())
      } else if (kind === "scroll") {
        endpoint(values, FIRST_SESSION, "scroll").emitData(
          frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(1)),
        )
      } else {
        endpoint(values, FIRST_SESSION, "notes").emitData(
          frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(2)),
        )
      }
    }

    expect(
      values.messages
        .filter((message) => message.type !== "transport")
        .map((message) => message.type),
    ).toEqual(expected)
    await values.receiver.stop()
  })

  it("retains only the latest complete pre-session indexed frame per channel", async () => {
    const values = harness()
    await values.receiver.start()
    const firstScroll = frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(1))
    const latestScroll = frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(2))
    const firstNotes = frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(3))
    const latestNotes = frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(4))

    endpoint(values, FIRST_SESSION, "scroll").emitData(firstScroll)
    endpoint(values, FIRST_SESSION, "notes").emitData(firstNotes)
    endpoint(values, FIRST_SESSION, "scroll").emitData(latestScroll)
    endpoint(values, FIRST_SESSION, "notes").emitData(latestNotes)
    endpoint(values, FIRST_SESSION, "state").emitData(sessionFrame())

    const published = values.messages.filter(
      (message): message is BridgeFrameMessage => message.type !== "transport",
    )
    expect(published.map((message) => message.type)).toEqual(["session", "scroll", "schedule"])
    expect(published.map((message) => [...new Uint8Array(message.bytes)])).toEqual([
      [...sessionFrame()],
      [...latestScroll],
      [...latestNotes],
    ])
    await values.receiver.stop()
  })

  it("discards pending indexed frames and closes the gate on any endpoint disconnect", async () => {
    const values = harness()
    await values.receiver.start()

    endpoint(values, FIRST_SESSION, "notes").emitData(frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(1)))
    endpoint(values, FIRST_SESSION, "scroll").emitDisconnect()
    endpoint(values, FIRST_SESSION, "state").emitData(sessionFrame())
    endpoint(values, FIRST_SESSION, "state").emitData(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(3)))

    expect(
      values.messages
        .filter((message) => message.type !== "transport")
        .map((message) => message.type),
    ).toEqual(["session", "state"])
    await values.receiver.stop()
  })

  it("does not publish state before the physical handle set supplies a session", async () => {
    const values = harness()
    await values.receiver.start()

    endpoint(values, FIRST_SESSION, "state").emitData(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1)))
    expect(values.messages.filter((message) => message.type === "state")).toEqual([])

    endpoint(values, FIRST_SESSION, "state").emitData(sessionFrame())
    expect(
      values.messages
        .filter((message) => message.type !== "transport")
        .map((message) => message.type),
    ).toEqual(["session"])
    await values.receiver.stop()
  })

  it.each([
    ["malformed", frame(BRIDGE_CHANNEL_SESSION, Uint8Array.of(1))],
    ["different app session", sessionFrame(OTHER_SESSION)],
  ] as const)("treats a %s pre-session frame as fatal", async (_label, invalidSession) => {
    const values = harness()
    await values.receiver.start()

    endpoint(values, FIRST_SESSION, "notes").emitData(frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(1)))
    endpoint(values, FIRST_SESSION, "state").emitData(invalidSession)
    await flush()

    expect(values.messages.filter((message) => message.type !== "transport")).toEqual([])
    expect(values.created.slice(0, 3).every((server) => server.stopped)).toBe(true)
    expect(values.messages.at(-1)).toMatchObject({
      type: "transport",
      status: "error",
      malformedFrames: 1,
    })
    await values.receiver.stop()
  })

  it.each([
    ["state", BRIDGE_CHANNEL_SCROLL, 1],
    ["state", BRIDGE_CHANNEL_SESSION, 4 * 1024 + 1],
    ["state", BRIDGE_CHANNEL_STATE, 1024 + 1],
    ["scroll", BRIDGE_CHANNEL_SCROLL, 1024 + 1],
    ["notes", BRIDGE_CHANNEL_NOTES, 64 * 1024 * 1024 + 1],
  ] as const)("treats a disallowed or oversized %s frame as fatal", async (channel, kind, size) => {
    const values = harness()
    await values.receiver.start()

    endpoint(values, FIRST_SESSION, channel).emitData(oversizedHeader(kind, size))
    await flush()

    expect(values.created.slice(0, 3).every((server) => server.stopped)).toBe(true)
    expect(values.messages.at(-1)).toMatchObject({ type: "transport", status: "error" })
    await values.receiver.stop()
  })

  it("recovers malformed input with fresh endpoints and a fresh app session", async () => {
    const values = harness()
    await values.receiver.start()

    endpoint(values, FIRST_SESSION, "scroll").emitData(
      frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1)),
    )
    await flush()

    expect(values.created.slice(0, 3).every((server) => server.stopped)).toBe(true)
    expect(values.files.entries.has("/bridge/pipe-session")).toBe(false)

    await values.timers.advanceBy(250)

    expect(values.created).toHaveLength(6)
    expect(rendezvous(values.files)?.session).toBe(SECOND_SESSION)
    expect(values.messages.at(-1)).toMatchObject({
      type: "transport",
      status: "ready",
      recoveries: 1,
      malformedFrames: 1,
    })
    await values.receiver.stop()
  })

  it("recovers a fatal endpoint start failure before resolving start", async () => {
    const values = harness({
      configureEndpoint: (server, index) => {
        if (index === 1) server.startFailure = new Error("listen failed")
      },
    })

    const starting = values.receiver.start()
    await flush()
    expect(values.created.slice(0, 3).every((server) => server.stopped)).toBe(true)

    await values.timers.advanceBy(250)
    await starting

    expect(rendezvous(values.files)?.session).toBe(SECOND_SESSION)
    expect(values.messages.at(-1)).toMatchObject({
      type: "transport",
      status: "ready",
      endpointFailures: 1,
      recoveries: 1,
    })
    await values.receiver.stop()
  })

  it("keeps endpoints alive on clean disconnect and resets partial frame state", async () => {
    const values = harness()
    await values.receiver.start()
    const server = endpoint(values, FIRST_SESSION, "state")
    const expected = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(8, 9))

    server.emitData(expected.subarray(0, 5))
    server.emitDisconnect()
    server.emitData(sessionFrame())
    server.emitData(expected)

    expect(server.stopped).toBe(false)
    expect(values.created).toHaveLength(3)
    const stateMessage = values.messages.find((message) => message.type === "state")
    expect(stateMessage?.type === "state" ? new Uint8Array(stateMessage.bytes) : null).toEqual(
      expected,
    )
    expect(
      values.messages.find(
        (message) => message.type === "transport" && message.disconnects.state === 1,
      ),
    ).toMatchObject({
      type: "transport",
      status: "ready",
      disconnects: { state: 1, scroll: 0, notes: 0 },
    })
    await values.receiver.stop()
  })

  it("coalesces repeated fatal signals into one recovery", async () => {
    const values = harness()
    await values.receiver.start()
    const server = endpoint(values, FIRST_SESSION, "state")

    server.emitFatal()
    server.emitFatal()
    endpoint(values, FIRST_SESSION, "scroll").emitFatal()
    await flush()
    await values.timers.advanceBy(250)

    expect(values.created).toHaveLength(6)
    expect(
      values.messages.filter(
        (message) => message.type === "transport" && message.status === "error",
      ),
    ).toHaveLength(1)
    await values.receiver.stop()
  })

  it("does not restart after explicit stop during recovery backoff", async () => {
    const values = harness()
    await values.receiver.start()

    endpoint(values, FIRST_SESSION, "state").emitFatal()
    await flush()
    await values.receiver.stop()
    await values.timers.advanceBy(1_000)

    expect(values.created).toHaveLength(3)
    expect(values.files.entries.has("/bridge/pipe-session")).toBe(false)
  })

  it("cancels recovery when stop wins before the delay is registered", async () => {
    const teardownGate = deferred<void>()
    const values = harness({
      configureEndpoint: (server, index) => {
        if (index === 0) server.stopGate = teardownGate
      },
    })
    await values.receiver.start()

    endpoint(values, FIRST_SESSION, "state").emitFatal()
    await flush()

    let stopped = false
    const stopping = values.receiver.stop().then(() => {
      stopped = true
    })
    await flush()
    teardownGate.resolve()
    await flush()
    await flush()
    const resolvedWithoutAdvancingTimers = stopped

    await values.timers.advanceBy(250)
    await stopping

    expect(resolvedWithoutAdvancingTimers).toBe(true)
    expect(values.created).toHaveLength(3)
    expect(values.files.entries.has("/bridge/pipe-session")).toBe(false)
  })

  it("does not remove a rendezvous record now owned by another session", async () => {
    const values = harness()
    await values.receiver.start()
    const otherRecord = encodeRendezvous({
      heartbeatSeconds: Math.floor(START_MS / 1_000),
      session: OTHER_SESSION,
    })
    values.files.set("/bridge/pipe-session", "file", otherRecord)

    await values.receiver.stop()

    expect(values.files.entries.get("/bridge/pipe-session")?.bytes).toEqual(otherRecord)
  })

  it("removes its own rendezvous even when its heartbeat is stale", async () => {
    const values = harness()
    await values.receiver.start()
    values.files.set(
      "/bridge/pipe-session",
      "file",
      encodeRendezvous({
        heartbeatSeconds: Math.floor(START_MS / 1_000) - 10,
        session: FIRST_SESSION,
      }),
    )

    await values.receiver.stop()

    expect(values.files.entries.has("/bridge/pipe-session")).toBe(false)
  })

  it("prunes only matching FIFO names and removes only exact legacy regular files", async () => {
    const values = harness()
    values.files.set(
      "/bridge/pipe-session",
      "file",
      encodeRendezvous({
        heartbeatSeconds: Math.floor(START_MS / 1_000),
        session: SECOND_SESSION,
      }),
    )
    values.files.set(`/bridge/pipe-${SECOND_SESSION}-state`, "fifo")
    values.files.set(`/bridge/pipe-${OTHER_SESSION}-state`, "fifo")
    values.files.set(`/bridge/pipe-${OTHER_SESSION}-scroll`, "file")
    values.files.set(`/bridge/pipe-${OTHER_SESSION}-notes`, "symlink")
    values.files.set(`/bridge/pipe-${SECOND_SESSION.toUpperCase()}-state`, "fifo")
    values.files.set("/bridge/pipe-unrelated-state", "fifo")
    values.files.set("/bridge/session.json", "file")
    values.files.set("/bridge/state", "symlink")
    values.files.set("/bridge/scroll", "fifo")
    values.files.set("/bridge/notes", "directory")
    values.files.set("/bridge/notes.backup", "file")

    await values.receiver.start()

    expect(values.files.entries.has(`/bridge/pipe-${OTHER_SESSION}-state`)).toBe(false)
    expect(values.files.entries.has(`/bridge/pipe-${SECOND_SESSION}-state`)).toBe(true)
    expect(values.files.entries.has(`/bridge/pipe-${OTHER_SESSION}-scroll`)).toBe(true)
    expect(values.files.entries.has(`/bridge/pipe-${OTHER_SESSION}-notes`)).toBe(true)
    expect(values.files.entries.has(`/bridge/pipe-${SECOND_SESSION.toUpperCase()}-state`)).toBe(
      true,
    )
    expect(values.files.entries.has("/bridge/pipe-unrelated-state")).toBe(true)
    expect(values.files.entries.has("/bridge/session.json")).toBe(false)
    expect(values.files.entries.has("/bridge/state")).toBe(true)
    expect(values.files.entries.has("/bridge/scroll")).toBe(true)
    expect(values.files.entries.has("/bridge/notes")).toBe(true)
    expect(values.files.entries.has("/bridge/notes.backup")).toBe(true)
    expect(values.files.reads).toEqual(["/bridge/pipe-session"])
    await values.receiver.stop()
  })
})

describe.skipIf(process.platform !== "darwin")("BridgeReceiver macOS integration", () => {
  it("publishes after FIFO readiness, receives fragmented frames across reconnects, and cleans up", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voxpane-pipe-"))
    temporaryDirectories.push(directory)
    const messages: BridgeReceiverMessage[] = []
    const receiver = new BridgeReceiver({
      directory,
      platform: "darwin",
      createSession: () => FIRST_SESSION,
      publish: (message) => messages.push(message),
    })
    const paths = {
      state: pipeEndpoint("darwin", directory, FIRST_SESSION, "state"),
      scroll: pipeEndpoint("darwin", directory, FIRST_SESSION, "scroll"),
      notes: pipeEndpoint("darwin", directory, FIRST_SESSION, "notes"),
    }
    expect(existsSync(join(directory, "pipe-session"))).toBe(false)

    await receiver.start()

    expect(readFileSync(join(directory, "pipe-session"))).toHaveLength(128)
    expect(Object.values(paths).every((path) => lstatSync(path).isFIFO())).toBe(true)
    const writers = {
      state: openSync(paths.state, "w"),
      scroll: openSync(paths.scroll, "w"),
      notes: openSync(paths.notes, "w"),
    }
    const session = sessionFrame()
    const state = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1, 2, 3, 4))
    const scroll = frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(5, 6))
    const notes = frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(7, 8, 9))

    writeSync(writers.state, session)
    writeSync(writers.state, state.subarray(0, 7))
    writeSync(writers.state, state.subarray(7))
    writeSync(writers.scroll, scroll.subarray(0, 3))
    writeSync(writers.scroll, scroll.subarray(3))
    writeSync(writers.notes, notes.subarray(0, 11))
    writeSync(writers.notes, notes.subarray(11))
    await waitFor(
      () => messages.filter((message) => message.type !== "transport").length === 4,
      "fragmented FIFO frames",
    )

    closeSync(writers.state)
    await waitFor(
      () =>
        messages.some((message) => message.type === "transport" && message.disconnects.state === 1),
      "FIFO writer disconnect",
    )
    const replacement = openSync(paths.state, "w")
    writeSync(replacement, session)
    writeSync(replacement, state)
    await waitFor(
      () => messages.filter((message) => message.type === "state").length === 2,
      "replacement FIFO writer",
    )

    closeSync(replacement)
    closeSync(writers.scroll)
    closeSync(writers.notes)
    await receiver.stop()

    expect(Object.values(paths).some(existsSync)).toBe(false)
    expect(existsSync(join(directory, "pipe-session"))).toBe(false)
  })
})
