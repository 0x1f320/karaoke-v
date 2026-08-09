import { Gauge, Settings, Sparkles, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconButton } from "./ui/IconButton"

// The narrow sticky-toolbar panel docked beside the SynthV window.
export function Toolbar() {
  const { t } = useTranslation()
  const [effects, setEffects] = useState(false)
  const [audioMeter, setAudioMeter] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.preferences.get().then((p) => {
      setEffects(p.effects)
      setAudioMeter(p.audioMeter)
    })
    return window.preferences.onChange((p) => {
      setEffects(p.effects)
      setAudioMeter(p.audioMeter)
    })
  }, [])

  // The window is held hidden until the first height lands, and a window that
  // has never been shown produces no frames — so a ResizeObserver alone would
  // never fire and the panel would stay invisible for good. offsetHeight forces
  // layout on the spot, which does not need a frame.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const report = () => window.panel.resize(Math.ceil(root.getBoundingClientRect().height))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const toggleEffects = () => {
    const next = !effects
    setEffects(next)
    window.preferences.update({ effects: next })
  }

  const toggleAudioMeter = async () => {
    const next = !audioMeter
    if (next && !(await window.audioMeter.requestAccess())) {
      return
    }
    setAudioMeter(next)
    window.preferences.update({ audioMeter: next })
  }

  return (
    <div
      ref={rootRef}
      className="flex w-full flex-col overflow-hidden rounded-xl bg-app text-fg antialiased"
    >
      <main className="flex flex-col items-center gap-4 px-3 py-5">
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
          on={audioMeter}
          aria-pressed={audioMeter}
          title={t("toolbar.audioMeter")}
          aria-label={t("toolbar.audioMeter")}
          onClick={toggleAudioMeter}
        >
          <Gauge size={20} strokeWidth={1.5} />
        </IconButton>
        <div className="my-1 h-px w-1/2 bg-white/25" />
        <IconButton
          className="w-3/4"
          title={t("toolbar.settings")}
          aria-label={t("toolbar.settings")}
          onClick={() => window.settings.open()}
        >
          <Settings size={20} strokeWidth={1.5} />
        </IconButton>
        <IconButton
          className="w-3/4"
          tone="danger"
          title={t("toolbar.quit")}
          aria-label={t("toolbar.quit")}
          onClick={() => window.app.quit()}
        >
          <X size={20} strokeWidth={1.5} />
        </IconButton>
      </main>
    </div>
  )
}
