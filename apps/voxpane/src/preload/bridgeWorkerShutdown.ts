import type { BridgeWorkerCommand, BridgeWorkerMessage } from "./bridgeWorkerProtocol"

interface BridgeStopWorker {
  postMessage(command: BridgeWorkerCommand): void
}

type ShutdownCompleteMessage = Extract<BridgeWorkerMessage, { type: "shutdown-complete" }>

export class PreloadBridgeStopController {
  private stopping: Promise<boolean> | null = null
  private settle: ((stopped: boolean) => void) | null = null

  request(worker: BridgeStopWorker | null): Promise<boolean> {
    if (this.stopping) {
      return this.stopping
    }
    if (!worker) {
      this.stopping = Promise.resolve(false)
      return this.stopping
    }

    this.stopping = new Promise((resolve) => {
      this.settle = resolve
    })
    try {
      worker.postMessage({ type: "stop" })
    } catch {
      this.finish(false)
    }
    return this.stopping
  }

  accept(message: BridgeWorkerMessage): void {
    if (message.type === "shutdown-complete") {
      this.finish(message.stopped)
    }
  }

  private finish(stopped: boolean): void {
    const settle = this.settle
    if (!settle) return
    this.settle = null
    settle(stopped)
  }
}

interface PreloadShutdownDependencies {
  controller: PreloadBridgeStopController
  currentWorker(): BridgeStopWorker | null
  acknowledge(stopped: boolean): void
}

export function createPreloadShutdownHandler(
  dependencies: PreloadShutdownDependencies,
): () => void {
  return () => {
    void dependencies.controller.request(dependencies.currentWorker()).then((stopped) => {
      dependencies.acknowledge(stopped)
    })
  }
}

interface BridgeWorkerCommandDependencies {
  setDiagnosticsEnabled(enabled: boolean): void
  stopReceiver(): Promise<void>
  publish(message: ShutdownCompleteMessage): void
}

export function createBridgeWorkerCommandHandler(
  dependencies: BridgeWorkerCommandDependencies,
): (command: BridgeWorkerCommand) => void {
  let stopping: Promise<boolean> | null = null

  return (command) => {
    if (command.type === "diagnostics") {
      dependencies.setDiagnosticsEnabled(command.enabled)
      return
    }

    if (!stopping) {
      try {
        stopping = dependencies.stopReceiver().then(
          () => true,
          () => false,
        )
      } catch {
        stopping = Promise.resolve(false)
      }
    }
    void stopping.then((stopped) => {
      dependencies.publish({ type: "shutdown-complete", stopped })
    })
  }
}
