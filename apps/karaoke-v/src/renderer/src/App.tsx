import type { PianoRoll } from "@karaoke-v/macos-helper"
import { useEffect, useRef } from "react"

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<PianoRoll | null>(null)

  useEffect(() => {
    window.overlay.onPianoRoll((frame) => {
      frameRef.current = frame
    })

    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) {
      return
    }

    let raf = 0
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const frame = frameRef.current
      if (frame) {
        // Note rects are global screen points; the window is positioned at the
        // canvas rect, so subtract the canvas origin to get overlay-local coords.
        ctx.fillStyle = "rgba(80, 180, 255, 0.25)"
        ctx.strokeStyle = "rgba(120, 210, 255, 0.9)"
        ctx.lineWidth = 1
        for (const n of frame.notes) {
          const x = n.x - frame.canvas.x
          const y = n.y - frame.canvas.y
          ctx.fillRect(x, y, n.w, n.h)
          ctx.strokeRect(x + 0.5, y + 0.5, n.w - 1, n.h - 1)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 block h-full w-full" />
}
