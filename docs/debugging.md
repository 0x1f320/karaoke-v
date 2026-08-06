# Debugging

The overlay has no error state. When it goes wrong it draws nothing, or draws the right
thing in the wrong place — so the first move is never a grep, it is finding out **which
layer stopped answering**.

Work down the path. Each step below has a way to see its own state.

## Running it

```sh
pnpm install
pnpm dev            # turbo run dev --filter @voxpane/app
```

A checkout needs **Rust** (`rustup`) as well as Node: both platform helpers are Rust +
napi-rs, and `dev` depends on `^build`. Node-API means the binary is loadable by both Node
and Electron, so there is no rebuild-for-Electron step — if you find yourself looking for
`rebuild:native`, it does not exist.

On macOS the app needs **Accessibility** before it starts anything; the permissions window
is the gate. Screen Recording is *not* required — the occlusion check reads bounds, pid and
layer out of `CGWindowList`, none of which that grant covers.

Useful environment variable: `SYNTHV_SCRIPTS_DIR` overrides where the bridge script is
installed, for a SynthV install neither default covers. Turbo passes it through to `dev`.

### Where output goes

| Process | Where |
| --- | --- |
| main | the terminal running `pnpm dev` |
| overlay renderer | its own DevTools window — opened automatically in dev |
| toolbar renderer | its own DevTools window — opened automatically in dev |
| settings / permissions renderers | no DevTools by default; add `openDevTools` if you need one |
| the Lua script | **nowhere outside SynthV** — see below |

The script is the blind spot. It cannot log anywhere a developer can see, which is why it
reports through its side panel and why `dump` exists.

## 1. Is the app tracking SynthV?

Symptoms: no overlay at all, or an overlay in the wrong place, with SynthV plainly open.

- **The tray menu carries the answer.** Open the menu bar item (macOS) / tray icon
  (Windows): its first row, disabled, is the tracking status. The stick observer reports
  `attached` / `waiting` / `hidden` / `permission`. `waiting` with SynthV running means the
  target lookup failed — macOS matches on the app's localized name (`"synth"`), Windows on
  the executable (`"synthv-studio"`), in `shared/native.ts`. With SynthV closed the app
  also raises a notification after a 5 s grace period, which exists so a launch-at-login
  race does not fire it.
- `hidden` means the target is not showable. On macOS that includes being **≥15 % covered
  by a window in front**, as well as minimised or on another Space; on Windows it is only
  minimised or not visible — there is no occlusion check there. Both the overlay and the
  toolbar hide with it, which is deliberate, not a bug.
- `permission` is macOS only: Accessibility was revoked while running, and the gate comes
  back up.
- If the overlay is placed wrong on Windows, suspect the DIP transform before anything
  else — see [geometry](geometry.md#physical-pixels-points-and-dips).

Nothing below this step can work until this one says `attached`.

## 2. Is the script alive?

Open SynthV's side panel and find **Overlay Bridge**. It shows:

| Row | Read it as |
| --- | --- |
| `Version` | which build is loaded — a commit hash on a working copy, a version on a release |
| `Bridge` | `on` / `off`; there is a button to toggle it |
| `Channels` | the directory, plus `seq` and `notes` counters and the last error |
| `Transport` | what the script thinks playback is doing |
| `Notes published` | how many notes went out last time the schedule was sent |
| `Loop` | the inferred loop bounds, or `not seen yet` — they are only learned from a wrap |
| `Last error` | `none`, or the message from the tick that threw |

There are two buttons: **Disable/Enable**, and **Resend schedule**, which republishes the
note channel on demand — useful when you want to know whether a stale schedule or a stale
`rev` is the problem.

**No panel at all** means the script is not loaded. Either it was never installed, or it
landed after SynthV started — SynthV reads its scripts directory *at startup*. Use
**Scripts ▸ Rescan**, or restart it.

**A `Version` that is not the build you expect** is the single most common cause of a
confusing debugging session. See [Deploying a script change](#5-deploying-a-script-change).

**`seq` not advancing** means the tick loop is dead or the bridge is toggled off. Check
`Last error` — a tick that throws every time publishes nothing and looks exactly like a
bridge that is switched off, which is how a packing bug once went unnoticed.

## 3. Read the live state

```sh
pnpm --filter @voxpane/synthv-script dump
```

This decodes the channels the way the app does. With nothing running:

```
directory: /Users/you/Library/Application Support/voxpane/bridge

session.json: ENOENT: no such file or directory, ...
state: ENOENT: ...
notes: ENOENT: ...
```

Three `ENOENT`s answer "has the script ever published here?" — no.

What to look at when it does print:

- **`session.json`** — `layout` must match the app's `LAYOUT` in
  `shared/bridgeChannels.ts`. A mismatch means the app is (correctly) refusing every
  record, and the overlay will be silent with no other symptom. It also carries `host`,
  which is the fastest way to confirm the editor version and OS a user is actually running.
- **`seq`** — run `dump` twice a second apart. Not moving = the script is not ticking.
- **`status`** and **`at`** — does the playhead match what SynthV shows?
- **`rev` / `notesSeq`** — edit a note in SynthV and dump again. Both should change. If
  `rev` moves and `notesSeq` does not, the schedule failed to publish.
- **`notes`** — the note count, and each note's `bend`. `bend none` on every note means the
  engine has no computed pitch curve for that group, so the app is drawing a *synthesized*
  contour. That is a supported state, not a fault — but it is a completely different code
  path in `playback/pitch.ts`, and worth knowing before you debug a pitch bug in the wrong
  half of the file.
- The bend range printed as `[min..max] cents` should be plausible. Values near −6900 mean
  unvoiced frames are being read as pitch — see
  [synthv](synthv.md#the-computed-pitch-curve).

`dump` takes an optional directory argument, for reading channels from somewhere else.

## 4. Turn on debug mode

Settings ▸ General ▸ **Enable debug mode**. It draws, on the overlay itself:

- **every note's rectangle** — this is the note *set*, i.e. what the geometry layer thinks
  is on screen. If the boxes are wrong, the effects were never going to be right, and the
  bug is in [geometry](geometry.md), not in the effects.
- **the matched rectangle** for the sounding note — highlighted. Watch this while scrolling:
  if it hops between notes, that is a matching bug, not a drawing one.
- **reach bands** — how far each visible note's effect can travel vertically. Drawn only
  when pitch following is enabled *and* its mode moves the effect's position (anything but
  `intensity`). A band running past the piano roll's edge is an effect that will be masked
  away and appear to vanish.

Boxes right, effects wrong ⇒ the renderer. Boxes wrong ⇒ everything downstream is noise.

## 5. Deploying a script change

The app installs the `.lua` it was **built** with, comparing content hashes rather than
version numbers. So a stale script survives a rebuild of the app if the app's own bundled
copy did not change.

```sh
pnpm --filter @voxpane/synthv-script build    # typecheck → tstl → bundle into app resources
pnpm --filter @voxpane/synthv-script deploy   # copy straight into SynthV's scripts dir
```

Then **Scripts ▸ Rescan** in SynthV (or restart it). A rescan re-executes every script and
cancels the previous copy's timers, so the old bridge stops rather than publishing
alongside the new one. On macOS the app does this for you after installing; on Windows it
does not yet (#78).

Confirm what actually loaded by reading `Version` in the side panel — not by reasoning
about what you just ran.

> **`deploy` copies every `.lua` in `out/`**, which is the bridge *and* the Lua smoke
> script. The smoke script is a second side panel section that publishes to **the same
> channels** on its own 16 ms loop, so with both loaded two writers fight over `state` and
> `notes` and the app sees an incoherent mixture. If the panel shows *voxpane Lua smoke*
> alongside the bridge, delete `voxpane-lua-smoke.lua` from the scripts directory and
> rescan. The app's own installer only ever writes `overlay-bridge.lua`, so this is a
> hazard of local deploys only.

The smoke script exists as the end-to-end check for the Lua toolchain and the channel
layer — the smallest script that exercises every mechanism the bridge depends on, so a
toolchain regression shows up there rather than inside the bridge. It writes its own
`smoke.json` diagnostics channel, because nobody outside SynthV can read a side panel.

## 6. Windows

Use the repo's **`run-on-windows`** skill (`.agents/skills/run-on-windows/`), which covers
running natively on Windows and driving a Parallels VM from a Mac. Do not improvise around
it; it exists because the failure modes there are specific.

Two rules from it worth repeating: never build or run out of the shared folder — the
build output is platform- and ABI-specific and will corrupt the host checkout — and never
change VM state without asking.

From a macOS checkout, the Windows crate still compiles:

```sh
cd packages/windows-helper && cargo check --target x86_64-pc-windows-msvc
```

That is what actually type-checks the `#[cfg(windows)]` code; on any other target the crate
builds empty and tells you nothing.

## 7. Symptom → layer

| Symptom | Most likely layer | Check |
| --- | --- | --- |
| No overlay, SynthV open | window tracking | tray status; step 1 |
| Overlay present, never draws | the script, or a layout mismatch | side panel; `dump`; step 2–3 |
| Draws, then stops after a while | `seq` stalled — the script died mid-session | `Last error`; step 2 |
| Effects at the wrong time | the transport clock | `dump` `at` vs SynthV's playhead |
| Effects on the wrong note | matching | debug mode; [geometry](geometry.md#matching-a-note-to-a-rectangle) |
| Effects drift while scrolling | the frame transform | debug mode boxes while scrolling |
| Effects one lane off vertically | the vertical reference | macOS: the tracked chip; Windows: `refY` |
| Everything offset on a scaled display | the DIP transform | Windows only; [geometry](geometry.md#physical-pixels-points-and-dips) |
| Notes stale after an edit | `rev` / `notesSeq` | `dump` before and after the edit |
| Effect fires in empty space, or off-screen | the pitch curve | `bend` ranges in `dump`; [synthv](synthv.md#the-computed-pitch-curve) |
| Old effects linger after a group change | schedule revision handling | #90 |
| Works on one platform only | the geometry split | [geometry](geometry.md#two-platforms-two-strategies) |

## 8. Before changing anything

```sh
pnpm check        # Biome lint + format
pnpm typecheck
pnpm test         # Vitest, colocated
```

The tests cover the pure logic — bridge decoding, preferences, the transport clock, note
location, frame math, DIP transforms. Anything needing Electron, a native addon or a real
piano roll is out of scope, so **a green test run says nothing about whether the overlay
lines up**. If you fixed a geometry bug, the honest verification is the app plus debug
mode; if the fix was arithmetic, extract it into a pure function and test that.
