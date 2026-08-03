import { copyFile, mkdir, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(root, "out")

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

const built = (await readdir(outDir)).filter(
  (name) => name.endsWith(".js") || name.endsWith(".lua"),
)
if (built.length === 0) {
  console.error("synthv-script: nothing built. Run the build first.")
  process.exit(1)
}

await mkdir(dest, { recursive: true })
for (const name of built) {
  await copyFile(join(outDir, name), join(dest, name))
}
console.log(`synthv-script: deployed ${built.join(", ")} -> ${dest}`)
