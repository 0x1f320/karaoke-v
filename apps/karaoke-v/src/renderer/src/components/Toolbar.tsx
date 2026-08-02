import { Settings, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { IconButton } from "./ui/IconButton"

// The narrow sticky-toolbar panel docked beside the SynthV window.
export function Toolbar() {
  const [effects, setEffects] = useState(false)

  useEffect(() => {
    window.preferences.get().then((p) => setEffects(p.effects))
    return window.preferences.onChange((p) => setEffects(p.effects))
  }, [])

  const toggleEffects = () => {
    const next = !effects
    setEffects(next)
    window.preferences.update({ effects: next })
  }

  return (
    <div className="flex h-full w-full flex-col bg-app text-fg antialiased">
      {/* The window follows SynthV, so the bar is a visual header only — no
          drag region, which would fight the stick observer's positioning. */}
      <header className="flex h-6 flex-none select-none items-center bg-titlebar px-2">
        <span className="text-2xs leading-none font-medium text-muted">KaraokeV</span>
      </header>
      {/* Everything below the title bar, inset 12px on all sides. Buttons stack
          as a single centred column. */}
      <main className="flex min-h-0 flex-1 flex-col items-center gap-4 px-3 py-4">
        <IconButton
          className="w-3/4"
          on={effects}
          aria-pressed={effects}
          title="노트 이펙트"
          aria-label="노트 이펙트"
          onClick={toggleEffects}
        >
          <Sparkles size={20} strokeWidth={1.5} />
        </IconButton>
        <IconButton
          className="w-3/4"
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
