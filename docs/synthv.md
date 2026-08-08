# Synthesizer V Studio 2

> 한국어판: **[synthv.ko.md](synthv.ko.md)**. 영어판이 원본이므로, 동작이 바뀌면 여기를 먼저 고치고
> 같은 커밋에서 번역을 맞춘다.

The host application. voxpane draws over its piano roll and reads data out of it through a
script; it never edits a project.

Everything below is what the code assumes and does not restate. Where a claim came from
measurement rather than documentation it says so — those are the ones to re-verify if
something stops adding up.

## What we read out of it

SynthV's object model, down to the part voxpane touches:

```
Project
  └─ TimeAxis              blicks ⇄ seconds (tempo lives here)
  └─ Track
       └─ NoteGroupReference     has a time offset into the track
            └─ NoteGroup         the notes themselves
                 └─ Note         onset, end, pitch, lyrics
```

The bridge follows **one group: the main editor's current group**
(`SV.getMainEditor().getCurrentGroup()`). Not the track, not the project. Switching groups
in the editor changes everything the app is looking at — which is why a group change has to
clear effects that are still in flight (#90).

A note's onset and end are group-relative; the reference's `getTimeOffset()` is what makes
them track-absolute. `bridge/model.ts` adds it once, at collection time, and everything
downstream is in track coordinates.

## Units

Four of them, and they are not interchangeable.

**Blicks** — SynthV's integer time unit. `SV.QUARTER` blicks to a quarter note. Blicks are
*linear in pixels*: the piano roll's x axis is `blick × perBlick`, whatever the tempo does.
This is why note positions are computed from blicks and never from seconds.

**Seconds** — `TimeAxis.getSecondsFromBlick(blick)`. Tempo-dependent, therefore *not*
linear in pixels. This is what the playhead is reported in and what effects are fired off.

Every note on the wire carries **both** (`onB`/`offB` and `onS`/`offS`) because the two
answer different questions: seconds say *when*, blicks say *where*. Converting between them
in the app would mean shipping the tempo map, which changes under edits.

**Semitones** — `note.getPitch()` is a MIDI note number. The vertical axis is
`semitone × perSemitone`, and a note's lane is exactly one semitone tall. That is load-
bearing in the renderer: a pitch offset in semitones scales by the rectangle's height and
needs no mapping of its own.

**Cents** — the pitch curve travels as cents from the note's own pitch, as `int16`:

```math
\text{cents} = \left\lfloor (\text{sample} - \text{pitch}) \cdot 100 + 0.5 \right\rfloor
```

Cents, not absolute pitch, so the value stays small and a note's curve is meaningful without
knowing which note it belongs to. 100 cents is one semitone, which is one lane, which is one
rectangle height — the chain that lets an offset in cents reach the screen with no mapping of
its own.

## The Lua scripting host

Scripts live in one directory per install and are plain `.lua` files:

| OS | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/Dreamtonics/Synthesizer V Studio 2/scripts` |
| Windows | `%USERPROFILE%\Documents\Dreamtonics\Synthesizer V Studio 2\scripts`, or `%APPDATA%\Dreamtonics\Synthesizer V Studio 2\scripts` |

`shared/synthvScript.ts` is the list, in preference order. `SYNTHV_SCRIPTS_DIR` overrides
it, for both the app and the repo's deploy script.

**SynthV reads that directory when it starts.** A file dropped in afterwards is invisible
until either a restart or **Scripts ▸ Rescan**. Measured, since none of it is documented: a
rescan re-executes every script file *and* cancels the timers the previous copy scheduled,
so the old bridge stops publishing rather than running alongside the new one. macOS can
press that menu item through the Accessibility API without opening the menu or taking focus
(`packages/macos-helper/src/scripts.rs`); Windows has no equivalent yet (#78).

### Writing for it

The script is authored in TypeScript and compiled with `typescript-to-lua`. That is a
convenience, not an abstraction — the output is Lua 5.4 and behaves like it:

- `&`, `^`, `>>>` are Lua's **64-bit integer** operators, not JavaScript's 32-bit ones.
- `/` **always** produces a float. Handing one to an API that wants an index or a blick
  count fails with *"number has no integer representation"*. Use `math.floor`.
- The API **counts from 1** and errors on 0. Every index goes through `svIndex()`, whose
  branded return type makes a raw loop counter unable to reach an API method by accident.
- `string.find` returns two values. Comparing the call itself against `undefined` compiles
  to a table comparison that is never nil — see the platform check in `bridge/paths.ts`,
  which is where that bit.

### What the host does not give you

These absences shape the whole bridge design:

- **No `mkdir`.** The only alternative is `os.execute`, i.e. spawning a shell from inside a
  DAW to create one folder. So **the app creates the bridge directory**, and the script
  simply fails to open until it exists.
- **No sockets, no threads.**
- **No viewport-change callback.** The script has to sample navigation every tick to notice
  the next scroll or zoom. It suppresses the `scroll` channel write when all six values are
  unchanged, but it cannot suspend the host getters without adding detection latency.
- **No scheduler but `SV.setTimeout`.** The bridge is a `setTimeout` loop that reschedules
  itself in a `finally` — a throw anywhere in a tick would otherwise end the loop for the
  session while the panel went on showing its last state.
- **No logging anyone outside SynthV can see.** The side panel is the only output surface,
  which is why the panel reports `Last error` and why the smoke script publishes its own
  diagnostics channel.

### The side panel

The bridge is a `SidePanelSection`: `getClientInfo()` declares it, `getSidePanelSectionState()`
renders it. It shows the script version, channel directory, sequence numbers, transport
status, note count and last error — the first thing to look at when debugging.

`SV.refreshSidePanel()` **recreates the widgets**, so a button pressed while a refresh
happens never reaches its callback. That is why the panel is refreshed on state changes
only and never on a timer.

## The computed pitch curve

`SV.getComputedPitchForGroup(ref, startBlick, intervalBlicks, frames)` returns the engine's
rendered pitch for a whole group as one buffer, in MIDI note numbers. voxpane samples it
once per schedule rather than per note — asking note by note would cost hundreds of calls
for the same data.

Four things about it are measured, not documented, and each one caused a visible bug:

1. **It is often absent.** An empty result means the engine has not finished computing
   pitch for that group, which real projects sit in for long stretches. The app falls back
   to a synthesized contour (`playback/pitch.ts`) rather than showing nothing — and the
   caller cannot tell which it got.
2. **Unvoiced frames come back as `0`, not `null`.** The documentation says null. Taken at
   face value, 0 is MIDI 0, which is an offset of about −69 semitones and throws the effect
   clean off the screen. Hence `VOICED_FLOOR`.
3. **The curve runs past the note at both ends** — the engine glides *into* a note before
   it starts and releases *out* of it after it ends, and those are the steepest parts of
   the whole line. Sampling a note's own span alone cuts them off. Every note therefore
   carries `BEND_PAD` (8) samples on each side, and the app mirrors that constant.
4. **Padding needs its own "nothing here" value.** Unvoiced samples *inside* a note hold
   the previous offset, so a consonant does not jerk the effect back — but padding before
   the voice starts has no previous offset, and a held zero reads as "on the note's own
   pitch", firing the effect in empty space ahead of the note. `NO_CURVE` (`int16` floor)
   marks those.

## The view transform

`SV.getMainEditor().getNavigation()` gives:

| Call | Meaning |
| --- | --- |
| `getTimePxPerUnit()` | pixels per blick — the horizontal zoom |
| `getValuePxPerUnit()` | pixels per semitone — the lane height |
| `getTimeViewRange()` | `[leftBlick, rightBlick]` visible |
| `getValueViewRange()` | `[bottomValue, topValue]` visible |

All of it is **canvas-local**. Nothing here says where the canvas is on screen, which is
precisely the gap the native helpers fill.

Both edges of each range are published in one 64-byte `scroll` record, not just the near
one, because Windows identifies the piano-roll element by the pixel size those ranges imply
— see [geometry](geometry.md#two-platforms-two-strategies). The record is written only
after one of the six values changes.

Note the sign convention: `getValueViewRange()` returns bottom first, and the scroll record
stores `viewTop` = `range[1]`, `viewBottom` = `range[0]`.

One more measured detail: **`v2y` centres a lane on its value** rather than starting at it,
so a note's top edge is half a semitone above its pitch. `pianoRollGeometry.ts` subtracts
the half explicitly on both platforms.

## Transport and looping

`SV.getPlayback()` gives `getStatus()` — `stopped` / `playing` / `looping` — and
`getPlayhead()` in seconds.

**Loop bounds are not exposed.** The script *infers* them: while the status is `looping`, a
playhead that jumps backwards is a wrap, and the two ends of that jump become the bounds.
So they are unknown until the first wrap happens, and they are a **smoothing hint only** —
the app re-anchors on the next state record regardless, because it reads the playhead every
frame.

## Versions

The bridge declares `minEditorVersion: 131330`. `SV.getHostInfo()` reports the running
editor's version and OS type; the script writes both into `session.json` at startup, which
is the fastest way to confirm what a user is actually running.
