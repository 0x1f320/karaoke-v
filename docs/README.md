# voxpane docs

Context for whoever is about to change this code — what Synthesizer V is, how a note
gets from its piano roll onto the overlay, and how to see the running system instead of
guessing at it.

These are **not** conventions. `CLAUDE.md` / `AGENTS.md` cover commits, comments, i18n and
tests; this tree covers behaviour.

## Read in this order

1. **[architecture.md](architecture.md)** — the whole path, end to end. Start here always.
2. **[synthv.md](synthv.md)** — the host application: its object model, its units, its Lua
   host, and the engine behaviours the code works around.
3. **[bridge.md](bridge.md)** — the data channel between the script and the app.
4. **[geometry.md](geometry.md)** — coordinate spaces, and why macOS and Windows solve the
   same problem from opposite ends.
5. **[debugging.md](debugging.md)** — how to observe any of it while it runs.

## Where to look first

| Symptom | Layer | Document |
| --- | --- | --- |
| No overlay at all; SynthV is open | window tracking, or the permissions gate | [debugging](debugging.md#1-is-the-app-tracking-synthv) |
| Overlay is there, nothing ever draws | the script is not publishing | [debugging](debugging.md#2-is-the-script-alive), [bridge](bridge.md) |
| Effects fire at the wrong moment | the transport clock | [architecture](architecture.md#the-frame-loop), `playback/transport.ts` |
| Effects land on the wrong note | note matching | [geometry](geometry.md#matching-a-note-to-a-rectangle) |
| Effects drift while scrolling or zooming | the frame transform | [geometry](geometry.md#staying-aligned) |
| Notes stale after an edit in SynthV | `rev` / `notesSeq` pairing | [bridge](bridge.md#pairing-the-channels) |
| Effect flies off-screen or fires in silence | the pitch curve | [synthv](synthv.md#the-computed-pitch-curve), `playback/pitch.ts` |
| Broken on one platform only | the geometry split | [geometry](geometry.md#two-platforms-two-strategies) |
| Windows-only misalignment on a scaled display | the DIP transform | [geometry](geometry.md#physical-pixels-points-and-dips) |
| Nothing behaves as this page says | the docs went stale — fix them | — |

## How to write in here

- **English**, like everything else that lands in the repo.
- Say **why** and **where**. Never restate what the code says: an API dump goes stale the
  first time something is renamed, and the module headers in this codebase already carry
  the explanation. Link to them.
- Mark **observed** SynthV behaviour as observed. Almost nothing about the engine's pitch
  computation or its menus is documented; a reader has to know which claims came from
  measurement so they know which ones to re-measure.
