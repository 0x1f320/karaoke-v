# Bridge and Canvas Read Path Design

## Context

The SynthV bridge already publishes transport and the complete piano-roll scroll and zoom
transform every 4 ms. The renderer nevertheless reads the same `state` file independently
from its frame loop, viewport manager, and note pump. Tying the authoritative read to rAF
would remove duplication but would also make state freshness depend on rendering cadence.
The viewport manager additionally polls macOS Accessibility every 8 ms and reads content and
reference-note frames whose values are discarded: only the piano-roll canvas rectangle is
consumed.

The current path therefore has two avoidable costs. It performs file and synchronous AX IPC
on the renderer main thread, and it creates several independently timed bridge snapshots for
one rendered frame.

## Goals

- Sample the bridge `state` channel every 4 ms independently of rAF.
- Serve each rendered frame from the latest valid in-memory state snapshot without file I/O.
- Read and cache the `notes` record in the worker only when `notesSeq` changes.
- Make the bridge view transform the only source of piano-roll scroll and zoom.
- Use macOS AX only to discover and validate the canvas rectangle.
- Refresh the canvas every 250 ms in steady state, while keeping window dragging aligned.
- Remove synchronous AX work from the renderer main thread.
- Preserve the existing torn-record, stale-cache, and target-disappearance behavior.

## Non-goals

- Changing the 4 ms SynthV script publication cadence.
- Replacing file channels with sockets, watchers, or shared memory.
- Changing note effects or their visual behavior.
- Removing the macOS Accessibility permission requirement.

## Considered Approaches

### 1. Read state only from rAF and change the viewport interval

Reading state once per frame and raising the current AX interval from 8 ms to 250 ms is small,
but state freshness then depends on rAF. A missed or throttled frame also becomes a missed
bridge sample, and a global canvas rectangle still becomes stale during a window drag.

### 2. Poll state from a preload timer

A 4 ms preload timer decouples sampling from display refresh, but it still runs on the renderer
main thread. Rendering or other synchronous work can delay both the timer and rAF, and file I/O
remains in the renderer process's event loop.

### 3. Use a bridge worker and cache a window-local canvas

This is the selected approach. A dedicated Worker samples bridge files independently and
publishes the latest valid state through shared memory. The renderer only copies and decodes
that memory at rAF time. A slow asynchronous canvas manager stores the canvas in
target-window-local coordinates, so the canvas remains correct while the native helper moves
the overlay with SynthV. AX is needed only when the internal piano-roll layout changes, not
when the whole window translates.

## Architecture

### Background bridge sampler

A dedicated Node Worker owns both bridge file descriptors and all bridge file I/O. It polls
the fixed 256-byte state channel every 4 ms into a reused buffer and validates the record
before publishing it. Sampling continues independently when rAF misses a display deadline.

The latest valid raw state record is published through a `SharedArrayBuffer` guarded by an
atomic sequence lock. The worker marks a write in progress, copies the complete record, then
publishes an even generation. A reader copies only when the generation is stable and even;
it retries rather than observing a partially replaced memory record.

The worker retains the last valid record across missing, torn, or temporarily unreadable file
reads. It does not manufacture a new sequence or timestamp.

### Frame snapshot

The rAF callback reads the shared-memory state once and decodes that memory without opening a
file. It passes the resulting immutable state to transport together with the latest canvas
snapshot.

The same state object drives transport status, playhead anchoring, viewport construction, and
note geometry. A frame can therefore never combine transport from one `seq` with a mapping
from another.

The local clock continues to interpolate the playhead between fresh state records. A missing
or unchanged record retains the existing 500 ms silence behavior.

### Schedule ownership

When a valid worker sample carries a different `notesSeq`, the worker reads the notes channel
and transfers its raw bytes with the generation over the worker message port. The preload
decodes each accepted generation once and retains the resulting immutable schedule. A torn
record leaves the accepted generation unchanged, so the worker retries after the next valid
state sample.

Transport consumes the cached schedule only when its generation matches the frame state's
`notesSeq`. A delayed schedule publication therefore cannot pair old notes with a new state.

The independent note pump is removed. A cached `PianoRoll` base is rebuilt only when the
accepted schedule generation or canvas layout changes. Scroll and zoom do not rebuild it;
the existing frame rebasing applies the live bridge transform to the cached rectangles.

### Canvas manager

The viewport manager becomes a canvas manager and no longer reads bridge state. It starts an
asynchronous read immediately, then waits 250 ms after each completion before starting the
next one. Reads never overlap. The most recent valid canvas remains usable when a read races
with a layout transition.

On macOS the native result is expressed relative to the target window. Translating SynthV
does not change that rectangle, and the existing native window follower moves the overlay by
the same amount. Resizing or changing internal panels is reflected by the next 250 ms read.

On Windows the existing UI Automation canvas discovery and paired window origin remain the
source of the canvas snapshot; this design must not change Windows behavior.

### macOS AX boundary

The macOS helper adds an asynchronous canvas-only read. Its steady-state cache contains the
target window and the horizontal and vertical piano-roll scrollbars. The worker reads their
frames, derives the canvas rectangle, and returns target-window-local coordinates.

It does not read the content group or reference note. Those elements represented scroll in
the former AX-driven geometry path; scroll now comes from `getNavigation()` in the bridge.

A cache miss or stale element triggers the existing asynchronous full piano-roll walk. That
walk may still inspect groups and note-shaped chips to rediscover the canvas, top inset, and
cache elements, but it is not the steady-state path.

## Data Flow

```text
SynthV script, every 4 ms
  -> state file: transport + view transform + notesSeq

Bridge worker, every 4 ms
  -> read and validate state
  -> atomically replace shared latest-state memory
  -> read notes only when notesSeq changes

Renderer, every rAF
  -> copy/decode latest state memory once, with no file I/O
  -> adopt matching cached notes generation
  -> combine state with latest local canvas
  -> update transport, viewport, and effects

Canvas manager, every 250 ms
  -> async native canvas-only read
  -> retain the latest valid local canvas
  -> full async AX walk only on cache miss
```

## Error Handling

- A torn or unreadable state file read leaves shared memory on the last valid record.
- An unchanged shared `seq` preserves the prior transport anchor and still triggers the existing
  500 ms silence behavior.
- A torn notes record does not publish its generation and is retried by the worker.
- A failed canvas refresh retains the last valid canvas while the target remains attached.
- A stale macOS AX cache is cleared and recovered through the existing full asynchronous walk.
- Target visibility and disappearance remain owned by the main-process tracking loop.

## Testing

- Bridge-sampler tests prove 4 ms polling is independent of rAF, invalid records do not replace
  shared state, and the sequence lock never exposes a partial record.
- Schedule-cache tests prove that one notes read occurs per accepted `notesSeq`, torn reads retry,
  and state is paired only with the matching schedule generation.
- Transport tests prove that in-memory state is consumed without file I/O.
- Canvas-manager tests prove immediate first read, 250 ms steady cadence, non-overlap, and retention
  of the last valid result.
- Pure geometry tests prove that a target-window translation does not change a local canvas.
- Existing frame, note-location, bridge decoder, and transport suites remain green.
- A macOS runtime sample must show no synchronous `get_viewport` AX stack on the renderer main
  thread and an approximately 4 Hz steady-state canvas read rate.

## Documentation

The implementation updates the English sources and Korean translations of `architecture`,
`bridge`, and `geometry` so their clock diagrams, AX ownership, and schedule-read guarantees
match the new path.
