import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The app installs the bridge script into SynthV, so the built .lua has to
// travel with it, in the app's resources.
//
// It is published from here rather than copied by the app's own build because
// this is the build that cannot be cached: the script carries the commit it was
// built from, so a cached app build would go on republishing the copy that was
// current when it was cached.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "out", "overlay-bridge.lua")
const target = join(root, "..", "..", "apps", "karaoke-v", "resources", "synthv")

await mkdir(target, { recursive: true })
await copyFile(source, join(target, "overlay-bridge.lua"))
