import { app, Menu, type NativeImage, Notification, nativeImage, nativeTheme, Tray } from "electron"
import { APP_NAME } from "../shared/i18n"
import { onLanguageChanged, t } from "./i18n"
import { getPreferences, onPreferencesChanged, updatePreferences } from "./preferences"
import { resourcePath } from "./resources"
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
let unsubscribeLanguage: (() => void) | null = null

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

// The observer's state comes in as a bare string, so an unknown one has to land
// somewhere rather than showing a raw key.
const STATUS_KEYS: Record<Status, string> = {
  attached: "tray.status.attached",
  hidden: "tray.status.hidden",
  permission: "tray.status.permission",
  waiting: "tray.status.waiting",
}

function statusLabel(): string {
  return t(STATUS_KEYS[status] ?? STATUS_KEYS.waiting)
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
        label: t("tray.effects"),
        type: "checkbox",
        checked: getPreferences().effects,
        click: (item) => updatePreferences({ effects: item.checked }),
      },
      { label: t("tray.settings"), click: () => openSettingsWindow() },
      { type: "separator" },
      { label: t("tray.quit"), click: () => app.quit() },
    ]),
  )
}

function notifyNotRunning(): void {
  if (notified || status !== "waiting" || !Notification.isSupported()) {
    return
  }
  notified = true
  const notification = new Notification({
    title: t("tray.notRunning.title"),
    body: t("tray.notRunning.body"),
  })
  notification.on("click", () => openSettingsWindow())
  notification.show()
}

export function createTray(): void {
  if (tray) {
    return
  }
  tray = new Tray(trayIcon())
  tray.setToolTip(APP_NAME)
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
  unsubscribeLanguage = onLanguageChanged(rebuildMenu)

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
  unsubscribeLanguage?.()
  unsubscribeLanguage = null
  nativeTheme.off("updated", applyThemedIcon)
  tray?.destroy()
  tray = null
}
