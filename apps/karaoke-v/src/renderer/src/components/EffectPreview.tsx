import { useEffect, useRef } from "react"
import type { GlowPreferences, ParticlePreferences } from "../../../shared/preferences"
import { NoteRenderer } from "../render/noteRenderer"
import { BORDER_PX, FILL, glowParams, particleParams, STROKE } from "../render/palette"

// Live preview of the effect settings. It drives the overlay's own NoteRenderer
// with a synthetic note and a playhead sweeping across it, so what shows here is
// produced by the same code that draws on SynthV — not an approximation of it.

/** Seconds for the playhead to cross the note once. */
const SWEEP_SEC = 2.4
/** Gap before the sweep restarts, so the onset flash reads as a strike. */
const REST_SEC = 0.45
const NOTE_HEIGHT = 24
const NOTE_INSET_X = 28

export function EffectPreview({
  particles,
  glow,
}: {
  particles: ParticlePreferences
  glow: GlowPreferences
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the loop rather than captured, so moving a slider takes effect
  // without tearing down the scene.
  const prefsRef = useRef({ particles, glow })
  prefsRef.current = { particles, glow }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const renderer = new NoteRenderer(canvas)
    const period = SWEEP_SEC + REST_SEC
    const start = performance.now()
    let lastCycle = -1
    let noteKey = ""
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) {
        return
      }

      const elapsed = (performance.now() - start) / 1000
      const cycle = Math.floor(elapsed / period)
      const phase = elapsed % period
      const sounding = phase < SWEEP_SEC

      const note = {
        x: NOTE_INSET_X,
        y: Math.round((h - NOTE_HEIGHT) / 2),
        w: Math.max(w - NOTE_INSET_X * 2, 1),
        h: NOTE_HEIGHT,
      }

      // Only on a resize — setNotes marks the geometry dirty, and rebuilding it
      // every frame would be pure waste.
      const key = `${note.x}:${note.y}:${note.w}`
      if (key !== noteKey) {
        renderer.setNotes([note])
        noteKey = key
      }

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
              x: note.x + note.w * (phase / SWEEP_SEC),
              y: note.y + note.h / 2,
              spread: note.h,
            }
          : null,
        particles: particleParams(prefsRef.current.particles),
        noteStarted: sounding && cycle !== lastCycle,
        glow: glowParams(prefsRef.current.glow),
      })
      if (sounding) {
        lastCycle = cycle
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
      <canvas ref={canvasRef} className="block h-32 w-full" />
    </div>
  )
}
