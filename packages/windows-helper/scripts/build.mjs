import { spawnSync } from "node:child_process"

// A shell script cannot be the build entry point here: on Windows the package
// scripts run under cmd, where there is no `uname` and no `./build.sh`.

if (process.platform !== "win32") {
  console.log("windows-helper: skipping native build (Windows only)")
  process.exit(0)
}

// Node-API keeps the ABI stable across Node and Electron, so this one build serves
// both runtimes and there is no @electron/rebuild step. `binding.js`/`binding.d.ts`
// land next to the .node; the hand-written index.js wraps them so the package
// stays importable on macOS without touching the binary.
const result = spawnSync(
  "napi",
  ["build", "--platform", "--release", "--js", "binding.js", "--dts", "binding.d.ts"],
  { stdio: "inherit", shell: true },
)
process.exit(result.status ?? 1)
