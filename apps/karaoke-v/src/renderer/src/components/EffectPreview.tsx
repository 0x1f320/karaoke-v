import { useEffect, useRef } from "react"
import type {
  GlowPreferences,
  ParticlePreferences,
  PitchPreferences,
  TrailPreferences,
} from "../../../shared/preferences"
import { CYCLE_SEC, previewContour, previewEmit, previewPhrase } from "../playback/preview"
import { NoteRenderer } from "../render/noteRenderer"
import {
  BORDER_PX,
  FILL,
  glowParams,
  particleParams,
  REACH_FILL,
  REACH_STROKE,
  STROKE,
  trailParams,
} from "../render/palette"

// Live preview of the effect settings. It drives the overlay's own NoteRenderer
// with a synthetic phrase and a playhead sweeping across it, so what shows here
// is produced by the same code that draws on SynthV — not an approximation of it.

/**
 * The playhead line — white, so it reads against any effect colour. It runs the
 * full width, so the inset before the first note and after the last one is what
 * separates one pass from the next.
 */
const PLAYHEAD_CSS = "rgba(255, 255, 255, 0.85)"
/** CSS px; off the Tailwind scale, so it is set inline. */
const PLAYHEAD_WIDTH = 1.5
const CONTOUR_CSS = "rgba(255, 255, 255, 0.3)"
const CONTOUR_WIDTH = 1
const RIDER_CSS = "rgba(255, 255, 255, 0.9)"
const RIDER_RADIUS = 2.5

function pathOf(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
}

export function EffectPreview({
  particles,
  glow,
  trail,
  pitch,
}: {
  particles: ParticlePreferences
  glow: GlowPreferences
  trail: TrailPreferences
  pitch: PitchPreferences
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // DOM lines rather than Pixi ones: the overlay never draws a playhead or a
  // pitch line — SynthV has its own of both — so these stay preview affordances
  // and out of the shared renderer.
  const headRef = useRef<HTMLDivElement>(null)
  const contourRef = useRef<SVGPathElement>(null)
  const riderRef = useRef<SVGCircleElement>(null)
  // Read inside the loop rather than captured, so moving a slider takes effect
  // without tearing down the scene.
  const prefsRef = useRef({ particles, glow, trail, pitch })
  prefsRef.current = { particles, glow, trail, pitch }

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const renderer = new NoteRenderer(host)
    const start = performance.now()
    let lastStrike = ""
    let noteKey = ""
    let contourKey = ""
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) {
        return
      }

      const { particles, glow, trail, pitch } = prefsRef.current
      const elapsed = (performance.now() - start) / 1000
      const cycle = Math.floor(elapsed / CYCLE_SEC)
      const phase = elapsed % CYCLE_SEC
      const phrase = previewPhrase(w, h)

      // Only on a resize — setNotes marks the geometry dirty, and rebuilding it
      // every frame would be pure waste.
      const key = `${w}:${h}`
      if (key !== noteKey) {
        renderer.setNotes(phrase.notes)
        noteKey = key
      }

      // The head runs edge to edge at a constant speed and sounds only over the
      // notes; the steps being contiguous, that stretch plays legato and each
      // note still strikes its own onset as the head crosses into it.
      const headX = (phase / CYCLE_SEC) * w
      const emit = previewEmit(phrase, headX, pitch)
      const strike = `${cycle}:${emit?.index ?? -1}`
      const boost = emit?.boost ?? 1
      const particleLook = particleParams(particles)
      const glowLook = glowParams(glow)

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
        reaches: [],
        reachFill: REACH_FILL,
        reachStroke: REACH_STROKE,
        playing: null,
        playingFill: FILL,
        emit: emit ? { x: headX, y: emit.y, spread: phrase.notes[emit.index].h } : null,
        trailEmit: emit ? { x: headX, y: emit.trailY, spread: phrase.notes[emit.index].h } : null,
        particles:
          boost === 1 ? particleLook : { ...particleLook, rate: particleLook.rate * boost },
        noteStarted: emit !== null && strike !== lastStrike,
        glow: boost === 1 ? glowLook : { ...glowLook, level: Math.min(glowLook.level * boost, 1) },
        trail: trailParams(trail),
      })
      if (emit) {
        lastStrike = strike
      }

      const head = headRef.current
      if (head) {
        // Centred on the emission point rather than starting at it, so the
        // line straddles where the particles actually come from.
        head.style.transform = `translateX(${headX - PLAYHEAD_WIDTH / 2}px)`
      }

      const riding = pitch.enabled && pitch.mode !== "intensity"
      const contour = contourRef.current
      if (contour) {
        const drawn = riding || trail.enabled
        const wanted = drawn ? `${key}:${pitch.range}` : ""
        if (wanted !== contourKey) {
          contour.setAttribute("d", drawn ? pathOf(previewContour(phrase, pitch.range)) : "")
          contourKey = wanted
        }
      }
      const rider = riderRef.current
      if (rider) {
        rider.style.display = riding && emit ? "" : "none"
        if (riding && emit) {
          rider.setAttribute("cx", headX.toFixed(1))
          rider.setAttribute("cy", emit.y.toFixed(1))
        }
      }
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
    }
  }, [])

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-titlebar">
      <div ref={hostRef} className="block h-32 w-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <path ref={contourRef} fill="none" stroke={CONTOUR_CSS} strokeWidth={CONTOUR_WIDTH} />
        <circle ref={riderRef} r={RIDER_RADIUS} fill={RIDER_CSS} style={{ display: "none" }} />
      </svg>
      <div
        ref={headRef}
        className="pointer-events-none absolute inset-y-0 left-0"
        style={{ background: PLAYHEAD_CSS, width: PLAYHEAD_WIDTH }}
      />
    </div>
  )
}
