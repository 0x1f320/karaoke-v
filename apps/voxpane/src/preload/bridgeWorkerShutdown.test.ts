import { describe, expect, it, vi } from "vitest"
import {
  createBridgeWorkerCommandHandler,
  createPreloadShutdownHandler,
  PreloadBridgeStopController,
} from "./bridgeWorkerShutdown"

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

class FakeWorker {
  readonly commands: unknown[] = []
  postError: Error | null = null

  postMessage(command: unknown): void {
    if (this.postError) throw this.postError
    this.commands.push(command)
  }
}

describe("PreloadBridgeStopController", () => {
  it("returns false without a worker and never consults a later worker", async () => {
    const controller = new PreloadBridgeStopController()
    const later = new FakeWorker()

    await expect(controller.request(null)).resolves.toBe(false)
    await expect(controller.request(later)).resolves.toBe(false)
    expect(later.commands).toEqual([])
  })

  it("coalesces repeated requests into one worker stop command", async () => {
    const controller = new PreloadBridgeStopController()
    const worker = new FakeWorker()

    const first = controller.request(worker)
    const second = controller.request(worker)
    expect(first).toBe(second)
    expect(worker.commands).toEqual([{ type: "stop" }])

    controller.accept({ type: "shutdown-complete", stopped: true })
    await expect(first).resolves.toBe(true)
  })

  it("returns false when worker postMessage throws", async () => {
    const controller = new PreloadBridgeStopController()
    const worker = new FakeWorker()
    worker.postError = new Error("worker unavailable")

    await expect(controller.request(worker)).resolves.toBe(false)
    expect(worker.commands).toEqual([])
  })

  it("ignores late and duplicate worker shutdown messages", async () => {
    const controller = new PreloadBridgeStopController()
    const worker = new FakeWorker()
    const stopping = controller.request(worker)

    controller.accept({ type: "shutdown-complete", stopped: false })
    controller.accept({ type: "shutdown-complete", stopped: true })

    await expect(stopping).resolves.toBe(false)
  })
})

describe("createPreloadShutdownHandler", () => {
  it("acknowledges every repeated main request without creating or stopping twice", async () => {
    const controller = new PreloadBridgeStopController()
    const worker = new FakeWorker()
    const acknowledgements: boolean[] = []
    const currentWorker = vi.fn(() => worker)
    const handler = createPreloadShutdownHandler({
      controller,
      currentWorker,
      acknowledge: (stopped) => acknowledgements.push(stopped),
    })

    handler()
    handler()
    expect(currentWorker).toHaveBeenCalledTimes(2)
    expect(worker.commands).toEqual([{ type: "stop" }])

    controller.accept({ type: "shutdown-complete", stopped: true })
    await vi.waitFor(() => expect(acknowledgements).toEqual([true, true]))
  })

  it("acknowledges no-worker shutdown without lazy worker creation", async () => {
    const acknowledgements: boolean[] = []
    const handler = createPreloadShutdownHandler({
      controller: new PreloadBridgeStopController(),
      currentWorker: () => null,
      acknowledge: (stopped) => acknowledgements.push(stopped),
    })

    handler()
    await vi.waitFor(() => expect(acknowledgements).toEqual([false]))
  })
})

describe("createBridgeWorkerCommandHandler", () => {
  it("stops the receiver once for duplicate commands and safely acknowledges each", async () => {
    const stopped = deferred()
    const stopReceiver = vi.fn(() => stopped.promise)
    const messages: unknown[] = []
    const handler = createBridgeWorkerCommandHandler({
      setDiagnosticsEnabled: vi.fn(),
      stopReceiver,
      publish: (message) => messages.push(message),
    })

    handler({ type: "stop" })
    handler({ type: "stop" })
    expect(stopReceiver).toHaveBeenCalledTimes(1)

    stopped.resolve()
    await vi.waitFor(() =>
      expect(messages).toEqual([
        { type: "shutdown-complete", stopped: true },
        { type: "shutdown-complete", stopped: true },
      ]),
    )
  })

  it("forwards diagnostics and reports a receiver stop rejection", async () => {
    const setDiagnosticsEnabled = vi.fn()
    const messages: unknown[] = []
    const handler = createBridgeWorkerCommandHandler({
      setDiagnosticsEnabled,
      stopReceiver: () => Promise.reject(new Error("stop failed")),
      publish: (message) => messages.push(message),
    })

    handler({ type: "diagnostics", enabled: true })
    handler({ type: "stop" })

    expect(setDiagnosticsEnabled).toHaveBeenCalledWith(true)
    await vi.waitFor(() =>
      expect(messages).toEqual([{ type: "shutdown-complete", stopped: false }]),
    )
  })
})
