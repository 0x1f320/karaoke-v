import { ipcMain } from "electron"
import { EMPTY_AUDIO_METER_SNAPSHOT, unsupportedAudioMeterSnapshot } from "../shared/audioMeter"
import { NATIVE_TARGET, type NativeHelper, native } from "../shared/native"

interface AudioMeterIpc {
  handle(channel: string, handler: (event: unknown) => unknown): void
}

export function registerAudioMeterIpc(
  ipc: AudioMeterIpc = ipcMain,
  helper: Partial<NativeHelper> = native,
  target = NATIVE_TARGET,
): void {
  ipc.handle("audioMeter:start", async () => {
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
