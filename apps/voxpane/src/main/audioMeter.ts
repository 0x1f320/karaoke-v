import { ipcMain, shell, systemPreferences } from "electron"
import { EMPTY_AUDIO_METER_SNAPSHOT, unsupportedAudioMeterSnapshot } from "../shared/audioMeter"
import { NATIVE_TARGET, type NativeHelper, native } from "../shared/native"

interface AudioMeterIpc {
  handle(channel: string, handler: (event: unknown) => unknown): void
}

type ScreenAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown"
type RequestScreenRecordingAccess = () => boolean | Promise<boolean>

const SCREEN_RECORDING_PANE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

function screenRecordingStatus(): ScreenAccessStatus {
  return process.platform === "darwin"
    ? systemPreferences.getMediaAccessStatus("screen")
    : "granted"
}

function blockedScreenRecordingStatus(status: ScreenAccessStatus): boolean {
  return status === "denied" || status === "restricted"
}

function missingScreenRecordingSnapshot() {
  return unsupportedAudioMeterSnapshot("screen recording permission is not granted")
}

async function requestScreenRecordingAccess(
  helper: Partial<NativeHelper>,
  target: string,
  getScreenRecordingStatus: () => ScreenAccessStatus,
): Promise<boolean> {
  if (process.platform !== "darwin" || getScreenRecordingStatus() === "granted") {
    return true
  }
  if (blockedScreenRecordingStatus(getScreenRecordingStatus())) {
    void shell.openExternal(SCREEN_RECORDING_PANE)
    return false
  }
  const snapshot =
    (await helper.startAudioMeter?.(target)) ??
    unsupportedAudioMeterSnapshot("audio meter is unavailable")
  helper.stopAudioMeter?.()
  return snapshot.state !== "unsupported" && snapshot.state !== "error"
}

export function registerAudioMeterIpc(
  ipc: AudioMeterIpc = ipcMain,
  helper: Partial<NativeHelper> = native,
  target = NATIVE_TARGET,
  getScreenRecordingStatus = screenRecordingStatus,
  requestAccess: RequestScreenRecordingAccess = () =>
    requestScreenRecordingAccess(helper, target, getScreenRecordingStatus),
): void {
  let lastStartFailure = null as ReturnType<typeof unsupportedAudioMeterSnapshot> | null

  ipc.handle("audioMeter:requestAccess", () => requestAccess())
  ipc.handle("audioMeter:start", async () => {
    if (blockedScreenRecordingStatus(getScreenRecordingStatus())) {
      lastStartFailure = missingScreenRecordingSnapshot()
      return lastStartFailure
    }
    const snapshot =
      (await helper.startAudioMeter?.(target)) ??
      unsupportedAudioMeterSnapshot("audio meter is unavailable")
    lastStartFailure =
      snapshot.state === "unsupported" || snapshot.state === "error" ? snapshot : null
    return snapshot
  })
  ipc.handle("audioMeter:read", () => {
    if (lastStartFailure) {
      return lastStartFailure
    }
    return helper.readAudioMeter?.() ?? unsupportedAudioMeterSnapshot("audio meter is unavailable")
  })
  ipc.handle("audioMeter:stop", () => {
    lastStartFailure = null
    return helper.stopAudioMeter?.() ?? EMPTY_AUDIO_METER_SNAPSHOT
  })
}
