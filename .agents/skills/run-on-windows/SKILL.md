---
name: run-on-windows
description: Run this project on Windows — natively when the host is Windows, otherwise inside a Parallels Desktop Windows VM. Use when asked to run, launch, dev-test or debug karaoke-v on Windows from a Mac, to check the Windows build/helper, or when Parallels needs to be started or set up for that.
---

# Run on Windows

Bring up `karaoke-v` on Windows. On a Windows host that is just a local run; on macOS it means
driving a Parallels Desktop Windows VM from the command line.

Work only with shell commands so this skill behaves identically under Claude Code and Codex.
Every step below is a gate: if a gate fails, report exactly what failed and stop — do not
improvise around a missing VM, a missing toolchain, or a missing licence.

## Rules

- **Never install anything** — on the host or in the guest — without the user saying yes first.
  Propose the exact command and wait.
- **Never `prlctl stop`, `suspend`, `reset`, `delete`, `snapshot-delete`, or reconfigure a VM.**
  Starting a stopped VM is allowed; everything else that changes VM state needs the user's go-ahead.
- **Never build or run out of the shared folder.** `node_modules` and the node-gyp output of
  `packages/windows-helper` are platform- and ABI-specific; a Windows build inside the Mac
  checkout corrupts the host's `pnpm dev`. Always mirror into a guest-local directory.
- The repo root is `git rev-parse --show-toplevel`, not the current directory.

## 1. Host check

```sh
uname -s   # Darwin = macOS; MINGW*/MSYS*/CYGWIN* = Windows shell
```

- **Windows host** — no VM involved. Run in the repo root: `pnpm install`, then `pnpm dev`
  (that already runs `rebuild:native`, which builds `@karaoke-v/windows-helper` against Electron).
  Report the result and stop; the rest of this skill does not apply.
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
`{"vmUuid": "...", "vmName": "...", "guestPath": "C:\\dev\\karaoke-v"}` and reuse it on later runs,
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
per-user — Python, for one — is not on `PATH`.

So pass `--current-user` to every `prlctl exec` that installs, builds or runs:

```sh
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "whoami"   # expect <host>\<user>, not nt authority\system
```

If a previous run already installed as SYSTEM, hand the tree back before running:
`icacls C:\dev\karaoke-v /grant <user>:(OI)(CI)M /T /Q /C` (minutes; ~84k files).

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
"$PRLCTL" set <uuid> --shf-host-add karaoke-v --path <repo root> --mode ro
```

Read-only on purpose: it makes the "never build in the share" rule unbreakable rather than
merely stated. Remove it later with `--shf-host-del karaoke-v`.

Then mirror into `C:\dev\karaoke-v`, skipping everything platform-specific:

```sh
"$PRLCTL" exec <uuid> cmd.exe /c 'robocopy "\\Mac\karaoke-v" "C:\dev\karaoke-v" /MIR /R:1 /W:1 /XD node_modules .git out dist .turbo build .context /NFL /NDL /NJH /NJS'
```

`/R:1 /W:1` is not optional. Robocopy's default is **one million retries thirty seconds
apart**, so a single file held open in the guest hangs the copy for what looks like forever.

Robocopy's exit codes below 8 mean success (1 = files copied, 3 = copied + extras removed);
only >= 8 is a real failure.

This step is incremental: re-running the skill after edits just re-syncs.

## 6. Guest toolchain

Check, don't assume:

```sh
"$PRLCTL" exec <uuid> cmd.exe /c "node -v && pnpm -v"
```

Run this with `--current-user`; as SYSTEM it will miss a per-user Python and report
"Could not find any Python installation to use" from node-gyp even when one is installed.
If a per-user Python has to be used from a SYSTEM shell, point node-gyp at it:
`set "npm_config_python=C:\Users\<user>\AppData\Local\Programs\Python\<ver>\python.exe"`.

If something really is missing, propose and wait for a yes:

- Node: `winget install OpenJS.NodeJS.LTS`
- pnpm: `corepack enable && corepack prepare pnpm@10.15.0 --activate` (match `packageManager`)
- node-gyp toolchain for `packages/windows-helper`:
  `winget install Microsoft.VisualStudio.2022.BuildTools` with the
  "Desktop development with C++" workload, plus Python 3.

## 7. Install and run

```sh
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "cd /d C:\dev\karaoke-v && pnpm install --config.confirmModulesPurge=false"
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "cd /d C:\dev\karaoke-v && pnpm dev > C:\dev\dev.log 2>&1"
```

`--config.confirmModulesPurge=false` answers the "remove and reinstall from scratch?" prompt
that pnpm raises when the guest's `node_modules` predates the current lockfile; without it the
command waits on a keypress nobody can send.

The bridge script is a separate install. The overlay reads channels that only the script
writes, so a guest running an old script — or none — looks exactly like a broken app. SynthV's
scripts directory in the guest is `%APPDATA%\Dreamtonics\Synthesizer V Studio 2\scripts`
(not `Documents\`), and the editor picks up changes on **Scripts → Rescan**:

```sh
"$PRLCTL" exec --current-user <uuid> cmd.exe /c "copy /Y \"\\\\Mac\\karaoke-v\\packages\\synthv-script\\out\\overlay-bridge.lua\" \"%APPDATA%\\Dreamtonics\\Synthesizer V Studio 2\\scripts\\\""
```

`prlctl capture <uuid> --file shot.png` grabs the guest screen, but returns black unless the
Parallels window is actually on screen — ask the user to look rather than trusting a black
frame.

`pnpm dev` is long-running (electron-vite watch) — start it in the background and stream its
output rather than blocking. The Electron window appears on the VM's desktop; bring the VM
window forward so the user can see it.

If `rebuild:native` fails, the failure is almost always the missing C++ workload from step 6 —
report the node-gyp output verbatim instead of retrying blindly.

To stop the run: `"$PRLCTL" exec <uuid> cmd.exe /c "taskkill /IM electron.exe /F"`. Leave the VM
itself running unless the user asks otherwise.

## 8. Report

State plainly: which VM, the guest path, whether a sync/install/rebuild happened, whether the app
came up, and the stop command. If you stopped at a gate, say which gate and what the user has to
do next.
