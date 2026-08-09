import { createHash } from "node:crypto"
import fs from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { NATIVE_TARGET, native } from "../shared/native"
import { BRIDGE_SCRIPT_FILE, scriptsDirectoryCandidates } from "../shared/synthvScript"
import { resourcePath } from "./resources"

// The app ships the bridge script it was built against and keeps SynthV's copy
// equal to it. Not a version number: a script installed by hand, or left behind
// by an older build, carries nothing to compare — the bytes do.
//
// Rewriting only on a difference matters. SynthV reads its scripts directory
// when it starts, so a copy that changes nothing should not touch the file.
// Rescan is separate: it also restarts the side-panel timer for an already
// installed script, which is what reconnects Lua to a fresh app session after
// the app restarts.

function digest(file: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  } catch {
    return null
  }
}

function bundledScript(): string {
  return resourcePath("synthv", BRIDGE_SCRIPT_FILE)
}

function scriptsDirectory(): string | null {
  // The same escape hatch the repo's deploy script has, for an install that
  // lives somewhere neither default covers.
  const override = process.env.SYNTHV_SCRIPTS_DIR
  if (override) {
    return override
  }
  const candidates = scriptsDirectoryCandidates(
    {
      platform: process.platform,
      home: homedir(),
      documents: process.platform === "win32" ? app.getPath("documents") : undefined,
      appData: process.env.APPDATA,
    },
    path.sep,
  )
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function rescanInstalledScript(): void {
  if (native.rescanScripts?.(NATIVE_TARGET)) {
    console.log("asked SynthV to rescan its scripts")
  }
}

/**
 * Nothing here is fatal: SynthV may not be installed yet, and the overlay is
 * still allowed to run without a bridge — it simply finds no channels.
 */
export function installBridgeScript(): void {
  const bundled = bundledScript()
  const source = digest(bundled)
  if (!source) {
    console.error("the bridge script is missing from this build:", bundled)
    return
  }

  const directory = scriptsDirectory()
  if (!directory) {
    console.warn("no Synthesizer V scripts directory found; the bridge script was not installed")
    return
  }

  const target = path.join(directory, BRIDGE_SCRIPT_FILE)
  if (digest(target) === source) {
    rescanInstalledScript()
    return
  }
  try {
    fs.copyFileSync(bundled, target)
    console.log("installed the SynthV bridge script:", target)
  } catch (error) {
    console.error("failed to install the SynthV bridge script:", error)
    return
  }

  // SynthV reads the directory when it starts, so without this the copy that
  // just landed would sit there until the user restarted it. A rescan re-executes
  // the file and drops the previous copy's timers, so the old bridge stops
  // rather than publishing alongside the new one.
  rescanInstalledScript()
}
