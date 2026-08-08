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
  }

  async read(path: string): Promise<Uint8Array | null> {
    this.reads.push(path)
    const entry = this.entries.get(path)
    return entry ? Uint8Array.from(entry.bytes) : null
  }

  async writeRendezvous(path: string, bytes: Uint8Array, create: boolean): Promise<void> {
    const copy = Uint8Array.from(bytes)
    this.writes.push({ path, bytes: copy, create })
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
  startGate: Deferred<void> | null = null
  private onData: ((chunk: Uint8Array) => void) | null = null
  private onDisconnect: (() => void) | null = null
  private onFatal: ((error: Error) => void) | null = null

  async start(
    onData: (chunk: Uint8Array) => void,
    onDisconnect: () => void,
    onFatal: (error: Error) => void,
  ): Promise<void> {
    this.onData = onData
    this.onDisconnect = onDisconnect
    this.onFatal = onFatal
    if (this.startFailure) throw this.startFailure
    if (this.startGate) await this.startGate.promise
    this.started = true
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.startGate?.reject(new Error("stopped"))
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
    configureEndpoint?: (server: FakeEndpoint, index: number) => void
  } = {},
): Harness {
  const files = new MemoryFileSystem()
  const timers = new ManualTimers()
  const messages: BridgeReceiverMessage[] = []
  const endpoints = new Map<string, FakeEndpoint>()
  const created: FakeEndpoint[] = []
  const sessions = [...(options.sessions ?? [FIRST_SESSION, SECOND_SESSION])]
  const receiver = new BridgeReceiver({
    directory: "/bridge",
    platform: options.platform ?? "darwin",
    files,
    timers,
    nowMs: () => START_MS + timers.now,
    createSession: () => sessions.shift() ?? OTHER_SESSION,
    endpointFactory: ({ path }) => {
      const endpoint = new FakeEndpoint()
      options.configureEndpoint?.(endpoint, created.length)
      endpoints.set(path, endpoint)
      created.push(endpoint)
      return endpoint
    },
    publish: (message) => messages.push(message),
  })
  return { receiver, files, timers, messages, endpoints, created }
}

function endpoint(values: Harness, session: string, channel: PipeChannel): FakeEndpoint {
  const value = values.endpoints.get(pipeEndpoint("darwin", "/bridge", session, channel))
  if (!value) throw new Error(`Missing ${channel} endpoint for ${session}`)
  return value
}

function rendezvous(files: MemoryFileSystem) {
  const bytes = files.entries.get("/bridge/pipe-session")?.bytes
  return bytes ? decodeRendezvous(bytes, Math.floor(START_MS / 1_000)) : null
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

  it("accepts only session/state on state, scroll on scroll, and notes on notes", async () => {
    const values = harness()
    await values.receiver.start()
    values.receiver.setDiagnosticsEnabled(true)

    endpoint(values, FIRST_SESSION, "state").emitData(
      frame(BRIDGE_CHANNEL_SESSION, Uint8Array.of(1)),
    )
    endpoint(values, FIRST_SESSION, "state").emitData(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(2)))
    endpoint(values, FIRST_SESSION, "scroll").emitData(
      frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(3)),
    )
    endpoint(values, FIRST_SESSION, "notes").emitData(frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(4)))

    expect(values.messages.filter((message) => message.type !== "transport")).toMatchObject([
      { type: "session", diagnostics: { sizeBytes: 13 } },
      { type: "state", diagnostics: { sizeBytes: 13 } },
      { type: "scroll", diagnostics: { sizeBytes: 13 } },
      { type: "schedule", diagnostics: { sizeBytes: 13 } },
    ])
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
    server.emitData(expected)

    expect(server.stopped).toBe(false)
    expect(values.created).toHaveLength(3)
    const stateMessage = values.messages.find((message) => message.type === "state")
    expect(stateMessage?.type === "state" ? new Uint8Array(stateMessage.bytes) : null).toEqual(
      expected,
    )
    expect(values.messages.at(-2)).toMatchObject({
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
    const state = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1, 2, 3, 4))
    const scroll = frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(5, 6))
    const notes = frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(7, 8, 9))

    writeSync(writers.state, state.subarray(0, 7))
    writeSync(writers.state, state.subarray(7))
    writeSync(writers.scroll, scroll.subarray(0, 3))
    writeSync(writers.scroll, scroll.subarray(3))
    writeSync(writers.notes, notes.subarray(0, 11))
    writeSync(writers.notes, notes.subarray(11))
    await waitFor(
      () => messages.filter((message) => message.type !== "transport").length === 3,
      "fragmented FIFO frames",
    )

    closeSync(writers.state)
    await waitFor(
      () =>
        messages.some((message) => message.type === "transport" && message.disconnects.state === 1),
      "FIFO writer disconnect",
    )
    const replacement = openSync(paths.state, "w")
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
