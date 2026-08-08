# @voxpane/synthv-script

The half of the bridge that runs **inside** Synthesizer V Studio 2. It reads the playhead,
the note schedule and the view transform through SynthV's script API and publishes them to
the app; `apps/voxpane/src/shared/bridgeChannels.ts` is the reader on the other end, and
the two must agree on the format in `src/lua/bridge/codec.ts`.

## Build

```sh
pnpm --filter @voxpane/synthv-script build
```

The script is TypeScript compiled to Lua by
[`typescript-to-lua`](https://typescripttolua.github.io/), bundled into one file per entry
point: `out/overlay-bridge.lua` (the bridge) and `out/voxpane-lua-smoke.lua` (the
toolchain check).

SynthV also hosts JavaScript, on a bare Duktape engine, and this script used to be written
for it. The Lua host is the one with a filesystem — `io`, `os`, `require`, the whole
standard library, where the JavaScript host has none — and that is what lets the bridge be
a file instead of the user's clipboard.

Three things about the Lua host are load-bearing, and `src/lua/types/synthv-lua.d.ts` exists
to encode them (all three measured against 2.3.0tp1, not read off the docs):

- **The API counts from 1.** `getNote(0)` raises "out-of-bound access", so index parameters
  take `SVIndex`, which only `svIndex()` mints — a raw loop counter will not typecheck. The
  Biome plugin in `.biome/plugins/` closes the remaining hole by rejecting `as SVIndex`
  casts. Arrays the API *returns* need no such care: they are 1-based tables and `tstl`
  shifts TypeScript's 0-based indices, so the two conventions cancel out.
- **Host callbacks arrive without `self`.** Declared `this: void`, they compile to
  `function(value)`; declared without it, `tstl` inserts a self parameter and the real
  argument lands in it — silently.
- **There is no `JSON`.** `src/lua/json.ts` is the encoder, and it formats numbers itself
  because Lua 5.4 splits integers from floats and `tostring` would render a blick as
  `2116800000.0` or `1e+15`.

`src/lua/smoke.ts` is the end-to-end check for all of the above: a side panel section that
loops on `SV:setTimeout`, reads notes through 1-based indices and publishes them through the
real channels. Run it after touching the toolchain.

## Channels

The script does not send one payload. Values do not change together: transport is sampled
every tick, the view transform changes while scrolling or zooming, and the schedule changes
when the user edits. Each cadence has its own file in `<app data>/voxpane/bridge/`, which
**the app creates** (Lua has no mkdir).

| Channel | Cadence | Written |
| --- | --- | --- |
| `session.json` | once at start | JSON, padded to a fixed width. The contract: protocol and layout version, and what the other channels are. |
| `state` | every tick | Binary, fixed width, rewritten in place. |
| `scroll` | when changed | Binary, 64 bytes, rewritten only after one of the six transform values changes. |
| `notes` | on edit | Binary, whole record in one write. |

Two rules make this safe without `os.rename`: **a record is always exactly one `write` call**
— measured, a single write never tore against a reader `pread`ing as fast as it could — and
**a record carries its own length**, because an in-place write shorter than the last one
leaves the old tail behind.

The state channel is also the index: it carries the scroll and notes sequence numbers, so a
reader polling it once a frame learns which additional record moved without opening it
while unchanged.
That is why nothing here notifies anyone — a watcher cannot beat a reader that already
looks every frame, and measured, `fs.watch` matches a 1 ms poll at the median and trails it
by 287 ms at the tail.

Records are binary because the encoder runs on SynthV's UI thread: a 2000-note schedule with
pitch curves costs 18.8 ms to build as JSON and 2.0 ms with `string.pack`, which is the
difference between the editor dropping a frame on every edit and not. What that costs is
`cat`, and `pnpm --filter @voxpane/synthv-script run dump` pays it back — it decodes every
channel and is the reference for what the app's reader does.

## Install it into the editor

```sh
pnpm --filter @voxpane/synthv-script run deploy
```

This copies everything built into SynthV's scripts directory (macOS
`~/Library/Application Support/Dreamtonics/…`, Windows `Documents\Dreamtonics\…`). Set
`SYNTHV_SCRIPTS_DIR` to override. SynthV picks the scripts up from **Scripts → Rescan**;
the bridge then appears as an *Overlay Bridge* side panel section.
