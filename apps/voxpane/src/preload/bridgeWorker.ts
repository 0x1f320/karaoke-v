import { BridgeReceiver, type BridgeReceiverMessage } from "./bridgeReceiver"

interface WorkerScope {
  postMessage(message: BridgeReceiverMessage, transfer: ArrayBuffer[]): void
  onmessage: ((event: { data: WorkerCommand }) => void) | null
}

interface WorkerCommand {
  type: "diagnostics"
  enabled: boolean
}

const scope = globalThis as unknown as WorkerScope
const receiver = new BridgeReceiver({
  publish: (message, transfer) => scope.postMessage(message, transfer),
})

scope.onmessage = ({ data }) => {
  if (data.type === "diagnostics") {
    receiver.setDiagnosticsEnabled(data.enabled)
  }
}

void receiver.start()
