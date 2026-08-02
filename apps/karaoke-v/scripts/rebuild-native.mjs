import { spawnSync } from "node:child_process"

// Only the current platform's helper has anything to rebuild — the other one's
// binding.gyp resolves to an empty target — and asking @electron/rebuild for a
// module with no build directory fails outright rather than skipping it.

const helper =
  process.platform === "win32" ? "@karaoke-v/windows-helper" : "@karaoke-v/macos-helper"

if (process.platform !== "win32" && process.platform !== "darwin") {
  console.log(`rebuild-native: nothing to build on ${process.platform}`)
  process.exit(0)
}

const result = spawnSync("electron-rebuild", ["-f", "-o", helper], {
  stdio: "inherit",
  shell: true,
})

process.exit(result.status ?? 1)
