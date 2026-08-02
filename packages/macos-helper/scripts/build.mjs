import { spawnSync } from "node:child_process"

// Not a shell script: `pnpm build` has to work from a Windows checkout too, where
// there is no `uname` and no way to run `./build.sh`.

if (process.platform !== "darwin") {
  console.log("macos-helper: skipping native build (macOS only)")
  process.exit(0)
}

// Builds against the Node ABI (compile check + node usage). The Electron runtime
// needs an ABI-matched rebuild — apps/karaoke-v runs @electron/rebuild before dev/start.
const result = spawnSync("node-gyp", ["rebuild"], { stdio: "inherit", shell: true })
process.exit(result.status ?? 1)
