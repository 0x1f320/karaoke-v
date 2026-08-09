import { ipcMain, systemPreferences } from "electron"
import { EMPTY_AUDIO_METER_SNAPSHOT, unsupportedAudioMeterSnapshot } from "../shared/audioMeter"
import { NATIVE_TARGET, type NativeHelper, native } from "../shared/native"

interface AudioMeterIpc {
  handle(channel: string, handler: (event: unknown) => unknown): void
}

type ScreenAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown"

function screenRecordingStatus(): ScreenAccessStatus {
  return process.platform === "darwin"
    ? systemPreferences.getMediaAccessStatus("screen")
    : "granted"
}

export function registerAudioMeterIpc(
  ipc: AudioMeterIpc = ipcMain,
  helper: Partial<NativeHelper> = native,
  target = NATIVE_TARGET,
  getScreenRecordingStatus = screenRecordingStatus,
): void {
  ipc.handle("audioMeter:start", async () => {
    if (getScreenRecordingStatus() !== "granted") {
      return unsupportedAudioMeterSnapshot("screen recording permission is not granted")
    }
    return (
      (await helper.startAudioMeter?.(target)) ??
      unsupportedAudioMeterSnapshot("audio meter is unavailable")
    )
  })
  ipc.handle("audioMeter:read", () => {
    return helper.readAudioMeter?.() ?? unsupportedAudioMeterSnapshot("audio meter is unavailable")
  })
  ipc.handle("audioMeter:stop", () => {
    return helper.stopAudioMeter?.() ?? EMPTY_AUDIO_METER_SNAPSHOT
  })
}
