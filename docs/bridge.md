# The bridge

> 한국어판: **[bridge.ko.md](bridge.ko.md)**. 영어판이 원본이므로, 동작이 바뀌면 여기를 먼저 고치고
> 같은 커밋에서 번역을 맞춘다.

How the script inside SynthV gets data to the app.

Writer: `packages/synthv-script/src/lua/bridge/`.
Reader: `apps/voxpane/src/shared/bridgeChannels.ts` and `src/preload/bridgeReader.ts`.
Reference decoder for humans: `packages/synthv-script/scripts/dump.mjs`.

The script package has its own [README](../packages/synthv-script/README.md) covering the
Lua-side toolchain — `typescript-to-lua`, the 1-based index typing, host callbacks arriving
without `self`, and why there is a hand-written JSON encoder. Read it before editing
anything under `packages/synthv-script`.

## Where

One directory, reachable from both sides with no configuration:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/voxpane/bridge` |
| Windows | `%LOCALAPPDATA%\voxpane\bridge` |

**The app creates it**, because Lua has no `mkdir`. A script that finds nothing there
simply keeps failing to open and retries on the next tick; that is the state before voxpane
has ever run.

## The channels

| File | Kind | Rate | Contents |
| --- | --- | --- | --- |
| `session.json` | hot, 1 KB, JSON | once at startup | protocol and layout version, host info, what the other channels are |
| `state` | hot, 256 B, binary | every 4 ms | playhead, transport status, loop hint, `rev`, channel generations |
| `scroll` | hot, 64 B, binary | when changed | the complete view transform and its generation |
| `notes` | cold, grows, binary | on edit / on play | the whole note schedule with pitch curves |

They are split **by how often they change**. Transport is sampled every tick, the view
transform moves while the user scrolls or zooms, and the schedule moves when the user
types. An unchanged view produces no `scroll` write.

`session.json` stays JSON, and padded rather than framed, on purpose: it is the document
that tells a reader what the binary channels are, so it has to survive being read with
`cat`.

### Nothing is streamed and nothing is queued

Each channel holds **one whole record**, replaced in place. A reader that misses a
generation has missed nothing it needed — the next read has the newer value. There is no
notification of any kind, either: the app already looks every frame to draw, and a watcher
cannot beat that (measured: its tail latency is far worse).

## Pairing the channels

Split channels mean a reader can see state while another record is being replaced. Three
fields handle that:

- **`notesSeq`.** The state record carries the `notes` channel's generation, so a reader
  polling state once a frame learns the schedule moved without opening anything else. The
  hot channel is the index.
- **`scrollSeq`.** State carries the `scroll` channel's generation. The script writes the
  complete transform first and advances `scrollSeq` only after that write succeeds. The
  worker opens `scroll` only when the advertised generation changes and accepts it only
  when the record's own sequence matches.
- **`rev`.** A fingerprint of the current group's notes (FNV-1a over onsets, ends, pitches
  and lyrics, plus the group's time offset and note count), carried by **state and notes**.
  A changed `rev` means any held schedule is stale. **The notes record's own `rev` wins**
  over the one state was carrying when it was read.

The script publishes changed scroll and schedule records *before* the state record that
indexes them. A failed indexed-channel write never advances the generation advertised by
state.

`rev` is recomputed on its own cadence (every 500 ms), not per tick: fingerprinting walks
every note and calls into the host per note, and it is the only thing here that scales with
project size.

```mermaid
sequenceDiagram
    autonumber
    actor U as user
    participant S as bridge script
    participant R as scroll channel
    participant N as notes channel
    participant T as state channel
    participant W as preload Web Worker
    participant M as preload memory cache
    participant A as renderer

    loop every 4 ms
        S->>S: sample the view transform
        opt transform changed
            S->>R: publish 64 B transform, scrollSeq+1
        end
        S->>T: publish state — seq+1, playhead, status, scrollSeq, rev
    end

    U->>S: edits a note
    Note over S: fingerprint checked every 500 ms
    S->>S: rev changed
    S->>N: publish the whole schedule, notesSeq+1
    S->>T: publish state carrying the new notesSeq

    Note over S,T: the schedule goes out BEFORE the state that indexes it

    loop every 4 ms, independent of rAF
        W->>T: pread 256 B
        alt scrollSeq changed
            W->>R: pread 64 B
            W->>M: retain the matching transform
        else unchanged
            W-->>W: perform no scroll file I/O
        end
        W->>M: transfer and compose the valid state
        alt notesSeq changed
            W->>N: read the whole schedule
            W->>M: retain it by notesSeq
        else unchanged
            W-->>W: keep the schedule already cached
        end
    end

    loop every frame
        A->>M: copy the latest state snapshot
        A->>M: select schedule only if notesSeq changed
    end
```

## Atomicity

**A record is always exactly one `write` call.** That is the whole safety story — no
`os.rename`, no temp file, no seqlock.

It holds because the kernel serialises reads and writes to a regular file. Measured with a
reader `pread`ing the same bytes as fast as it could: 3.6M reads against a 128 B record and
271k against a 306 KB one, no tear.

Two consequences are not optional:

- **Records carry their own length**, in the header. An in-place write shorter than the
  last one leaves the old tail behind, and atomicity does nothing about that.
- **The stdio buffer is off** (`setvbuf("no")`). A buffered write is not one syscall, and a
  buffered reader will happily serve a stale copy — measured, 4.6M reads that observed a
  single generation.

Files are opened `r+b`, falling back to `w+b`. Not `w`: truncating would expose an empty
file to a reader between the truncate and the write.

## The record layout

Little-endian throughout. Header, 12 bytes, on every binary record:

| Field | Type | Value |
| --- | --- | --- |
| magic | 4 bytes | `VPB1` |
| layout | u16 | `4` |
| channel | u16 | 1 = state, 2 = notes, 3 = scroll |
| length | u32 | payload bytes that follow |

**`state`** payload — fixed size, then space-padded to 256 bytes:

| Field | Type | Notes |
| --- | --- | --- |
| `seq` | u32 | advances every tick; a still `seq` means the script is gone |
| `notesSeq` | u32 | generation of the `notes` channel |
| `scrollSeq` | u32 | generation of the `scroll` channel |
| `status` | u8 | 0 stopped, 1 playing, 2 looping |
| flags | u8 | bit 0: loop bounds are present |
| `at` | f64 | playhead, seconds |
| loop start, loop end | f64 × 2 | meaningless unless the flag is set |
| `rev` | u16 length + UTF-8 | Lua's `s2` |

**`scroll`** payload — exactly 64 bytes including its header:

| Field | Type | Notes |
| --- | --- | --- |
| `scrollSeq` | u32 | generation repeated for validation |
| `perBlick`, `perSemitone` | f64 × 2 | the view scale |
| `viewLeft`, `viewRight` | f64 × 2 | visible blick range |
| `viewTop`, `viewBottom` | f64 × 2 | visible value range |

**`notes`** payload: `rev` (`s2`), note count (u32), then per note:

| Field | Type |
| --- | --- |
| `onB`, `offB`, `onS`, `offS` | f64 × 4 |
| `pitch` | i16 (MIDI) |
| `lyric` | u16 length + UTF-8 |
| bend count | u16 |
| bend samples | i16 × count, cents from `pitch` |

Blicks travel as **f64, not i64**: they are exact well past any project length (2⁵³ blicks
is millions of minutes) and it keeps the reader off `getBigInt64`, which allocates a BigInt
per field.

### Why binary

The encoder runs on SynthV's UI thread. A 2000-note schedule with pitch curves takes
**18.8 ms** to build as JSON and **2.0 ms** with `string.pack` — the difference between the
editor dropping a frame on every edit and not. The record also halves, 420 KB → 195 KB.

What binary costs is forgiveness, which is what the next section is about.

## Versioning

JSON tolerates a field appearing or changing type. A fixed layout read at the wrong version
is wrong **silently**. So:

> A reader that does not recognise both the magic and the layout version must **refuse** the
> record, never interpret it.

Layout 4 moves the complete view transform into the generation-indexed `scroll` channel.
Layout 3 existed because bends gained the fixed padding on each side of their note. A padded
array looks exactly like an unpadded one — same type, plausible values — so a reader that
assumed padding would have indexed into the wrong part of the curve and drawn something
subtly wrong. That is the failure mode the version number is for.

**Changing the format means changing three places at once:**

1. `packages/synthv-script/src/lua/bridge/codec.ts` — bump `LAYOUT`, change the writer.
2. `apps/voxpane/src/shared/bridgeChannels.ts` — bump `LAYOUT`, change the reader.
3. `packages/synthv-script/scripts/dump.mjs` — bump `LAYOUT`, change the reference decoder.

Then rebuild and redeploy the script, or the app will (correctly) refuse every record a
stale copy publishes and the overlay will go quiet.

## Reading, in the app

`preload/bridgeReader.ts` holds one open fd per channel and reads from offset 0. A dedicated
Node-enabled Web Worker calls it every ~4 ms; file acquisition is therefore independent of
rAF and continues even while the renderer misses or delays a frame.

- State `pread`s reuse one 256 B buffer. After validation, the worker transfers a copy of
  the record to preload, which decodes it once and replaces its latest state object. The
  renderer's per-frame call only returns that object; it performs neither file I/O nor
  Electron IPC.
- The worker reuses one 64 B buffer for `scroll`, but reads it only when the sampled
  state's `scrollSeq` differs from the accepted generation. It validates the record's own
  sequence, transfers scroll before state, and the preload runtime composes the six values
  back into renderer-facing `state.px`. When the viewport is stationary, neither side
  performs scroll-channel file I/O.
- The worker opens and validates `notes` only when the sampled state's `notesSeq` advances.
  It transfers that record once to the preload cache, which decodes and retains the exact
  generation. The renderer's `readSchedule(notesSeq)` is then an in-memory lookup.
- The worker validates the schedule's own `rev` against the state that requested it. A
  mismatched or incomplete pair is retried on a later sample rather than being exposed.
- The preload runtime is both the `scrollSeq`-keyed transform cache and the `notesSeq`-keyed
  schedule cache. The renderer transport reuses those accepted records while recomputing
  note geometry from state and the latest canvas snapshot.
- **Nothing throws.** A short read, a torn record, an unknown layout, a missing file: every
  one of them is `null`, meaning "keep the last valid cache entry". The writer is a
  different process that can restart at any moment, and a missing SynthV must not be able
  to break the overlay.
- A failed read **closes the fd**, so the next frame reopens. The script can be reinstalled
  or the directory cleared underneath a live handle. In practice the next worker sample,
  not the next display frame, performs that reopen.

On the consumer side (`playback/transport.ts`), a schedule is accepted only for the exact
`notesSeq` carried by the state snapshot. An unavailable generation leaves the transport's
`notesSeq` unadvanced, so a later frame retries the cache lookup. A bad state sample never
replaces the memory cache: the transport keeps extrapolating from the last good record. Only a
state channel whose `seq` has not moved for 500 ms means the script is gone: stop
extrapolating.

## Seeing it

```sh
pnpm --filter @voxpane/synthv-script dump
```

Prints `session.json`, decoded state and scroll records, and the first 8 notes with their
bend ranges. Optional argument: a directory, if you are looking at channels from somewhere
else.

With nothing running you get four `ENOENT`s, which is itself the answer to "has the script
ever published here?". See [debugging](debugging.md#3-read-the-live-state) for what a
healthy dump looks like and how to read it.
