# @karaoke-v/synthv-script

The half of the bridge that runs **inside** Synthesizer V Studio 2. It reads the playhead,
the note schedule and the view transform through SynthV's script API and publishes them to
the app; `apps/karaoke-v/src/shared/bridge.ts` is the reader on the other end, and the two
must agree on the wire format in `src/bridge/types.ts`.

## Build

```sh
pnpm --filter @karaoke-v/synthv-script build
```

This builds both hosts.

**JavaScript** (`src/*`, minus `src/lua`) — the host is a bare Duktape engine: one file, no
modules, no globals beyond `SV`, ES5 only. The build bundles to a single IIFE and lowers it
to ES5, giving `out/overlay-bridge.js`.

**Lua** (`src/lua/*`) — the same TypeScript toolchain, compiled by
[`typescript-to-lua`](https://typescripttolua.github.io/) to a single bundled Lua 5.4 file
(`out/karaoke-v-lua-smoke.lua`, config in `tsconfig.lua.json`). The Lua host is worth the
second build because it has the whole standard library — `io`, `os`, `require` — where the
JavaScript host has no filesystem at all, which is what issue #61 needs.

Three things about that host are load-bearing, and `src/lua/types/synthv-lua.d.ts` exists to
encode them (all three measured against 2.3.0tp1, not read off the docs):

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

The script does not send one payload. Values do not change together — the view transform
moves sixty times a second, the schedule moves when the user edits — so each cadence is its
own file in `<app data>/karaoke-v/bridge/`, which **the app creates** (Lua has no mkdir).

| Channel | Cadence | Written |
| --- | --- | --- |
| `session.json` | once at start | JSON, padded to a fixed width. The contract: protocol and layout version, and what the other channels are. |
| `state` | every tick | Binary, fixed width, rewritten in place. |
| `notes` | on edit | Binary, whole record in one write. |
| `doorbell` | on cold updates | Empty file, re-created so a watcher has a directory change to notice. |

Two rules make this safe without `os.rename`: **a record is always exactly one `write` call**
— measured, a single write never tore against a reader `pread`ing as fast as it could — and
**a record carries its own length**, because an in-place write shorter than the last one
leaves the old tail behind.

The hot channel is also the index: it carries each cold channel's sequence number, so a
reader polling it once a frame learns the schedule moved without opening anything else. The
doorbell is a hint on top of that, never the mechanism.

Records are binary because the encoder runs on SynthV's UI thread: a 2000-note schedule with
pitch curves costs 18.8 ms to build as JSON and 2.0 ms with `string.pack`, which is the
difference between the editor dropping a frame on every edit and not. What that costs is
`cat`, and `pnpm --filter @karaoke-v/synthv-script run dump` pays it back — it decodes every
channel and is the reference for what the app's reader does.

## Install it into the editor

```sh
pnpm --filter @karaoke-v/synthv-script run deploy
```

This copies everything built into SynthV's scripts directory (macOS
`~/Library/Application Support/Dreamtonics/…`, Windows `Documents\Dreamtonics\…`). Set
`SYNTHV_SCRIPTS_DIR` to override. SynthV picks the scripts up from **Scripts → Rescan**;
the bridge then appears as an *Overlay Bridge* side panel section.

## Transports

How a payload leaves SynthV differs by platform (see `src/bridge/types.ts`): macOS uses the
clipboard as a blip, Windows publishes into a buffer the app reads out of the process.
Issue #61 proposes replacing both with Lua file IPC.
