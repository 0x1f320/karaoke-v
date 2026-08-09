# Architecture

> Korean: [architecture.ko.md](architecture.ko.md). English is the source of truth.

voxpane draws effects in a transparent Electron overlay above Synthesizer V Studio 2. The
app never changes the project. SynthV supplies what is playing and its view transform; the
native helper supplies the screen anchor that SynthV's script cannot see.

## The path

```mermaid
flowchart LR
    script["overlay-bridge.lua\nSynthV Lua"]
    session["pipe-session\n128-byte VPR1 heartbeat"]
    worker["preload worker\nservers, framing, session gate"]
    runtime["preload BridgeRuntime\ndecode, compose, cache"]
    renderer["renderer rAF\nPixi effects"]
    script -- "regular read only" --> session
    session --> worker
    script -- "state / scroll / notes frames" --> worker
    worker -- "accepted records" --> runtime
    runtime --> renderer
```

The app creates the bridge directory, owns the three endpoints, and advertises one fresh
app session through `pipe-session`. Lua reads that small regular file and opens the derived
`state`, `scroll`, and `notes` write endpoints. The worker receives framed bytes
event-by-event, applies the session gate, and posts accepted records to preload
`BridgeRuntime`. `BridgeRuntime` decodes and composes matching generations into the
in-memory cache; the renderer reads only that cache. No per-frame IPC or endpoint I/O is in
the render path. On macOS, the worker also launches a guardian that opens a non-consuming
read descriptor for every FIFO, daemonizes outside Electron's process tree, and reports
readiness over a Unix control socket before the worker advertises the session.

The streams have different change rates: `state` carries the playhead and the current
`rev`/`scrollSeq`/`notesSeq`; `scroll` carries the viewport transform; `notes` carries a
whole schedule. They are independent streams, so arrival order across channels is not an
ordering guarantee.

## Main ownership

```mermaid
flowchart TD
    main["Electron main\nwindow lifecycle, bridge stop supervision"]
    preload["overlay preload\nconstructs worker and BridgeRuntime"]
    worker["preload worker\nendpoints, rendezvous, parser, recovery"]
    runtime["preload BridgeRuntime\ndecode, compose, cache"]
    overlay["overlay renderer\nreads bridge cache/API"]
    native["native helper\nwindow and canvas anchor"]
    main -- "overlay lifecycle / shutdown IPC" --> preload
    preload --> worker
    preload --> runtime
    worker -- "accepted records" --> runtime
    runtime -- "cache/API" --> overlay
    native --> main
```

Main owns long-lived Electron work: permissions, the tray, preferences, installing and
rescanning `overlay-bridge.lua`, window following, and graceful shutdown. It starts and
supervises the overlay, then sends a shutdown request to its preload bridge owner. The
preload constructs the worker and `BridgeRuntime`. The worker owns the pipe servers, framed
parsing, session gate, and reconnect/recovery lifecycle, then posts accepted frame records
to `BridgeRuntime`. `BridgeRuntime` decodes those records, composes matching generations into
the snapshot cache, and exposes that cache/API to the renderer. Renderer
`requestAnimationFrame` never waits for main or a pipe.

On a clean shutdown, main asks the receiver to stop before it withdraws its owned
`pipe-session` and FIFO endpoints. The Darwin servers allow a 300 ms drain grace before
their bounded reader teardown, then the worker closes the guardian control socket. If the
worker or Electron process disappears instead, that socket reaches EOF without any
JavaScript cleanup. The daemonized guardian withdraws only the matching rendezvous and FIFO
nodes, drains late opens through the same 300 ms grace, and then keeps one blocking drainer
per channel until every existing Lua writer closes. Its already-open read descriptors remove
the no-reader interval that would otherwise deliver `SIGPIPE` to SynthV. The guardian never
reads while the worker is alive, so it does not compete with normal reception. Reparenting
before readiness also keeps development supervisors that signal Electron's descendant tree
from killing the guardian before it can drain.

## Geometry path

```mermaid
flowchart LR
    schedule["notes schedule\nnotesSeq + rev"]
    scroll["viewport transform\nscrollSeq"]
    anchor["native canvas anchor"]
    match["generation candidate matcher"]
    rects["note rectangles"]
    schedule --> match
    scroll --> match
    anchor --> match --> rects
```

The runtime composes a snapshot only when the latest `scroll` record has the state's
`scrollSeq` and, when `notesSeq` is nonzero, the schedule has both the matching `notesSeq`
and `rev`. It retains the last valid snapshot while a newer candidate is incomplete or
mismatched. The candidate matcher then combines the matched schedule and transform with
the native canvas anchor. This keeps scroll following responsive without pretending that
the three pipe streams share a clock.

## The frame loop

Each animation frame reads the latest accepted cache entry, interpolates the playhead,
finds the sounding note, combines its canvas-local rectangle with the current viewport and
native anchor, samples pitch, and draws. Native canvas discovery runs separately, so an
older anchor can never block a current scroll transform.

The relevant clocks are independent: Lua's 4 ms tick, the app's 500 ms rendezvous
heartbeat, event-driven pipe receipt, native canvas refresh, and `requestAnimationFrame`.
They are intentionally not synchronized. A missing script, disconnected pipe, malformed
frame, or absent native anchor means nothing is drawn, not that the frame loop throws.

## Where things live

| Path | Responsibility |
| --- | --- |
| `apps/voxpane/src/main` | Electron lifecycle, windows, graceful bridge shutdown |
| `apps/voxpane/src/preload` | worker-owned endpoints, framing, session gate; `BridgeRuntime` decode, composition, cache |
| `apps/voxpane/src/shared` | rendezvous, frame, diagnostic, and geometry contracts |
| `apps/voxpane/src/renderer/src/playback` | cache consumption, transport, matching, pitch |
| `packages/synthv-script` | TypeScript authored Lua publisher |
| `packages/macos-helper` | Accessibility anchor and window sticking |
| `packages/windows-helper` | UI Automation anchor and window sticking |
