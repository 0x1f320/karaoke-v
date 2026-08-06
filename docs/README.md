# voxpane docs

> 한국어판: **[README.ko.md](README.ko.md)**. 영어판이 원본이므로, 동작이 바뀌면 여기를 먼저 고치고
> 같은 커밋에서 번역을 맞춘다.

Context for whoever is about to change this code — what Synthesizer V is, how a note gets
from its piano roll onto the overlay, which techniques each piece is built on, and how to
see the running system instead of guessing at it.

These are **not** conventions. `CLAUDE.md` / `AGENTS.md` cover commits, comments, i18n and
tests; this tree covers behaviour.

## Read in this order

1. **[architecture.md](architecture.md)** — the whole path, end to end. Start here always.
2. **[synthv.md](synthv.md)** — the host application: its object model, its units, its Lua
   host, and the engine behaviours the code works around.
3. **[bridge.md](bridge.md)** — the data channel between the script and the app.
4. **[geometry.md](geometry.md)** — coordinate spaces, and why macOS and Windows solve the
   same problem from opposite ends.
5. **[overlay.md](overlay.md)** — the window itself: how it attaches, follows and stays out
   of the way, and why the hot path lives where it does.
6. **[effects.md](effects.md)** — what actually gets drawn: glow, particles, trail, pitch
   following, and the scene they share.
7. **[debugging.md](debugging.md)** — how to observe any of it while it runs.

## Where to look first

| Symptom | Layer | Document |
| --- | --- | --- |
| No overlay at all; SynthV is open | window tracking, or the permissions gate | [debugging](debugging.md#1-is-the-app-tracking-synthv), [overlay](overlay.md#following-the-frame) |
| Overlay is there, nothing ever draws | the script is not publishing | [debugging](debugging.md#2-is-the-script-alive), [bridge](bridge.md) |
| Overlay lags behind scrolling | the hot path, or throttling | [overlay](overlay.md#the-hot-path) |
| Overlay chases the window during a drag | bounds reconciliation | [overlay](overlay.md#native-placement-with-debounced-reconciliation) |
| Overlay floats over an unrelated app | visibility gating | [overlay](overlay.md#visibility-gating) |
| Effects fire at the wrong moment | the transport clock | [architecture](architecture.md#the-frame-loop) |
| Effects land on the wrong note | note matching | [geometry](geometry.md#matching-a-note-to-a-rectangle) |
| Effects drift while scrolling or zooming | the frame transform | [geometry](geometry.md#staying-aligned) |
| Effects jump when a note read lands | coordinate-space rebasing | [effects](effects.md#coordinate-space-rebasing) |
| Onsets read flat, or the glow never goes out | the glow envelopes | [effects](effects.md#two-summed-envelopes) |
| Twice the particles on a 120 Hz display | frame-rate independence | [effects](effects.md#frame-rate-independence) |
| A streak across the roll behind the trail | the trail's join rules | [effects](effects.md#join-rules) |
| Notes stale after an edit in SynthV | `rev` / `notesSeq` pairing | [bridge](bridge.md#pairing-the-channels) |
| Effect flies off-screen or fires in silence | the pitch curve | [synthv](synthv.md#the-computed-pitch-curve), [effects](effects.md#pitch-following) |
| An imported image never appears | the asset scheme | [effects](effects.md#presets-images-and-the-preview) |
| Broken on one platform only | the geometry split | [geometry](geometry.md#two-platforms-two-strategies) |
| Windows-only misalignment on a scaled display | the DIP transform | [geometry](geometry.md#physical-pixels-points-and-dips) |
| Nothing behaves as this page says | the docs went stale — fix them | — |

## Technique index

Every non-obvious technique in the product, where it is explained, and what uses it. A
technique has **one home**; everything else links to it.

| Technique | Home | Used by |
| --- | --- | --- |
| Replace-in-place channels, no queue | [bridge](bridge.md#the-channels) | the whole data path |
| One write per record (atomicity) | [bridge](bridge.md#atomicity) | the script's channel writes |
| `rev` / `notesSeq` pairing | [bridge](bridge.md#pairing-the-channels) | schedule freshness, group changes |
| Refuse-on-unknown-layout | [bridge](bridge.md#versioning) | every decoder, including `dump.mjs` |
| Playhead interpolation on the local clock | [architecture](architecture.md#the-frame-loop) | the transport, all effect timing |
| Predict-and-snap, follow, anchor | [geometry](geometry.md#matching-a-note-to-a-rectangle) | note matching, debug reach bands |
| Read-scoped coordinate frames | [geometry](geometry.md#staying-aligned) | matching, and every live effect |
| Coordinate-space rebasing | [geometry](geometry.md#staying-aligned) | matched rects, anchors, and every live effect — [effects](effects.md#coordinate-space-rebasing) |
| Stability flags on a read | [geometry](geometry.md#staying-aligned) | the macOS note pump |
| DIP conversion | [geometry](geometry.md#physical-pixels-points-and-dips) | window placement, all Windows geometry |
| Canvas identification by implied size | [geometry](geometry.md#two-platforms-two-strategies) | the Windows UIA lookup |
| Native placement + debounced reconciliation | [overlay](overlay.md#native-placement-with-debounced-reconciliation) | the overlay window on Windows |
| Cursor-based drag prediction | [overlay](overlay.md#cursor-based-drag-prediction) | overlay and toolbar on Windows |
| Window ownership instead of topmost | [overlay](overlay.md#staying-above-synthv) | the overlay on Windows |
| Visibility and occlusion gating | [overlay](overlay.md#visibility-gating) | overlay, toolbar, tray status |
| No IPC in the per-frame path | [overlay](overlay.md#the-hot-path) | bridge reads, geometry reads |
| Sampling paired values together | [overlay](overlay.md#sampling-paired-values-together) | the transport, the frame transform |
| Docking with hysteresis | [overlay](overlay.md#docking-with-hysteresis) | the toolbar |
| Two summed envelopes | [effects](effects.md#two-summed-envelopes) | glow |
| Smoothed random walk | [effects](effects.md#smoothed-random-walk) | glow jitter |
| Sprite pooling with a hard cap | [effects](effects.md#sprite-pooling-with-a-hard-cap) | particles, trail sparkles |
| Reach-parameterised motion | [effects](effects.md#reach-parameterised-motion) | particles |
| Quantized fade | [effects](effects.md#quantized-fade) | the trail ribbon |
| Join rules | [effects](effects.md#join-rules) | the trail |
| Frame-rate independence | [effects](effects.md#frame-rate-independence) | every effect, emission rates |
| Procedural textures, built once | [effects](effects.md#procedural-textures-built-once) | glow shapes, the spark |
| Blend and tint duality | [effects](effects.md#blend-and-tint-duality) | glow, particles, imported images |
| Synthesized pitch fallback | [effects](effects.md#pitch-following) | pitch following, the settings preview |
| Measured, not documented | [synthv](synthv.md#the-computed-pitch-curve) | everything touching the engine |

## How to write in here

- **English**, like everything else that lands in the repo.
- Say **why** and **where**. Never restate what the code says: an API dump goes stale the
  first time something is renamed, and the module headers in this codebase already carry the
  explanation. Link to them.
- **A technique gets one home.** If it is used in two places, explain it once and link from
  the second — then add it to the index above, in both directions.
- **Every technique entry ends with what breaks.** The failure mode is the thing a reader
  arrives with; without it an entry is trivia.
- Mark **observed** SynthV behaviour as observed. Almost nothing about the engine's pitch
  computation or its menus is documented; a reader has to know which claims came from
  measurement so they know which ones to re-verify.
