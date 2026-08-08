import { BridgeReceiver } from "./bridgeReceiver"
import type { BridgeWorkerCommand, BridgeWorkerMessage } from "./bridgeWorkerProtocol"
import { createBridgeWorkerCommandHandler } from "./bridgeWorkerShutdown"

interface WorkerScope {
  postMessage(message: BridgeWorkerMessage, transfer: ArrayBuffer[]): void
  onmessage: ((event: { data: WorkerCommand }) => void) | null
}

type WorkerCommand = BridgeWorkerCommand

const scope = globalThis as unknown as WorkerScope
const receiver = new BridgeReceiver({
  publish: (message, transfer) => scope.postMessage(message, transfer),
})

const handleCommand = createBridgeWorkerCommandHandler({
  setDiagnosticsEnabled: (enabled) => receiver.setDiagnosticsEnabled(enabled),
  stopReceiver: () => receiver.stop(),
  publish: (message) => scope.postMessage(message, []),
})

scope.onmessage = ({ data }) => handleCommand(data)

void receiver.start()
