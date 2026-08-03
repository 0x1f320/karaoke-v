import path from "node:path"
import { app, Menu, type NativeImage, Notification, nativeImage, nativeTheme, Tray } from "electron"
import { getPreferences, onPreferencesChanged, updatePreferences } from "./preferences"
import { openSettingsWindow } from "./settings"

// The menu bar item (macOS) / tray icon (Windows). The dock icon is hidden and
// the overlay and toolbar only exist while SynthV is attached, so with SynthV
// closed this is the app's only visible surface — and the only way to reach
// settings or quit.

/**
 * How long SynthV gets to turn up before we say it is not running. The stick
 * observer reports "waiting" the moment it fails to find the window, which on a
 * launch-at-login is simply the race between the two apps starting.
 */
const NOT_RUNNING_GRACE_MS = 5000

type Status = "attached" | "waiting" | "hidden" | "permission"

let tray: Tray | null = null
let status: Status = "waiting"
let graceTimer: NodeJS.Timeout | null = null
let notified = false
let unsubscribePreferences: (() => void) | null = null

// Assets ship outside the bundle, so the packaged path is Electron's resources
// directory rather than anything relative to the compiled main process.
function resourcePath(...parts: string[]): string {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "..", "resources")
  return path.join(root, ...parts)
}

function trayIcon(): NativeImage {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromPath(resourcePath("tray", "trayTemplate.png"))
    // A template image is drawn from its alpha alone, which is what lets the
    // menu bar invert it for dark mode and for the selected state.
    image.setTemplateImage(true)
    return image
  }
  // The Windows tray does no such inversion, so the polarity is ours to pick.
  // shouldUseDarkColors follows the app theme, which a user can set apart from
  // the taskbar's; they match under either of the two one-click presets.
  const file = nativeTheme.shouldUseDarkColors ? "tray-white.ico" : "tray-black.ico"
  return nativeImage.createFromPath(resourcePath("tray", file))
}

function applyThemedIcon(): void {
  if (tray && !tray.isDestroyed()) {
    tray.setImage(trayIcon())
  }
}

function statusLabel(): string {
  switch (status) {
    case "attached":
      return "SynthV: 연결됨"
    case "hidden":
      return "SynthV: 창 숨김"
    case "permission":
      return "SynthV: 접근 권한 필요"
    default:
      return "SynthV: 실행 중 아님"
  }
}

function rebuildMenu(): void {
  if (!tray) {
    return
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLabel(), enabled: false },
      { type: "separator" },
      {
        label: "노트 이펙트",
        type: "checkbox",
        checked: getPreferences().effects,
        click: (item) => updatePreferences({ effects: item.checked }),
      },
      { label: "설정…", click: () => openSettingsWindow() },
      { type: "separator" },
      { label: "karaoke-v 종료", click: () => app.quit() },
    ]),
  )
}

function notifyNotRunning(): void {
  if (notified || status !== "waiting" || !Notification.isSupported()) {
    return
  }
  notified = true
  const notification = new Notification({
    title: "SynthV가 실행되고 있지 않습니다",
    body: "SynthV를 열면 karaoke-v가 자동으로 연결됩니다.",
  })
  notification.on("click", () => openSettingsWindow())
  notification.show()
}

export function createTray(): void {
  if (tray) {
    return
  }
  tray = new Tray(trayIcon())
  tray.setToolTip("karaoke-v")
  rebuildMenu()

  // macOS opens the menu on either button; Windows reserves the left click, and
  // settings is the only thing worth opening.
  if (process.platform === "win32") {
    tray.on("click", () => openSettingsWindow())
  }

  nativeTheme.on("updated", applyThemedIcon)

  // The toolbar and the settings window can both flip effects, and the tray menu
  // is built ahead of being shown, so its checkbox has to be told.
  unsubscribePreferences = onPreferencesChanged(rebuildMenu)

  graceTimer = setTimeout(() => {
    graceTimer = null
    notifyNotRunning()
  }, NOT_RUNNING_GRACE_MS)
}

export function setTrayStatus(next: string): void {
  const state = next as Status
  if (state === status) {
    return
  }
  status = state
  rebuildMenu()
}

export function hasTray(): boolean {
  return tray !== null && !tray.isDestroyed()
}

export function destroyTray(): void {
  if (graceTimer) {
    clearTimeout(graceTimer)
    graceTimer = null
  }
  unsubscribePreferences?.()
  unsubscribePreferences = null
  nativeTheme.off("updated", applyThemedIcon)
  tray?.destroy()
  tray = null
}
