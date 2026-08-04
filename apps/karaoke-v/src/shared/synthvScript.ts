// Where the bridge script has to end up. SynthV loads scripts from one
// directory per install, and the app ships the same .lua it parses the channels
// of — so "which copy is installed" is a content question, not a version number
// the script could carry and get wrong.

export const BRIDGE_SCRIPT_FILE = "overlay-bridge.lua"

const VENDOR = "Dreamtonics"
const EDITION = "Synthesizer V Studio 2"
const SCRIPTS = "scripts"

export interface ScriptHost {
  platform: NodeJS.Platform
  home: string
  /** app.getPath("documents"): the Windows default, which a user can relocate. */
  documents?: string
  appData?: string
}

/** Ordered by how likely SynthV is to be using it; the first existing one wins. */
export function scriptsDirectoryCandidates(host: ScriptHost, separator = "/"): string[] {
  const join = (...parts: string[]) => parts.join(separator)

  if (host.platform === "darwin") {
    return [join(host.home, "Library", "Application Support", VENDOR, EDITION, SCRIPTS)]
  }
  if (host.platform === "win32") {
    const documents = host.documents ?? join(host.home, "Documents")
    const appData = host.appData ?? join(host.home, "AppData", "Roaming")
    return [join(documents, VENDOR, EDITION, SCRIPTS), join(appData, VENDOR, EDITION, SCRIPTS)]
  }
  return []
}
