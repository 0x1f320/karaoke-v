import { useEffect, useState } from "react"
import type { StickStatus } from "../../shared/stick-status"

function statusText(status: StickStatus): string {
  switch (status.state) {
    case "attached":
      return status.mode === "ax" ? "Attached to Synthesizer V" : "Attached (polling)"
    case "waiting":
      return "Waiting for Synthesizer V…"
    case "hidden":
      return "Synthesizer V is minimized"
    case "permission":
      return "Grant Accessibility for smooth tracking"
    case "unsupported":
      return "Sticking is macOS-only for now"
  }
}

export function App() {
  const [status, setStatus] = useState<StickStatus>({ state: "waiting" })

  useEffect(() => {
    window.stick.onStatus(setStatus)
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Full-width draggable title bar. Native window controls (macOS traffic
          lights / Windows overlay) float over their corners and stay clickable. */}
      <header className="app-drag relative h-10 flex-none select-none">
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-medium text-neutral-300">
          karaoke-v
        </span>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 text-center text-sm text-neutral-400">
        {statusText(status)}
      </main>
    </div>
  )
}
