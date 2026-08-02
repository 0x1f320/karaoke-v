import type { PianoRoll, Rect } from "@karaoke-v/macos-helper"
import { useEffect, useRef } from "react"
import {
  DEFAULT_PREFERENCES,
  type GlowPreferences,
  type ParticlePreferences,
} from "../../shared/preferences"
import { Settings } from "./components/Settings"
import { Toolbar } from "./components/Toolbar"
import { locateNote } from "./playback/locate"
import { Transport } from "./playback/transport"
import { NoteRenderer } from "./render/noteRenderer"
import { BORDER_PX, FILL, glowParams, PLAYING_FILL, particleParams, STROKE } from "./render/palette"

// Interval between full note reads. Note positions are corrected per-frame from
// the viewport read, so this only bounds how stale the note SET can be (edits,
// track switches) — not positional smoothness.
const NOTE_READ_GAP_MS = 30
// Back-off when SynthV / the piano roll isn't found.
const NOT_FOUND_RETRY_MS = 500

function horizontalScale(currentW: number, readW: number): number {
  return currentW > 0 && readW > 0 ? currentW / readW : 1
}

// One renderer bundle serves every window; each is loaded with the hash naming
// its view, the overlay with no hash.
export function App() {
  switch (window.location.hash) {
    case "#toolbar":
      return <Toolbar />
    case "#settings":
      return <Settings />
    default:
      return <Overlay />
  }
}

function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const renderer = new NoteRenderer(canvas)

    // Latest accepted full read. Notes are absolute screen coords as of read
    // time; the draw loop shifts them by how far scroll has moved since —
    // horizontally via contentX, vertically via the reference chip's y (refY).
    // Both are exact pixel deltas read atomically at paint time.
    let read: PianoRoll | null = null

    // Bounding boxes are a debug visualization. Default off, and off until the
    // stored value arrives, so nothing flashes on startup.
    let debug = false
    let particles = particleParams(DEFAULT_PREFERENCES.particles)
    let glow = glowParams(DEFAULT_PREFERENCES.glow)
    const adopt = (p: {
      debug: boolean
      particles: ParticlePreferences
      glow: GlowPreferences
    }) => {
      debug = p.debug
      particles = particleParams(p.particles)
      glow = glowParams(p.glow)
    }
    window.preferences.get().then(adopt)
    const unsubscribe = window.preferences.onChange(adopt)

    // Playback state from the SynthV bridge. It only speaks on transport events;
    // the playhead in between comes from the local clock.
    const transport = new Transport()
    transport.start()

    let alive = true

    // Note pump: continuous off-thread walks, each replacing the set wholesale —
    // no cross-read cache to go stale or corrupt on track switches/edits. Reads
    // taken while scroll/zoom was moving (xStable/yStable false) are discarded:
    // their per-chip coordinates are mutually skewed and unusable. The stale set
    // stays correct meanwhile because draw() maps it through live viewport data.
    const pump = async () => {
      while (alive) {
        let pr: PianoRoll | null = null
        try {
          pr = await window.overlay.readNotes()
        } catch {}
        if (!pr) {
          read = null
        } else if (pr.xStable && pr.yStable) {
          read = pr
        }
        const gap = pr ? (pr.xStable && pr.yStable ? NOTE_READ_GAP_MS : 0) : NOT_FOUND_RETRY_MS
        await new Promise((r) => setTimeout(r, gap))
      }
    }
    pump()

    let raf = 0
    // The note set only reaches the GPU when the pump accepts a new read; every
    // other frame is one transform update and a re-render.
    let uploaded: PianoRoll | null = null
    // The read whose coordinate frame the live particles are currently in.
    let based: PianoRoll | null = null
    // Onset of the note last seen sounding, so a change can strike the glow.
    // Tracked from the schedule, not the rect: a note still starts even on a
    // frame where it could not be matched to one.
    let soundingOnset: number | null = null
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight

      // Boxes are a debug visualization but the playing-note effect is not, so
      // the viewport is read whenever either has something to show — atomically
      // at paint time, so position data is as fresh as possible.
      const vp = debug || transport.playing ? window.overlay.getViewport() : null

      // Scroll movement since the accepted read, in exact pixels. Without a live
      // vertical reference the y position is unknowable — draw nothing rather
      // than notes one lane off (the pump restores the reference within ~50ms).
      // Unlike a 2D context, the scene persists until it is re-rendered, so this
      // still has to render an empty frame to clear what was drawn last.
      if (!vp || !read || vp.refY === undefined) {
        if (uploaded) {
          renderer.clear()
          uploaded = null
        }
        renderer.draw({
          width: w,
          height: h,
          dpr,
          offsetX: 0,
          offsetY: 0,
          scaleX: 1,
          clip: { x: 0, y: 0, w: 0, h: 0 },
          fill: FILL,
          stroke: STROKE,
          border: BORDER_PX,
          playing: null,
          playingFill: PLAYING_FILL,
          emit: null,
          particles,
          noteStarted: false,
          glow,
        })
        return
      }

      // Live particles are positioned in the current read's frame, so they have
      // to move with it when the pump replaces the set mid-flight.
      if (based && based !== read) {
        renderer.rebaseEffects(based, read)
      }
      based = read

      // The note set is only drawn in debug, but it is always read: it is what
      // says where a note actually is on screen.
      const wanted = debug ? read : null
      if (uploaded !== wanted) {
        renderer.setNotes(wanted ? wanted.notes : [])
        uploaded = wanted
      }

      const scaleX = horizontalScale(vp.contentW, read.contentW)
      const contentOffsetX = vp.contentX - read.contentX * scaleX
      const dy = vp.refY - read.refY

      // Which note is sounding, and which rect is it? The bridge answers the
      // first exactly; only the AX read can answer the second.
      let hit: Rect | null = null
      let progress = 0
      let onset: number | null = null
      const view = transport.view
      const seconds = transport.playing ? transport.playhead(window.bridge.monotonicNow()) : null
      if (view && seconds !== null) {
        const note = transport.noteAt(seconds)
        if (note) {
          onset = note.onB
          hit = locateNote(note, view, vp, read.notes, { scaleX, offsetX: contentOffsetX })
          const span = note.offS - note.onS
          progress = span > 0 ? Math.min(Math.max((seconds - note.onS) / span, 0), 1) : 0
        }
      }
      const noteStarted = onset !== null && onset !== soundingOnset
      soundingOnset = onset

      // Sparks come off where the playhead is inside the note, not off the note
      // as a whole — that is what makes the effect read as following the sound.
      const emit = hit ? { x: hit.x + hit.w * progress, y: hit.y + hit.h / 2, spread: hit.h } : null

      // The overlay window covers the whole SynthV window; map global screen
      // coords to window-local ones and clip to the note canvas so nothing draws
      // over the phoneme lane, piano keys, or toolbars.
      const ox = window.screenX
      const oy = window.screenY
      renderer.draw({
        width: w,
        height: h,
        dpr,
        offsetX: contentOffsetX - ox,
        offsetY: dy - oy,
        scaleX,
        clip: { x: vp.canvas.x - ox, y: vp.canvas.y - oy, w: vp.canvas.w, h: vp.canvas.h },
        fill: FILL,
        stroke: STROKE,
        border: BORDER_PX,
        playing: debug ? hit : null,
        playingFill: PLAYING_FILL,
        emit,
        particles,
        noteStarted,
        glow,
      })
    }
    raf = requestAnimationFrame(draw)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      unsubscribe()
      transport.stop()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 block h-full w-full" />
}
