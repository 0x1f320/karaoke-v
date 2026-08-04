import { spawnSync } from "node:child_process"

// Only the Windows helper needs this. It is a node-gyp addon, so its binary is
// built against whichever ABI compiled it; @electron/rebuild recompiles it for
// Electron's. The macOS helper is napi-rs, which @electron/rebuild cannot drive
// at all (it shells out to node-gyp) — and does not need it, because Node-API
// keeps one binary loadable by both Node and Electron.

if (process.platform !== "win32") {
  console.log(`rebuild-native: nothing to rebuild on ${process.platform}`)
  process.exit(0)
}

const result = spawnSync("electron-rebuild", ["-f", "-o", "@karaoke-v/windows-helper"], {
  stdio: "inherit",
  shell: true,
})

process.exit(result.status ?? 1)
