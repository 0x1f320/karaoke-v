# Bridge and Canvas Read Path Design

## Context

The SynthV bridge already publishes the complete piano-roll scroll and zoom transform every
4 ms. The renderer nevertheless reads the same `state` record independently from its frame
loop, viewport manager, and note pump. The viewport manager also polls macOS Accessibility
every 8 ms and reads content and reference-note frames whose values are discarded: only the
piano-roll canvas rectangle is consumed.

The current path therefore has two avoidable costs. It performs synchronous AX IPC on the
renderer main thread, and it creates several independently timed bridge snapshots for one
rendered frame.

## Goals

- Read the bridge `state` record exactly once per rendered frame.
- Read the `notes` record only when `notesSeq` changes.
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

### 1. Change only the viewport interval

Raising the current interval from 8 ms to 250 ms is small, but it preserves duplicate state
reads, unused AX attributes, and a global canvas rectangle that becomes stale during a window
drag. It reduces load without fixing ownership.

### 2. Push every target-window frame through Electron IPC

The main process already observes target-window movement. It could forward every frame to the
renderer, but that restores main-process IPC to the geometry hot path and conflicts with the
existing native-follow design.

### 3. Consolidate state and cache a window-local canvas

This is the selected approach. The renderer reads state once at rAF time. A slow asynchronous
canvas manager stores the canvas in target-window-local coordinates, so the canvas remains
correct while the native helper moves the overlay with SynthV. AX is needed only when the
internal piano-roll layout changes, not when the whole window translates.

## Architecture

### Frame snapshot

The rAF callback is the only owner of `bridge.readState()`. It passes the resulting state to
the transport together with the latest canvas snapshot. Transport no longer opens the state
channel itself.

The same state object drives transport status, playhead anchoring, viewport construction, and
note geometry. A frame can therefore never combine transport from one `seq` with a mapping
from another.

The local clock continues to interpolate the playhead between fresh state records. A missing
or unchanged record retains the existing 500 ms silence behavior.

### Schedule ownership

Transport remains the owner of the decoded schedule. When the frame state carries a different
`notesSeq`, it reads the notes channel once. A torn record leaves the accepted generation
unchanged, so the following frame retries.

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

Renderer, every rAF
  -> read state once
  -> read notes only when notesSeq changed
  -> combine state with latest local canvas
  -> update transport, viewport, and effects

Canvas manager, every 250 ms
  -> async native canvas-only read
  -> retain the latest valid local canvas
  -> full async AX walk only on cache miss
```

## Error Handling

- A torn or unreadable state record skips that frame and preserves the prior transport anchor.
- A torn notes record does not advance the accepted `notesSeq` and is retried next frame.
- A failed canvas refresh retains the last valid canvas while the target remains attached.
- A stale macOS AX cache is cleared and recovered through the existing full asynchronous walk.
- Target visibility and disappearance remain owned by the main-process tracking loop.

## Testing

- Transport tests prove that externally supplied state is consumed without another read.
- Transport tests prove that one schedule read occurs per accepted `notesSeq` and torn reads retry.
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

