# @voxpane/synthv-script

The Synthesizer V Studio 2 half of voxpane's bridge. TypeScript compiles to Lua, which reads
the regular `pipe-session` rendezvous record and publishes framed `state`, `scroll`, and
`notes` streams through app-owned pipe endpoints. The app owns endpoint creation, parsing,
recovery, and snapshot composition.

## Build

```sh
pnpm --filter @voxpane/synthv-script build
```

Runs TypeScript validation, compiles the Lua bridge and smoke script, and bundles
`overlay-bridge.lua` for the Electron app.

## Test

```sh
pnpm --filter @voxpane/synthv-script test
```

Runs colocated Vitest tests for the Lua source and the non-consuming pipe-session inspector.

## Deploy

```sh
pnpm --filter @voxpane/synthv-script deploy
```

Copies built Lua scripts into SynthV's scripts directory. Set `SYNTHV_SCRIPTS_DIR` to
override the destination, then use **Scripts > Rescan** or restart SynthV. Local deploy also
copies `voxpane-lua-smoke.lua`; remove that script before running the real bridge so two
publishers do not share the app-owned endpoints.

## Inspect the app session

```sh
pnpm --filter @voxpane/synthv-script run dump
pnpm --filter @voxpane/synthv-script run dump -- /path/to/bridge
```

`dump` is a strictly non-consuming inspector. It first `lstat`s `pipe-session`: `ENOENT`
is unavailable, while a symlink or another non-regular node is malformed and never read. It
then verifies the 128-byte VPR1 record, prints the app session, heartbeat age/freshness, and
deterministic endpoint names. The app opens the regular record without truncation, verifies
the opened handle against the path identity, performs one positioned 128-byte write, and only
then truncates it; an absent record is created exclusively and recovery may unlink then
recreate it. The regular-or-absent gate treats a recovery `ENOENT` as unavailable and any
short or invalid record as malformed. On macOS it reports endpoint node types through `lstat`
without opening them; on Windows it prints the Named Pipe names without connecting.

With the app stopped, it prints exactly:

```text
pipe-session: unavailable
```

and exits zero. A valid stale record also exits zero. A symlink, non-regular node, bad
record, checksum, or future heartbeat prints `pipe-session: malformed (...)` and exits
nonzero. It never dumps live payloads, opens a FIFO, opens a Named Pipe, or reads a channel
endpoint.
