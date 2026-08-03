# @karaoke-v/synthv-script

The half of the bridge that runs **inside** Synthesizer V Studio 2. It reads the playhead,
the note schedule and the view transform through SynthV's script API and publishes them to
the app; `apps/karaoke-v/src/shared/bridge.ts` is the reader on the other end, and the two
must agree on the wire format in `src/bridge/types.ts`.

## Build

```sh
pnpm --filter @karaoke-v/synthv-script build
```

The host is a bare Duktape engine — one file, no modules, no globals beyond `SV`, ES5
only — so the build bundles to a single IIFE and lowers it to ES5. The result is
`out/overlay-bridge.js`.

## Install it into the editor

```sh
pnpm --filter @karaoke-v/synthv-script deploy
```

This copies the built script into SynthV's scripts directory (macOS
`~/Library/Application Support/Dreamtonics/…`, Windows `Documents\Dreamtonics\…`). Set
`SYNTHV_SCRIPTS_DIR` to override. SynthV picks the script up from **Scripts → Rescan**;
the bridge then appears as an *Overlay Bridge* side panel section.

## Transports

How a payload leaves SynthV differs by platform (see `src/bridge/types.ts`): macOS uses the
clipboard as a blip, Windows publishes into a buffer the app reads out of the process.
Issue #61 proposes replacing both with Lua file IPC.
