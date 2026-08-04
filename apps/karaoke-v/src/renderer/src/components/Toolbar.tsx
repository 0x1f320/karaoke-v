import { Settings, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconButton } from "./ui/IconButton"

// The narrow sticky-toolbar panel docked beside the SynthV window.
export function Toolbar() {
  const { t } = useTranslation()
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
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-app text-fg antialiased">
      <main className="flex min-h-0 flex-1 flex-col items-center gap-4 px-3 py-4">
        <IconButton
          className="w-3/4"
          on={effects}
          aria-pressed={effects}
          title={t("toolbar.effects")}
          aria-label={t("toolbar.effects")}
          onClick={toggleEffects}
        >
          <Sparkles size={20} strokeWidth={1.5} />
        </IconButton>
        <IconButton
          className="w-3/4"
          title={t("toolbar.settings")}
          aria-label={t("toolbar.settings")}
          onClick={() => window.settings.open()}
        >
          <Settings size={20} strokeWidth={1.5} />
        </IconButton>
      </main>
    </div>
  )
}
