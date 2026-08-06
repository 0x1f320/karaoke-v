# Geometry

Where a note is on screen. This is where the subtle bugs live, because the answer is
assembled from two sources that are each authoritative about half of it and neither of
which is fresh.

- The **bridge** knows a note's musical position exactly — but in canvas-local units, and
  its record is tens of milliseconds old by the time it is read.
- The **native helper** knows where rectangles actually are on screen, right now — but not
  which rectangle is which note.

So: the bridge gives a *prediction*, and the prediction **picks** a rectangle rather than
being drawn from. The rectangle is the truth about geometry.

## Coordinate spaces

Four, in order:

1. **Musical** — blicks and semitones. What the schedule is in.
2. **Canvas-local** — pixels within SynthV's piano-roll canvas. What the script's view
   transform is in. Says nothing about where the canvas is.
3. **Screen** — global, top-left origin. Points on macOS, **physical pixels** on Windows.
   What the native helpers report.
4. **Window-local** — CSS pixels inside the overlay window, which is what Pixi draws in.
   Screen minus the window origin.

Between 3 and 4 sits the DIP conversion on Windows, below.

## Two platforms, two strategies

This is the one place the platforms genuinely differ, and the difference is deliberately
**not** hidden behind the abstraction in `shared/native.ts`. A change to one side is
usually not a change to both.

**macOS — read the tree.** SynthV exposes an Accessibility tree, so the note rectangles are
already there. `packages/macos-helper/src/pianoroll.rs` walks it (~50 ms), finds the canvas
from the note area's scrollbar pair, the content group from the widest group aligned to the
canvas' top-left, and returns the visible note rectangles in global screen points. The
bridge only says *which* of them is sounding.

**Windows — compute them.** JUCE draws the whole editor into a single HWND; there is no
tree of note elements to read. So the rectangles are **derived from the script's own view
transform** (`shared/windowsGeometry.ts`, pure and therefore testable off Windows), and
UI Automation is asked for the one thing the script cannot know: where the canvas sits on
screen.

The canvas is identified by **agreement with the bridge**, not by guessing at the layout:
the visible time and value ranges times their px-per-unit give the canvas's exact pixel
size, and `uia.rs` looks for the element with those dimensions in JUCE's flat ~140-element
tree. That check is self-verifying and survives SynthV rearranging its panels.

Consequences worth holding onto:

| | macOS | Windows |
| --- | --- | --- |
| note rects from | the AX tree | arithmetic on the view transform |
| the helper supplies | canvas, scroll, zoom, note rects | the canvas rectangle, and the window origin |
| vertical reference | a tracked note chip's `y` | stated outright by the transform |
| a read can be skewed | yes — the tree is read while it moves | no — the flags are always true |
| needs a user grant | yes, Accessibility | no |
| scroll latency | none (AX is live) | one script tick (16 ms) |

That last row is why the script's idle tick stays at 16 ms even when playback is stopped:
stopped is exactly when the user scrolls, and on Windows the published transform is the
app's only source for where the roll is.

## Physical pixels, points and DIPs

macOS reports points, which is already what Electron positions windows in, so the transform
is the identity and the whole path is a no-op there.

Windows reports **physical pixels** — Win32 and UI Automation both do — while Electron
places windows and lays out renderers in **DIPs**. Only the main process can ask Electron
for the mapping, so `main/dip.ts` derives it from whichever display the target window is on
and pushes it to every renderer. The renderers then convert per-frame geometry locally
(`toDipRect`, `toDipViewport`, `toDipPianoRoll` in `shared/native.ts`) rather than paying
an IPC hop per read.

Symptom of getting this wrong: everything is correct at 100 % scaling and offset
proportionally to the scale factor on a HiDPI display, or correct on the primary monitor
and wrong on a second one with a different scale.

## Matching a note to a rectangle

Three mechanisms, in `playback/locate.ts`, layered because each covers the previous one's
blind spot.

**1. `locateNote` — predict, then snap.** Compute where the note *should* be from the view
mapping and the scroll it was paired with, then take the nearest rectangle whose width
agrees (within 25 %) and whose distance is under the slip limit. Nothing close enough
returns `null`: showing an effect on the wrong note is worse than showing none.

Snapping is what tolerates being slightly wrong, and it works as long as the error stays
well under the spacing between notes.

**2. `followRect` — keep the one you have.** Re-predicting every frame lets a moving roll
snap the effect onto the note next door. Instead, once a note has a rectangle it is
*followed* from read to read: both reads carry the scroll and zoom their coordinates were
taken at, so the old rectangle maps into the new frame exactly and the note's rectangle is
simply the one sitting there (within 6 px). Gone from a read — edited away, scrolled off,
track switched — means match again from scratch.

**3. `ReadAnchor` — one match places every note.** Measured 2026-08-04: the bridge's view
mapping is **18 ms old while playing, 35 ms at the tail**, which at a real scroll speed is
one to two notes of error. So a mapping-built prediction can only ever be a guess about
*which* note it is looking at.

A read can answer that question about itself instead. Every note on a piano roll sits on
one straight line from blicks to pixels, so a **single matched rectangle fixes that line
for the whole read**, and every other note follows by arithmetic — with no bridge latency
in it at all. The mapping keeps only what it is good at: the scale.

Anchors are read-scoped. Carrying one into the next read means rebasing it (`rebaseAnchor`),
exactly as a rectangle is followed.

This is also the gate in `App.tsx`: a fling (>24 px of movement in one frame) may not
**start** a new match, because the prediction is already further out than the gap between
two notes. It does not have to — a match already taken is followed, and the anchor places
everything else. Neither asks the mapping where anything is, so both survive any scrolling.

## Staying aligned

Note rectangles are absolute screen coordinates **as of read time**. The viewport is
sampled at **paint time**. Everything in `playback/frame.ts` is the difference between
those two moments:

| Quantity | Carries |
| --- | --- |
| `contentX` | horizontal scroll — screen x of blick 0 |
| `contentW` | the horizontal zoom, only ever compared against itself |
| `refY` | vertical scroll — screen y of the reference |

`contentW` is not a real content width on Windows; the script never reports one. It is a
fixed span of blicks times `perBlick`, which is proportional to the zoom, which is all
anything needs.

`refY` on macOS is a tracked note chip's `y`. Nothing scalar in SynthV's AX tree follows
vertical scroll — the scrollbar value is dead, there is no thumb child and no moving group
— but chip frames do move, so one cached chip read per frame gives the delta directly.
Without a live vertical reference the y position is genuinely unknowable, and the overlay
draws **nothing** rather than notes one lane off.

**Stability flags.** A macOS read taken while the roll was moving has mutually skewed
coordinates: the chips were sampled at different instants and there is no per-chip
reference to correct against. `xStable` / `yStable` say so, and such a read is discarded
whole. The previous set stays correct meanwhile because it is mapped through live viewport
data anyway. On Windows the rectangles come from one transform, so both flags are always
true.

**Window origin.** The overlay maps global coordinates to window-local ones against
`vp.origin` — the window origin sampled in the same breath as the canvas — falling back to
`window.screenX` only when the helper does not supply one. Chromium updates `screenX` on
its own schedule, so during a drag the two disagree and the drawing slides.

**Effects carry their frame.** Live particles and trail points are positioned in the
coordinate space of whichever read is current, so when the pump replaces the set mid-flight
`rebaseEffects` shifts them by the same delta the notes moved. Without it they jump every
time a read lands during a scroll. That is the same arithmetic as `followRect` and
`rebaseAnchor` above, applied to a different set of things — see
[effects.md](effects.md#coordinate-space-rebasing).

## Invariants

Break one of these and the symptom is listed beside it.

| Invariant | If broken |
| --- | --- |
| A view mapping is only usable paired with the scroll position read in the same frame | effects drift ahead of / behind the notes while scrolling |
| A prediction picks a rectangle; it never *becomes* one | effects sit slightly off the note, consistently |
| A note keeps its matched rectangle for as long as it sounds | the effect hops to a neighbouring note mid-note |
| No new match while the roll is moving fast | a fling lands the effect one or two notes away |
| A read with a stability flag false is discarded whole, not partly | notes skew apart from each other after a scroll |
| No vertical reference means draw nothing | effects appear one lane off, plausibly enough to be missed |
| Window-local mapping uses the origin sampled with the canvas | the drawing slides while the window is dragged |
| Rectangles are one semitone tall | pitch offsets scale wrongly; the trail flattens or exaggerates |

That last one is load-bearing in an unobvious way: the matched rectangle being exactly one
semitone tall is what lets a pitch offset in semitones scale by the rectangle's height and
inherit the existing scroll/zoom alignment for free. `playback/pitch.ts` depends on it —
see [effects.md](effects.md#where-an-effect-is-drawn).

What happens to the rectangle once it is found is [effects.md](effects.md); where the window
it is drawn in comes from is [overlay.md](overlay.md).
