import { spawnSync } from "node:child_process"

// Not a shell script: `pnpm build` has to work from a Windows checkout too, where
// there is no `uname` and no way to run `./build.sh`.

if (process.platform !== "darwin") {
  console.log("macos-helper: skipping native build (macOS only)")
  process.exit(0)
}

// The addon is Node-API, so the binary Node loads is the one Electron loads too —
// there is no ABI rebuild step. `binding.js`/`binding.d.ts` land next to the .node;
// the hand-written index.js wraps them so the package stays importable on Windows
// without touching the binary.
const result = spawnSync(
  "napi",
  ["build", "--platform", "--release", "--js", "binding.js", "--dts", "binding.d.ts"],
  { stdio: "inherit", shell: true },
)
process.exit(result.status ?? 1)
