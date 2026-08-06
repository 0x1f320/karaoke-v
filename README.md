# Voxpane

Note effects drawn over Synthesizer V Studio 2's piano roll — a transparent overlay that
follows the editor's window and lights up notes as they are sung.

macOS and Windows. Electron + React, with a Lua bridge script running inside SynthV and a
Rust helper per platform.

## Getting started

Needs Node (see `.nvmrc`), pnpm, and a Rust toolchain (`rustup`) for the native helpers.

```sh
pnpm install
pnpm dev
```

On macOS the app asks for Accessibility on first run; it cannot read the piano roll without
it.

## Docs

- **[docs/](docs/README.md)** — how the product works, and how to debug it.
- **[CLAUDE.md](CLAUDE.md)** / **[AGENTS.md](AGENTS.md)** — conventions: commits, comments,
  i18n, tests.
