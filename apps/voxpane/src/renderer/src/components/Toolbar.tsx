import { Gauge, Settings, Sparkles, X } from "lucide-react"
import { Tooltip } from "radix-ui"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { type ToolbarTooltipSide, toolbarTooltipSide } from "./toolbarTooltip"
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

  const effectsLabel = t("toolbar.effects")
  const audioMeterLabel = t("toolbar.audioMeter")
  const settingsLabel = t("toolbar.settings")
  const quitLabel = t("toolbar.quit")
  const itemCount = 4

  return (
    <div
      ref={rootRef}
      className="flex w-full flex-col overflow-hidden rounded-xl bg-app text-fg antialiased"
    >
      <Tooltip.Provider delayDuration={350} skipDelayDuration={100} disableHoverableContent>
        <main className="flex flex-col items-center gap-4 px-3 py-5">
          <ToolbarHint label={effectsLabel} side={toolbarTooltipSide(0, itemCount)}>
            <IconButton
              className="w-3/4"
              on={effects}
              aria-pressed={effects}
              aria-label={effectsLabel}
              onClick={toggleEffects}
            >
              <Sparkles size={20} strokeWidth={1.5} />
            </IconButton>
          </ToolbarHint>
          <ToolbarHint label={audioMeterLabel} side={toolbarTooltipSide(1, itemCount)}>
            <IconButton
              className="w-3/4"
              on={audioMeter}
              aria-pressed={audioMeter}
              aria-label={audioMeterLabel}
              onClick={toggleAudioMeter}
            >
              <Gauge size={20} strokeWidth={1.5} />
            </IconButton>
          </ToolbarHint>
          <div className="my-1 h-px w-1/2 bg-white/25" />
          <ToolbarHint label={settingsLabel} side={toolbarTooltipSide(2, itemCount)}>
            <IconButton
              className="w-3/4"
              aria-label={settingsLabel}
              onClick={() => window.settings.open()}
            >
              <Settings size={20} strokeWidth={1.5} />
            </IconButton>
          </ToolbarHint>
          <ToolbarHint label={quitLabel} side={toolbarTooltipSide(3, itemCount)}>
            <IconButton
              className="w-3/4"
              tone="danger"
              aria-label={quitLabel}
              onClick={() => window.app.quit()}
            >
              <X size={20} strokeWidth={1.5} />
            </IconButton>
          </ToolbarHint>
        </main>
      </Tooltip.Provider>
    </div>
  )
}

function ToolbarHint({
  label,
  side,
  children,
}: {
  label: string
  side: ToolbarTooltipSide
  children: ReactNode
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          align="center"
          sideOffset={5}
          collisionPadding={4}
          className="pointer-events-none z-50 max-w-16 select-none rounded-md border border-white/10 bg-titlebar px-1.5 py-1 text-center text-2xs text-fg leading-tight shadow-xl outline-none break-words"
        >
          {label}
          <Tooltip.Arrow width={8} height={4} className="fill-titlebar" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
