# Bridge

> Korean: [bridge.ko.md](bridge.ko.md). English is the source of truth.

The app owns the transport. SynthV's Lua script owns publication. They meet in the bridge
directory, which is `~/Library/Application Support/voxpane/bridge` on macOS and
`%LOCALAPPDATA%\\voxpane\\bridge` on Windows. Lua cannot create directories, so the app
creates this directory before publishing a rendezvous record.

## Where

`pipe-session` is the only regular file in the steady-state protocol. It is an app-owned,
128-byte VPR1 rendezvous record and heartbeat. `state`, `scroll`, and `notes` are not data
files: they are three app-owned pipe endpoints.

## The paths

```mermaid
sequenceDiagram
    participant W as App worker
    participant R as pipe-session
    participant L as SynthV Lua
    participant P as Preload BridgeRuntime
    W->>W: create readers, framing, session gate
    W->>R: publish VPR1 appSession heartbeat
    L->>R: read 128 bytes
    L->>W: open three write endpoints
    L->>W: session, notes, scroll, state frames
    W->>P: post accepted records
    P->>P: decode, compose matching generations, cache
```

The app refreshes the rendezvous heartbeat every 500 ms. The `state` endpoint carries a
session frame followed by state frames; `scroll` and `notes` carry their respective framed
records. Each channel has one active connection. On Windows an overlapping client is
rejected while that socket is active; only after its clean disconnect can the next client
become the replacement connection.

## Rendezvous record

The VPR1 record is exactly 128 bytes:

```text
VPR1\n<heartbeat seconds>\n<32 lowercase hexadecimal appSession>\n<8 lowercase hexadecimal FNV-1a checksum>\n<spaces to 128 bytes>
```

The checksum is FNV-1a 32-bit over `VPR1\n<heartbeat>\n<appSession>\n`, rendered as eight
lowercase hexadecimal characters. A heartbeat up to two seconds old is current to Lua.
The app only advertises after every endpoint reader is ready. The inspection command may
classify a checksum-valid older record as stale; that indicates an app that stopped or
crashed, not a malformed record.

The inspector first `lstat`s `pipe-session`. `ENOENT` is unavailable; a symlink or any
non-regular node is malformed and is never read. The writer applies the same regular-or-absent
gate, creates an absent file exclusively, and opens without truncation using nonblocking and
no-follow flags where Node exposes them. It compares the opened handle's `fstat` identity with
the path's `lstat` identity before one positioned 128-byte write and truncate. Recovery may
unlink and recreate the file. If recovery wins the inspector's `lstat`/read race, `ENOENT` is
unavailable and a short or invalid read is malformed. The inspector does not treat this local
operational check as a defense against arbitrary external path mutation.

Endpoint names are deterministic from `appSession`:

| Platform | `state` | `scroll` | `notes` |
| --- | --- | --- | --- |
| macOS | `<directory>/pipe-<appSession>-state` | `<directory>/pipe-<appSession>-scroll` | `<directory>/pipe-<appSession>-notes` |
| Windows | `\\\\.\\pipe\\voxpane-<appSession>-state` | `\\\\.\\pipe\\voxpane-<appSession>-scroll` | `\\\\.\\pipe\\voxpane-<appSession>-notes` |

## Endpoint ownership

On macOS the app creates each endpoint with `mkfifo`, opens its reader before advertising
the rendezvous, and receives from that reader. Lua opens the existing FIFO write-only.
On disconnect the app keeps a short reader lifecycle for reconnection; after withdrawal it
allows a 300 ms drain grace and bounds exceptional reader teardown. Lua sees `EPIPE` or an
open/write failure, closes all endpoint handles, and returns to the rendezvous retry loop.
The app withdraws `pipe-session` before it tears down endpoints, then removes only FIFO
nodes it still owns.

On Windows the app uses a Node `net` Named Pipe server. It permits one active socket per
channel, rejects an overlapping socket while it is active, and accepts the next socket only
after a clean disconnect. There is no PowerShell helper and no two-second launch path.

Lua uses `io.open(path, "wb")` for endpoint handles and only calls `write`, `close`, and
`setvbuf("no")` on them. The platform's `wb` open includes the `O_CREAT` tradeoff: the
ordered rendezvous withdrawal and 240 ms connected-session validation bound normal late
opens, but a stale regular entry or symlink is never pruned as a convenience. Before a cold
open, Lua must observe the same app session at a strictly newer heartbeat. An open or write
failure quarantines that `(appSession, heartbeat)` until the session changes or its heartbeat
advances. This prevents an unchanged fresh-but-dead record from reopening a readerless FIFO;
a force-kill after the newer heartbeat was observed but before open remains unavoidable. Lua
never reads a channel pipe; `pipe-session` is its only regular read.

## Session gate and recovery

The first state frame of a Lua connection is a session frame containing `appSession` and
`scriptSession`. The receiver checks that the frame's `appSession` equals the advertised
session before it opens the session gate. It holds only the latest pre-session indexed
frames, then posts them after a valid session frame. A clean stream disconnect resets the
parsers and session gate but keeps the current endpoints and `appSession`; the next Lua
connection creates a fresh `scriptSession` and publishes session, notes, scroll, then state.

An invalid session, parser failure, or endpoint failure instead starts receiver recovery,
which tears down the current resources and creates fresh endpoints and a fresh `appSession`.
The transport's `starting` record for a different non-null `appSession` clears the previous
runtime cache immediately, before Lua reconnects. The three streams are not cross-channel
ordered, so `BridgeRuntime` decodes posted records and composes only matching `scrollSeq`,
`notesSeq`, and `rev`; it keeps the last valid snapshot while candidates disagree only within
the same app session.

`appSession` identifies one app endpoint generation. `scriptSession` identifies one Lua
publication generation within that app session. They are not interchangeable.

## Frame boundaries

Pipe payloads are framed with the bridge header, layout, channel, and payload length. The
receiver parser accepts only the channels assigned to an endpoint and enforces payload caps
before allocation: session 4 KiB, state 1 KiB, scroll 1 KiB, and notes 64 MiB. A malformed
stream is a recovery event, not a partial record to decode.

## Shutdown and failure

Graceful app quit stops the receiver owner, joins its work, withdraws the rendezvous, and
then drains/removes owned endpoints. This ordering makes the normal case deterministic.
It cannot cover a process killed at an arbitrary instruction, therefore stale rendezvous
or endpoint entries are observations to diagnose rather than a cleanup authority.

## Diagnostics

Diagnostics expose connection state and app session; receipt and applied clocks for state,
scroll, and notes; pipe recoveries; malformed frames; endpoint failures; disconnects; and
invalid or generation-mismatch observations from accepted in-memory frames.

## Versioning

The VPR1 rendezvous grammar, endpoint derivation, frame header, and payload codecs have
three implementations: app shared code, Lua TypeScript source, and focused fixtures/tests.
Change all of them together. The endpoint protocol does not accept an unknown layout or an
unbounded payload merely to preserve compatibility.
