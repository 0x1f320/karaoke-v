import { useEffect, useRef } from "react"
import type { GlowPreferences, ParticlePreferences } from "../../../shared/preferences"
import { NoteRenderer } from "../render/noteRenderer"
import { BORDER_PX, FILL, glowParams, particleParams, STROKE } from "../render/palette"

// Live preview of the effect settings. It drives the overlay's own NoteRenderer
// with a synthetic phrase and a playhead sweeping across it, so what shows here
// is produced by the same code that draws on SynthV — not an approximation of it.

/** Notes in the phrase — a rising staircase, every step the same length. */
const NOTE_COUNT = 3
/** Seconds for the playhead to cross the whole phrase once. */
const SWEEP_SEC = 2.4
/** Gap before the sweep restarts, so the onset flash reads as a strike. */
const REST_SEC = 0.45
const NOTE_HEIGHT = 24
const NOTE_INSET_X = 28
/** Pitch step between consecutive notes. */
const NOTE_STEP_Y = 20

export function EffectPreview({
  particles,
  glow,
}: {
  particles: ParticlePreferences
  glow: GlowPreferences
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Read inside the loop rather than captured, so moving a slider takes effect
  // without tearing down the scene.
  const prefsRef = useRef({ particles, glow })
  prefsRef.current = { particles, glow }

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const renderer = new NoteRenderer(host)
    const period = SWEEP_SEC + REST_SEC
    const start = performance.now()
    let lastStrike = ""
    let noteKey = ""
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) {
        return
      }

      const elapsed = (performance.now() - start) / 1000
      const cycle = Math.floor(elapsed / period)
      const phase = elapsed % period

      // Every step gets the same slot, so the three notes come out equal in
      // length however wide the preview is; the staircase is purely vertical.
      const slot = Math.max(w - NOTE_INSET_X * 2, NOTE_COUNT) / NOTE_COUNT
      const topY = Math.round((h - NOTE_HEIGHT - NOTE_STEP_Y * (NOTE_COUNT - 1)) / 2)
      // Edges are rounded once and shared, so consecutive steps butt up against
      // each other with no seam and still come out the same length.
      const edges = Array.from({ length: NOTE_COUNT + 1 }, (_, i) =>
        Math.round(NOTE_INSET_X + slot * i),
      )
      const notes = Array.from({ length: NOTE_COUNT }, (_, i) => ({
        x: edges[i],
        y: topY + NOTE_STEP_Y * (NOTE_COUNT - 1 - i),
        w: edges[i + 1] - edges[i],
        h: NOTE_HEIGHT,
      }))

      // Only on a resize — setNotes marks the geometry dirty, and rebuilding it
      // every frame would be pure waste.
      const key = `${w}:${h}`
      if (key !== noteKey) {
        renderer.setNotes(notes)
        noteKey = key
      }

      // The steps are contiguous, so the playhead runs the phrase legato — each
      // note still strikes its own onset as the head crosses into it.
      const index = Math.min(Math.floor((phase / SWEEP_SEC) * NOTE_COUNT), NOTE_COUNT - 1)
      const note = notes[index]
      const headX = NOTE_INSET_X + (phase / SWEEP_SEC) * slot * NOTE_COUNT
      const sounding = phase < SWEEP_SEC
      const strike = `${cycle}:${index}`

      renderer.draw({
        width: w,
        height: h,
        dpr: window.devicePixelRatio || 1,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        clip: { x: 0, y: 0, w, h },
        fill: FILL,
        stroke: STROKE,
        border: BORDER_PX,
        // The highlight rect is a debug aid on the overlay; here the note bar
        // alone is context enough for judging the effects.
        playing: null,
        playingFill: FILL,
        emit: sounding
          ? {
              x: headX,
              y: note.y + note.h / 2,
              spread: note.h,
            }
          : null,
        particles: particleParams(prefsRef.current.particles),
        noteStarted: sounding && strike !== lastStrike,
        glow: glowParams(prefsRef.current.glow),
      })
      if (sounding) {
        lastStrike = strike
      }
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
    }
  }, [])

  return (
    <div className="overflow-hidden rounded-md border border-border bg-titlebar">
      <div ref={hostRef} className="block h-32 w-full" />
    </div>
  )
}
