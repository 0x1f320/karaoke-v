import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AudioMeterSnapshot } from "../shared/audioMeter"
import { registerAudioMeterIpc } from "./audioMeter"

const electron = vi.hoisted(() => ({
  openExternal: vi.fn(),
}))

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: electron.openExternal },
  systemPreferences: { getMediaAccessStatus: vi.fn(() => "unknown") },
}))

const SNAPSHOT: AudioMeterSnapshot = {
  state: "running",
  updatedAtMs: 1,
  momentaryLufs: -18,
  shortTermLufs: -19,
  longTermLufs: -20,
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
  beforeEach(() => {
    electron.openExternal.mockClear()
  })

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
          return {
            ...SNAPSHOT,
            state: "idle",
            momentaryLufs: null,
            shortTermLufs: null,
            longTermLufs: null,
          }
        },
      },
      "synth",
      () => "granted",
    )

    await expect(ipc.handlers.get("audioMeter:start")?.(null)).resolves.toEqual(SNAPSHOT)
    expect(ipc.handlers.get("audioMeter:read")?.(null)).toEqual({ ...SNAPSHOT, momentaryLufs: -20 })
    expect(ipc.handlers.get("audioMeter:stop")?.(null)).toEqual({
      ...SNAPSHOT,
      state: "idle",
      momentaryLufs: null,
      shortTermLufs: null,
      longTermLufs: null,
    })
    expect(calls).toEqual(["start:synth", "read", "stop"])
  })

  it("does not touch ScreenCaptureKit while screen recording permission is missing", async () => {
    const ipc = new Ipc()
    let started = false
    registerAudioMeterIpc(
      ipc,
      {
        startAudioMeter: () => {
          started = true
          return SNAPSHOT
        },
      },
      "synth",
      () => "denied",
    )

    await expect(ipc.handlers.get("audioMeter:start")?.(null)).resolves.toEqual({
      state: "unsupported",
      updatedAtMs: 0,
      momentaryLufs: null,
      shortTermLufs: null,
      longTermLufs: null,
      rmsDb: null,
      peakDb: null,
      sampleRate: null,
      channels: null,
      error: "screen recording permission is not granted",
    })
    expect(started).toBe(false)
    expect(ipc.handlers.get("audioMeter:read")?.(null)).toEqual({
      state: "unsupported",
      updatedAtMs: 0,
      momentaryLufs: null,
      shortTermLufs: null,
      longTermLufs: null,
      rmsDb: null,
      peakDb: null,
      sampleRate: null,
      channels: null,
      error: "screen recording permission is not granted",
    })
  })

  it("exposes a permission request for the toolbar toggle", async () => {
    const ipc = new Ipc()
    registerAudioMeterIpc(
      ipc,
      {},
      "synth",
      () => "denied",
      async () => true,
    )

    await expect(ipc.handlers.get("audioMeter:requestAccess")?.(null)).resolves.toBe(true)
  })

  it("asks the native helper for Screen Recording access from the toolbar toggle", async () => {
    const ipc = new Ipc()
    let started = false
    let requested = false
    registerAudioMeterIpc(
      ipc,
      {
        requestScreenCaptureAccess: () => {
          requested = true
          return true
        },
        startAudioMeter: () => {
          started = true
          return SNAPSHOT
        },
      },
      "synth",
      () => "denied",
    )

    await expect(ipc.handlers.get("audioMeter:requestAccess")?.(null)).resolves.toBe(true)
    expect(requested).toBe(true)
    expect(started).toBe(false)
    expect(electron.openExternal).not.toHaveBeenCalled()
  })

  it("uses native Screen Recording preflight for the start permission gate", async () => {
    const ipc = new Ipc()
    let started = false
    registerAudioMeterIpc(
      ipc,
      {
        preflightScreenCaptureAccess: () => true,
        startAudioMeter: () => {
          started = true
          return SNAPSHOT
        },
      },
      "synth",
    )

    await expect(ipc.handlers.get("audioMeter:start")?.(null)).resolves.toEqual(SNAPSHOT)
    expect(started).toBe(true)
  })
})
