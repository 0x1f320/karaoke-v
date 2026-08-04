import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The app installs the bridge script into SynthV, so the built .lua has to
// travel with it. It is build output of another package, so it is copied into
// the resources directory before every dev run and build rather than committed.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(app, "..", "..", "packages", "synthv-script", "out", "overlay-bridge.lua")
const targetDir = join(app, "resources", "synthv")

try {
  await mkdir(targetDir, { recursive: true })
  await copyFile(source, join(targetDir, "overlay-bridge.lua"))
} catch (error) {
  console.error(
    `karaoke-v: could not bundle the bridge script from ${source}.\n` +
      "Build @karaoke-v/synthv-script first.\n" +
      error,
  )
  process.exit(1)
}
