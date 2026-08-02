import { spawnSync } from "node:child_process"

// A shell script cannot be the build entry point here: on Windows the package
// scripts run under cmd, where there is no `uname` and no `./build.sh`.

if (process.platform !== "win32") {
  console.log("windows-helper: skipping native build (Windows only)")
  process.exit(0)
}

// N-API keeps the ABI stable across Node and Electron, so this one build serves
// both runtimes and @electron/rebuild has nothing to do for this package.
const result = spawnSync("node-gyp", ["rebuild"], { stdio: "inherit", shell: true })
process.exit(result.status ?? 1)
