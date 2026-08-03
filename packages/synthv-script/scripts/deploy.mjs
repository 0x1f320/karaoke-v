import { copyFile, mkdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const built = join(root, "out", "overlay-bridge.js")

const EDITION = "Synthesizer V Studio 2"

function candidates() {
  const home = homedir()
  if (process.platform === "darwin") {
    return [join(home, "Library", "Application Support", "Dreamtonics", EDITION, "scripts")]
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")
    return [
      join(home, "Documents", "Dreamtonics", EDITION, "scripts"),
      join(appData, "Dreamtonics", EDITION, "scripts"),
    ]
  }
  return []
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function scriptsDir() {
  const override = process.env.SYNTHV_SCRIPTS_DIR
  if (override) {
    return override
  }
  for (const candidate of candidates()) {
    if (await isDirectory(candidate)) {
      return candidate
    }
  }
  return null
}

const dest = await scriptsDir()
if (!dest) {
  console.error(
    `synthv-script: could not find the ${EDITION} scripts directory.\n` +
      "Set SYNTHV_SCRIPTS_DIR to it and run again. Tried:\n" +
      candidates()
        .map((c) => `  ${c}`)
        .join("\n"),
  )
  process.exit(1)
}

await mkdir(dest, { recursive: true })
await copyFile(built, join(dest, "overlay-bridge.js"))
console.log(`synthv-script: deployed overlay-bridge.js -> ${dest}`)
