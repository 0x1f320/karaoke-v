---
name: run-on-windows
description: Run this project on Windows — natively when the host is Windows, otherwise inside a Parallels Desktop Windows VM. Use when asked to run, launch, dev-test or debug voxpane on Windows from a Mac, to check the Windows build/helper, or when Parallels needs to be started or set up for that.
---

# Run on Windows

Bring up `voxpane` on Windows. On a Windows host that is just a local run; on macOS it means
driving a Parallels Desktop Windows VM from the command line.

Getting the app running is only half of it: the overlay draws nothing without the bridge
script, and on Windows the geometry comes from a different source than on macOS. Read
[`docs/geometry.md`](../../../docs/geometry.md) before debugging anything positional here, and
[`docs/debugging.md`](../../../docs/debugging.md) for what to check once it is up.

Work only with shell commands so this skill behaves identically under Claude Code and Codex.
Every step below is a gate: if a gate fails, report exactly what failed and stop — do not
improvise around a missing VM, a missing toolchain, or a missing licence.

## Rules

- **Never install anything** — on the host or in the guest — without the user saying yes first.
  Propose the exact command and wait.
- **Never `prlctl stop`, `suspend`, `reset`, `delete`, `snapshot-delete`, or reconfigure a VM.**
  Starting a stopped VM is allowed; everything else that changes VM state needs the user's go-ahead.
- **Never build or run out of the shared folder.** `node_modules`, Cargo's `target/` and the
  `.node` that `napi build` emits into `packages/windows-helper` are all platform-specific; a
  Windows build inside the Mac checkout corrupts the host's `pnpm dev`. Always mirror into a
  guest-local directory.
- The repo root is `git rev-parse --show-toplevel`, not the current directory.

## 1. Host check

```sh
uname -s   # Darwin = macOS; MINGW*/MSYS*/CYGWIN* = Windows shell
```

- **Windows host** — no VM involved. Run in the repo root: `pnpm install`, then `pnpm dev`.
  Turbo's `dev` depends on `^build`, so that builds `@voxpane/windows-helper` first — one
  `napi build` producing a Node-API binary that Node *and* Electron both load, which is why
  there is no `@electron/rebuild` step. Report the result and stop; the rest of this skill
  does not apply.
- **macOS host** — continue to step 2.
- **Anything else** — say Windows runs are only supported from Windows or macOS + Parallels, and stop.

## 2. Parallels Desktop: running → installed → absent

Resolve `prlctl` first; it is not always on `PATH`:

```sh
PRLCTL=$(command -v prlctl || echo /usr/local/bin/prlctl)
```

Then walk the ladder:

1. **Running?** `pgrep -x prl_disp_service` (the dispatcher — `prlctl` needs it) and
   `"$PRLCTL" list --all` succeeding. If both are fine, go to step 3.
2. **Installed?** `test -x "$PRLCTL"` or `test -d "/Applications/Parallels Desktop.app"`.
   If installed but not running: `open -a "Parallels Desktop"`, then poll
   `"$PRLCTL" list --all` every 3s for up to 60s. If it never answers, report the last error
   (an expired licence or a pending upgrade prompt shows up here) and stop.
3. **Not installed** — stop and offer, do not act:

   > Parallels Desktop isn't installed. I can install it with
   > `brew install --cask parallels`, or you can get it from
   > <https://www.parallels.com/products/desktop/>. It's a paid product and needs a licence
   > and a Windows VM before I can run anything. Want me to install it?

   Only run the install after an explicit yes; afterwards the user still has to sign in and
   create a Windows VM, so hand back at that point.

## 3. Pick the Windows VM

```sh
"$PRLCTL" list --all --json
```

Identify the Windows guests (`"$PRLCTL" list <uuid> --info | grep -i '^OS:'` if the names are
ambiguous). One Windows VM → use it. Several → ask which one. None → stop and tell the user a
Windows VM has to be created in Parallels first (the Parallels installer assistant does this).

Cache the choice and the guest path in `.context/run-on-windows.json` (gitignored) as
`{"vmUuid": "...", "vmName": "...", "guestPath": "C:\\dev\\voxpane"}` and reuse it on later runs,
re-validating that the UUID still exists.

## 4. Boot the guest

If status is not `running`: `"$PRLCTL" start <uuid>`, then poll `"$PRLCTL" list <uuid> --json`
for `"status": "running"` (up to 2 min).

Windows being "running" is not enough — Parallels Tools must be up and a user logged in:

```sh
"$PRLCTL" exec <uuid> cmd.exe /c echo ready
```

Poll every 5s for up to 3 min. If it keeps failing, report that `prlctl exec` is unavailable —
usually Parallels Tools are missing or the guest sits at the lock screen — and stop. The Electron
window needs an interactive desktop session anyway.

## 4b. Run everything as the logged-in user

`prlctl exec` runs as **`nt authority\system` in session 0** by default. That breaks three
things at once: the Electron window opens on an invisible desktop, `pnpm install` leaves
`node_modules` that the real user cannot open (`EPERM` on `turbo`), and anything installed
per-user — `rustup`'s `cargo`/`napi` shims, for one — is not on `PATH`.

So pass `--current-user` to every `prlctl exec` that installs, builds or runs:

```sh
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "whoami"   # expect <host>\<user>, not nt authority\system
```

If a previous run already installed as SYSTEM, hand the tree back before running:
`icacls C:\dev\voxpane /grant <user>:(OI)(CI)M /T /Q /C` (minutes; ~84k files).

## 5. Mirror the repo into the guest

The Mac home directory is `\\Mac\Home` inside the guest — but by default Parallels shares
only Desktop, Documents and Downloads through it, so a repo elsewhere in `$HOME` is not
there. Check first:

```sh
"$PRLCTL" exec <uuid> cmd.exe /c "dir \\Mac\<share>"
```

If the repo is not reachable, propose adding a **read-only** share for it and wait for a yes
(this changes VM configuration):

```sh
"$PRLCTL" set <uuid> --shf-host on
"$PRLCTL" set <uuid> --shf-host-add voxpane --path <repo root> --mode ro
```

Read-only on purpose: it makes the "never build in the share" rule unbreakable rather than
merely stated. Remove it later with `--shf-host-del voxpane`.

Then mirror into `C:\dev\voxpane`, skipping everything platform-specific:

```sh
"$PRLCTL" exec <uuid> cmd.exe /c 'robocopy "\\Mac\voxpane" "C:\dev\voxpane" /MIR /R:1 /W:1 /XD node_modules .git out dist .turbo build target .context /NFL /NDL /NJH /NJS'
```

`target` is in that list because it is Cargo's output directory for both helper crates, and
it is both large and useless in the guest.

`/R:1 /W:1` is not optional. Robocopy's default is **one million retries thirty seconds
apart**, so a single file held open in the guest hangs the copy for what looks like forever.

Robocopy's exit codes below 8 mean success (1 = files copied, 3 = copied + extras removed);
only >= 8 is a real failure.

This step is incremental: re-running the skill after edits just re-syncs.

## 6. Guest toolchain

`packages/windows-helper` is **Rust + napi-rs**, not node-gyp — so the guest needs a Rust
toolchain and the MSVC linker, and needs no Python at all. The `napi` CLI itself is a
devDependency, so `pnpm install` supplies it.

Check, don't assume:

```sh
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "node -v && pnpm -v && rustc -Vv"
```

Use `--current-user` for this: `rustup` installs per-user, so a SYSTEM shell reports no
`cargo`/`rustc` even on a machine that has them.

`rustc -Vv`'s `host:` line is the answer to a question worth asking early — **a Parallels VM
on an Apple Silicon Mac is Windows on ARM**, so the host triple is `aarch64-pc-windows-msvc`,
not `x86_64`. Both are declared in the package's `napi.targets`, so either builds; just do
not go looking for an x64 binary on an ARM guest.

If something really is missing, propose and wait for a yes:

- Node: `winget install OpenJS.NodeJS.LTS`
- pnpm: `corepack enable && corepack prepare pnpm@10.15.0 --activate` (match `packageManager`)
- Rust: `winget install Rustlang.Rustup`, which installs the MSVC-host toolchain by default
- The linker Cargo needs: `winget install Microsoft.VisualStudio.2022.BuildTools` with the
  **Desktop development with C++** workload. Without it `cargo build` fails at `link.exe`,
  which is the one Rust failure that looks like a Rust problem and is not.

## 7. Install and run

```sh
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "cd /d C:\dev\voxpane && pnpm install --config.confirmModulesPurge=false"
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "cd /d C:\dev\voxpane && pnpm dev > C:\dev\dev.log 2>&1"
```

`--config.confirmModulesPurge=false` answers the "remove and reinstall from scratch?" prompt
that pnpm raises when the guest's `node_modules` predates the current lockfile; without it the
command waits on a keypress nobody can send.

`pnpm dev` is long-running (electron-vite watch) — start it in the background and stream its
output rather than blocking. The Electron window appears on the VM's desktop; bring the VM
window forward so the user can see it.

If the native build fails, it is almost always the missing C++ workload from step 6 — report
the Cargo output verbatim instead of retrying blindly.

`prlctl capture <uuid> --file shot.png` grabs the guest screen, but returns black unless the
Parallels window is actually on screen — ask the user to look rather than trusting a black
frame.

To stop the run: `"$PRLCTL" exec <uuid> cmd.exe /c "taskkill /IM electron.exe /F"`. Leave the VM
itself running unless the user asks otherwise.

### The bridge script

The overlay reads channels that only the script writes, so a guest running an old script — or
none — looks exactly like a broken app, with no error anywhere.

**The app installs the script itself**, on every start: it copies the `overlay-bridge.lua`
bundled in its own resources into SynthV's scripts directory when the bytes differ. So
`pnpm dev` is normally enough. Two Windows-specific catches:

- **Nothing triggers a rescan here.** macOS presses *Scripts ▸ Rescan* through the
  Accessibility API; Windows has no equivalent yet (#78). SynthV only reads its scripts
  directory at startup, so after the app first writes the file, **restart SynthV**.
- **Which directory got it** is the first of these that exists — on a stock guest that has
  been the second:

  1. `%USERPROFILE%\Documents\Dreamtonics\Synthesizer V Studio 2\scripts`
  2. `%APPDATA%\Dreamtonics\Synthesizer V Studio 2\scripts`

  `SYNTHV_SCRIPTS_DIR` overrides both, and Turbo passes that variable through to `dev`.

To iterate on the script without restarting the app, copy it in by hand and restart SynthV:

```sh
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "copy /Y \"C:\\dev\\voxpane\\packages\\synthv-script\\out\\overlay-bridge.lua\" \"%APPDATA%\\Dreamtonics\\Synthesizer V Studio 2\\scripts\\\""
```

Then **confirm what actually loaded** by reading the `Version` row of the *Overlay Bridge*
side panel section — never by reasoning about what you just copied. If no such section
exists, the script is not loaded at all.

## 8. Report

State plainly: which VM, the guest path, whether a sync/install/native build happened, whether
the app came up, **which script version the side panel showed**, and the stop command. If you
stopped at a gate, say which gate and what the user has to do next.

If the app is up but drawing nothing, that is a debugging job, not a run job — hand over to
[`docs/debugging.md`](../../../docs/debugging.md) rather than guessing.
