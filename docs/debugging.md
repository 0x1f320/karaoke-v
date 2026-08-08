# Debugging

> Korean: [debugging.ko.md](debugging.ko.md). English is the source of truth.

When the overlay fails, establish which owner stopped answering: app/window tracking, Lua
publication, pipe reception, snapshot composition, native geometry, or rendering. Do not
open a channel endpoint to inspect it; opening a FIFO or Named Pipe changes the transport.

## Running it

```sh
pnpm install
pnpm dev
```

The main process writes to the terminal; overlay DevTools carries renderer output. Lua has
no externally readable log, so its side panel and the non-consuming inspector are the
operational sources of truth.

## App and overlay

The tray status reports whether the app is attached, waiting, hidden, or blocked by
Accessibility permissions. Nothing in the bridge can help until SynthV is attached. The
overlay's debug mode then separates bad geometry from bad effects: incorrect debug note
rectangles mean fix the schedule/scroll/native anchor path first.

## Script side panel

Open SynthV's **Overlay Bridge** side panel. It shows the loaded version, whether the bridge
is on, the connection and app session, current sequence counters, transport state, note
count, inferred loop bounds, and last error. `rendezvous unavailable` means the app has not
advertised endpoints; an endpoint open/write failure or `EPIPE` means Lua closed the set and
will wait for a different app session or a newer heartbeat before retrying. A first connection
also waits for the same session's heartbeat to advance, so `disconnected` can remain visible
until a later 240 ms validation observes the next heartbeat second. A non-advancing sequence
with a connected app points to a stopped Lua tick or its displayed last error.

Use **Resend schedule** to request a full schedule deliberately. On a clean client reconnect
the script also sends an exact notes/scroll/state snapshot automatically.

## Pipe-session inspector

```sh
pnpm --filter @voxpane/synthv-script run dump
pnpm --filter @voxpane/synthv-script run dump -- /path/to/bridge
```

`dump` first `lstat`s `pipe-session`; `ENOENT` is unavailable, while a symlink or any
non-regular node is malformed and is never read. It then decodes the exact 128-byte VPR1
record and checksum, prints the app session, heartbeat age, freshness, and all three derived
endpoint names. The app opens the regular record without truncation, verifies that the opened
handle and path identify the same regular file, performs one positioned 128-byte write, and
only then truncates it. An absent record is created exclusively; recovery may unlink then
recreate it. The regular-or-absent gate therefore treats a recovery `ENOENT` as unavailable
and any short or invalid record as malformed. On macOS `dump` uses `lstat` only for endpoints
and reports `fifo`, `missing`, `non-fifo`, or `symlink`; it never opens them. On Windows it
prints derived Named Pipe names and does not probe by connecting.

| Output | Meaning | Exit |
| --- | --- | --- |
| `pipe-session: unavailable` | app stopped, not yet started, or rendezvous withdrawn | 0 |
| `pipe-session: fresh` | a current app session is advertised | 0 |
| `pipe-session: stale` | checksum-valid session remains after an app stop or crash | 0 |
| `pipe-session: malformed (...)` | symlink/non-regular node, bad shape/checksum, future heartbeat, or an existing record that cannot be decoded | nonzero |

`dump` does not read live playhead, notes, bends, scroll, or per-channel ordering. It is a
strictly non-consuming pipe-session inspector. Endpoint observations diagnose ownership;
they do not certify a connected Lua writer.

## Debug mode

Settings > General > **Enable debug mode** draws note rectangles, the selected note, reach
bands, and bridge diagnostics. The diagnostic panel reports connection state, current app
session, receipt and applied clocks, recoveries, malformed frames, endpoint failures,
disconnects, and invalid/sequence/revision mismatch observations.

The timing graph compares accepted state and viewport application against drawing. A gap
means no accepted sample, not a zero-duration read. Renderer latency reports appear in
overlay DevTools; development forwards them to the main terminal.

## Deployment and rescan

```sh
pnpm --filter @voxpane/synthv-script build
pnpm --filter @voxpane/synthv-script deploy
```

After deploying, use **Scripts > Rescan** or restart SynthV. Rescan replaces old script
timers; verify the loaded build from the side panel, not from a filesystem timestamp. The
app installer deploys `overlay-bridge.lua`; local `deploy` also copies the smoke script, so
remove `voxpane-lua-smoke.lua` before rescan when testing the real bridge. Two simultaneous
publishers otherwise contend for the same app-owned endpoints.

## Windows

Use the repository's `run-on-windows` skill for a native Windows checkout or the Parallels
VM. Windows uses Node Named Pipe servers. Do not revive the removed PowerShell helper or
assume a two-second startup delay. From macOS, typecheck Windows helper code with:

```sh
cd packages/windows-helper && cargo check --target x86_64-pc-windows-msvc
```

## Symptom to technique

| Symptom | First check |
| --- | --- |
| App stopped | `dump` prints `pipe-session: unavailable`; this is normal |
| Stale app state after a crash | `dump` prints `stale`; inspect the side panel after restarting the app |
| Overlay never draws | tray attachment, side-panel connection/error, then debug rectangles |
| Pipe recovers repeatedly | diagnostic recoveries, malformed frames, endpoint failures, and disconnects |
| New state is ignored | diagnostic invalid, `scrollSeq`, `notesSeq`, or `rev` mismatch observations |
| Effects drift while scrolling | debug rectangles and the generation candidate matcher in [architecture.md](architecture.md#geometry-path) |
| Script change appears ignored | rebuild, deploy, **Scripts > Rescan**, then read the side-panel version |
| macOS endpoint is not a FIFO | `dump` endpoint type; do not open or remove it manually |
| Windows endpoint appears unavailable | derived name from `dump`; validate the app/side panel rather than connecting a client |

## Before changing anything

```sh
pnpm check
pnpm typecheck
pnpm test
```

Pure tests cover codecs, framed parsing, session gates, runtime composition, and endpoint
lifecycle. They do not prove a real piano-roll alignment; verify geometry with the running
app and debug mode.
