import { describe, expect, it } from "vitest"
import type { BridgeState } from "../shared/bridgeChannels"
import { BridgeRuntime } from "./bridgeRuntime"

const STATE = { seq: 9 } as BridgeState

describe("BridgeRuntime", () => {
  it("keeps the latest state pushed independently of renderer reads", () => {
    const runtime = new BridgeRuntime({
      decodeState: () => STATE,
      decodeNotes: () => null,
    })

    expect(runtime.readState()).toBeNull()

    runtime.acceptState(new Uint8Array(256))

    expect(runtime.readState()).toBe(STATE)
  })
})
