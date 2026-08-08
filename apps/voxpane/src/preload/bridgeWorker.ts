import { BridgeReceiver } from "./bridgeReceiver"
import type { BridgeWorkerCommand, BridgeWorkerMessage } from "./bridgeWorkerProtocol"

interface WorkerScope {
  postMessage(message: BridgeWorkerMessage, transfer: ArrayBuffer[]): void
  onmessage: ((event: { data: WorkerCommand }) => void) | null
}

type WorkerCommand = BridgeWorkerCommand

const scope = globalThis as unknown as WorkerScope
const receiver = new BridgeReceiver({
  publish: (message, transfer) => scope.postMessage(message, transfer),
})

scope.onmessage = ({ data }) => {
  if (data.type === "diagnostics") {
    receiver.setDiagnosticsEnabled(data.enabled)
  } else {
    void receiver.stop().then(() => {
      scope.postMessage({ type: "shutdown-complete" }, [])
    })
  }
}

void receiver.start()
