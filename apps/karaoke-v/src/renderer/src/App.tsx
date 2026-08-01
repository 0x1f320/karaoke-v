import type { PianoRoll } from "@karaoke-v/macos-helper"
import { useEffect, useRef } from "react"
import { Settings } from "./components/Settings"
import { Toolbar } from "./components/Toolbar"
import { NoteRenderer, type Rgba } from "./render/noteRenderer"

// Interval between full note reads. Note positions are corrected per-frame from
// the viewport read, so this only bounds how stale the note SET can be (edits,
// track switches) — not positional smoothness.
const NOTE_READ_GAP_MS = 30
// Back-off when SynthV / the piano roll isn't found.
const NOT_FOUND_RETRY_MS = 500

const FILL: Rgba = [80 / 255, 180 / 255, 255 / 255, 0.25]
const STROKE: Rgba = [120 / 255, 210 / 255, 255 / 255, 0.9]
const BORDER_PX = 1

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
    window.preferences.get().then((p) => {
      debug = p.debug
    })
    const unsubscribe = window.preferences.onChange((p) => {
      debug = p.debug
    })

    let alive = true

    // Note pump: continuous off-thread walks, each replacing the set wholesale —
    // no cross-read cache to go stale or corrupt on track switches/edits. Reads
    // taken while vertical scroll was moving (yStable false) are discarded: their
    // per-chip y values are mutually skewed and unusable. The stale set stays
    // correct meanwhile because scroll shifts it uniformly via refY/contentX.
    const pump = async () => {
      while (alive) {
        let pr: PianoRoll | null = null
        try {
          pr = await window.overlay.readNotes()
        } catch {}
        if (!pr) {
          read = null
        } else if (pr.yStable) {
          read = pr
        }
        await new Promise((r) => setTimeout(r, pr ? NOTE_READ_GAP_MS : NOT_FOUND_RETRY_MS))
      }
    }
    pump()

    let raf = 0
    // The note set only reaches the GPU when the pump accepts a new read; every
    // other frame is one transform update and a re-render.
    let uploaded: PianoRoll | null = null
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight

      // Boxes are all this draws for now, so with debug off there is nothing to
      // position and the AX read is skipped entirely.
      // Otherwise: atomic cheap read at paint time, so position data is as fresh
      // as possible.
      const vp = debug ? window.overlay.getViewport() : null

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
          clip: { x: 0, y: 0, w: 0, h: 0 },
          fill: FILL,
          stroke: STROKE,
          border: BORDER_PX,
        })
        return
      }

      if (uploaded !== read) {
        renderer.setNotes(read.notes)
        uploaded = read
      }

      const dx = vp.contentX - read.contentX
      const dy = vp.refY - read.refY

      // The overlay window covers the whole SynthV window; map global screen
      // coords to window-local ones and clip to the note canvas so nothing draws
      // over the phoneme lane, piano keys, or toolbars.
      const ox = window.screenX
      const oy = window.screenY
      renderer.draw({
        width: w,
        height: h,
        dpr,
        offsetX: dx - ox,
        offsetY: dy - oy,
        clip: { x: vp.canvas.x - ox, y: vp.canvas.y - oy, w: vp.canvas.w, h: vp.canvas.h },
        fill: FILL,
        stroke: STROKE,
        border: BORDER_PX,
      })
    }
    raf = requestAnimationFrame(draw)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      unsubscribe()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 block h-full w-full" />
}
