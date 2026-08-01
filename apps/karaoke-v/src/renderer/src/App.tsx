import type { PianoRoll } from "@karaoke-v/macos-helper"
import { useEffect, useRef } from "react"

// Interval between full note reads. Note positions are corrected per-frame from
// the viewport read, so this only bounds how stale the note SET can be (edits,
// track switches) — not positional smoothness.
const NOTE_READ_GAP_MS = 30
// Back-off when SynthV / the piano roll isn't found.
const NOT_FOUND_RETRY_MS = 500

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) {
      return
    }

    // Latest accepted full read. Notes are absolute screen coords as of read
    // time; the draw loop shifts them by how far scroll has moved since —
    // horizontally via contentX, vertically via the reference chip's y (refY).
    // Both are exact pixel deltas read atomically at paint time.
    let read: PianoRoll | null = null

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
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Atomic cheap read at paint time — position data is as fresh as possible.
      const vp = window.overlay.getViewport()
      if (!vp || !read) {
        return
      }

      // Scroll movement since the accepted read, in exact pixels. Without a live
      // vertical reference the y position is unknowable — draw nothing rather
      // than notes one lane off (the pump restores the reference within ~50ms).
      if (vp.refY === undefined) {
        return
      }
      const dx = vp.contentX - read.contentX
      const dy = vp.refY - read.refY

      // The overlay window covers the whole SynthV window; map global screen
      // coords to window-local ones and clip to the note canvas so nothing draws
      // over the phoneme lane, piano keys, or toolbars.
      const ox = window.screenX
      const oy = window.screenY
      const cx = vp.canvas.x - ox
      const cy = vp.canvas.y - oy
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx, cy, vp.canvas.w, vp.canvas.h)
      ctx.clip()

      ctx.fillStyle = "rgba(80, 180, 255, 0.25)"
      ctx.strokeStyle = "rgba(120, 210, 255, 0.9)"
      ctx.lineWidth = 1
      for (const n of read.notes) {
        const x = n.x + dx - ox
        const y = n.y + dy - oy
        ctx.fillRect(x, y, n.w, n.h)
        ctx.strokeRect(x + 0.5, y + 0.5, n.w - 1, n.h - 1)
      }
      ctx.restore()
    }
    raf = requestAnimationFrame(draw)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 block h-full w-full" />
}
