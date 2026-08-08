# Synthesizer V

> Korean: [synthv.ko.md](synthv.ko.md). English is the source of truth.

The bridge is a Lua side-panel script inside Synthesizer V Studio 2. It follows one selected
group, reads playback, notes, pitch, and view mapping from the host API, and publishes to
the app-owned pipe transport described in [bridge.md](bridge.md).

## One group

The script publishes one group only. Notes use SynthV's `blick`, time uses seconds, pitch
uses semitones and cents. The app reconstructs screen rectangles from this data and a
native canvas anchor; Lua does not know its own window position.

## Host constraints

SynthV Lua has `io` and `os`, but no sockets, native module loading, `popen`, or portable
directory creation. It has no scheduler except `SV.setTimeout`. Named pipes work only
through `io.open`; the script never reads a channel pipe. It reads the 128-byte regular
`pipe-session` record, then opens three write-only endpoints with `io.open(path, "wb")`.

Each endpoint handle is unbuffered with `setvbuf("no")` and is used only for `write` and
`close`. Pipe writes are synchronous. A blocked app reader therefore applies backpressure
to the SynthV UI thread, and a large `notes` snapshot is the highest-risk write. The side
panel's **Resend schedule** button is the deliberate manual gate for that work.

## Pipe client

Lua retries `pipe-session` on a 240 ms interval. It accepts only a fresh, checksum-valid
VPR1 record and derives the app-session endpoint names. A first-seen session is only a
candidate: Lua opens all three endpoints after observing that same session at a strictly
newer heartbeat. It closes every endpoint on `EPIPE`, failed write, failed open, or a changed
advertised session. Open and write failures quarantine their `(appSession, heartbeat)` until
the session changes or its heartbeat advances. Its `wb` mode can create an ordinary file
when the expected endpoint is absent; the app prevents the normal case by creating readers
before advertising and withdrawing the rendezvous before teardown. It intentionally does
not remove stale regular files or symlinks. The liveness proof prevents reuse of an unchanged
fresh-but-dead advertisement, but cannot remove a force-kill race after heartbeat advancement
and before endpoint open.

## Publication

The script runs a 4 ms tick. On a new app connection it creates a new `scriptSession`,
resets `seq`, `scrollSeq`, and `notesSeq`, and sends a session frame. It then makes an exact
recovery snapshot: full notes, current scroll, and current state. This is automatic on each
reconnect, not an optimization that assumes the app retained old data.

After that, `state` publishes the playhead, transport status, `rev`, `scrollSeq`, and
`notesSeq` every tick. `scroll` publishes only when the six view values change. `notes`
publishes on initial recovery, user request, playback start when needed, and detected edit.
The app may receive these three streams in any order and accepts a composed snapshot only
after their sequence and revision relation matches.

The session frame carries protocol/layout, `appSession`, `scriptSession`, script version,
and host information. `appSession` comes from the app rendezvous; `scriptSession` changes
when this Lua publisher reconnects. State, scroll, and notes then recover the complete
current app view without a regular-channel rescan.

## Notes and pitch

`getComputedPitchForGroup` returns a group's rendered pitch buffer in MIDI note numbers.
It may be absent, and unvoiced frames are observed as `0` rather than `null`. The publisher
uses `NO_CURVE` for unavailable padded samples and the renderer can synthesize a fallback
contour. These are measured host behaviors, not protocol faults.

## View transform

`getTimePxPerUnit`, `getValuePxPerUnit`, `getTimeViewRange`, and `getValueViewRange` form
the `scroll` payload. The transform is canvas-local. It does not identify where the canvas
is on screen, so the app combines it with macOS Accessibility or Windows UI Automation.
`viewTop` is the second value range edge and `viewBottom` is the first.

## Transport and looping

`SV.getPlayback()` supplies `stopped`, `playing`, or `looping` and a playhead in seconds.
Loop bounds are inferred from a backward playhead jump while looping. They are smoothing
hints only; the app re-anchors to received state.

## Versions

The script declares `minEditorVersion: 131330`. The side panel reports its script version,
connection state, app and script sessions, sequence counters, notes count, and the last
failure. This is the authoritative view from the host when the app cannot see Lua logs.
