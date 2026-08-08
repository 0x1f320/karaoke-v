import type { BridgeReceiverMessage } from "./bridgeReceiver"

export type BridgeWorkerCommand = { type: "diagnostics"; enabled: boolean } | { type: "stop" }

export type BridgeWorkerMessage =
  | BridgeReceiverMessage
  | { type: "shutdown-complete"; stopped: boolean }
