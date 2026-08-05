import { spawnSync } from "node:child_process"

// Not a shell script: `pnpm build` has to work from a Windows checkout too, where
// there is no `uname` and no way to run `./build.sh`.

if (process.platform !== "darwin") {
  console.log("macos-helper: skipping native build (macOS only)")
  process.exit(0)
}

// Both macOS architectures, always: the app ships as a universal bundle, and the
// generated loader picks the .node by process.arch at runtime, so a missing slice
// only shows up as a broken app on the other kind of Mac.
const TARGETS = ["aarch64-apple-darwin", "x86_64-apple-darwin"]

function run(command, args) {
  return spawnSync(command, args, { stdio: "inherit", shell: true }).status ?? 1
}

for (const target of TARGETS) {
  // A fresh checkout has only the host's std, and cargo's failure for a missing
  // one reads like a compile error rather than a setup step.
  if (run("rustup", ["target", "add", target]) !== 0) {
    process.exit(1)
  }

  // The addon is Node-API, so the binary Node loads is the one Electron loads too —
  // there is no ABI rebuild step. `binding.js`/`binding.d.ts` land next to the .node;
  // the hand-written index.js wraps them so the package stays importable on Windows
  // without touching the binary.
  const status = run("napi", [
    "build",
    "--platform",
    "--release",
    "--target",
    target,
    "--js",
    "binding.js",
    "--dts",
    "binding.d.ts",
  ])
  if (status !== 0) {
    process.exit(status)
  }
}
