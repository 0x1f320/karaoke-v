import { describe, expect, it } from "vitest"
import type { AudioMeterSnapshot } from "../shared/audioMeter"
import { registerAudioMeterIpc } from "./audioMeter"

const SNAPSHOT: AudioMeterSnapshot = {
  state: "running",
  updatedAtMs: 1,
  momentaryLufs: -18,
  rmsDb: -17,
  peakDb: -3,
  sampleRate: 48000,
  channels: 2,
}

class Ipc {
  handlers = new Map<string, (_event: unknown) => unknown>()

  handle(channel: string, handler: (_event: unknown) => unknown): void {
    this.handlers.set(channel, handler)
  }
}

describe("registerAudioMeterIpc", () => {
  it("routes audio meter calls through the main process native helper", async () => {
    const calls: string[] = []
    const ipc = new Ipc()
    registerAudioMeterIpc(
      ipc,
      {
        startAudioMeter: (target) => {
          calls.push(`start:${target}`)
          return SNAPSHOT
        },
        readAudioMeter: () => {
          calls.push("read")
          return { ...SNAPSHOT, momentaryLufs: -20 }
        },
        stopAudioMeter: () => {
          calls.push("stop")
          return { ...SNAPSHOT, state: "idle", momentaryLufs: null }
        },
      },
      "synth",
    )

    await expect(ipc.handlers.get("audioMeter:start")?.(null)).resolves.toEqual(SNAPSHOT)
    expect(ipc.handlers.get("audioMeter:read")?.(null)).toEqual({ ...SNAPSHOT, momentaryLufs: -20 })
    expect(ipc.handlers.get("audioMeter:stop")?.(null)).toEqual({
      ...SNAPSHOT,
      state: "idle",
      momentaryLufs: null,
    })
    expect(calls).toEqual(["start:synth", "read", "stop"])
  })
})
