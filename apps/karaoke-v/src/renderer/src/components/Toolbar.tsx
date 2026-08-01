import { Settings } from "lucide-react"
import { IconButton } from "./ui/IconButton"

// The narrow sticky-toolbar panel docked beside the SynthV window.
export function Toolbar() {
  return (
    <div className="flex h-full w-full flex-col bg-app text-fg antialiased">
      {/* The window follows SynthV, so the bar is a visual header only — no
          drag region, which would fight the stick observer's positioning. */}
      <header className="flex h-6 flex-none select-none items-center bg-titlebar px-2">
        <span className="text-2xs leading-none font-medium text-muted">KaraokeV</span>
      </header>
      {/* Everything below the title bar, inset 12px on all sides. Buttons span
          the full inset width so they stack as a single column. */}
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <IconButton
          className="w-full"
          title="설정"
          aria-label="설정"
          onClick={() => window.settings.open()}
        >
          <Settings size={20} strokeWidth={1.5} />
        </IconButton>
      </main>
    </div>
  )
}
