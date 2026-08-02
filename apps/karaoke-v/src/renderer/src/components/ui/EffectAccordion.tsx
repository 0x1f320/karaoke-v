import type { ReactNode } from "react"
import { Switch } from "./Switch"

// A collapsible group of SettingRows with its own on/off switch. Styled like a
// SettingRow — a rule between entries, nothing boxed — so a group reads as one
// more row in the list rather than a panel dropped into it.
//
// The switch decides whether the effect runs; expanding only decides whether its
// controls are on screen. They are deliberately independent — turning an effect
// off while you tune the other one should not hide where you left its sliders.

export function EffectAccordion({
  title,
  description,
  open,
  onOpenChange,
  enabled,
  onEnabledChange,
  onReset,
  children,
}: {
  title: string
  description?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  /** Shows a reset control in the header when given. */
  onReset?: () => void
  children: ReactNode
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-6 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left outline-none"
        >
          <span
            className={`mt-0.5 select-none text-2xs text-muted transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="min-w-0">
            <span className="block select-none text-sm">{title}</span>
            {description && (
              <span className="mt-0.5 block select-none text-xs text-muted">{description}</span>
            )}
          </span>
        </button>
        {/* Outside the fieldset below, so the values stay recoverable even while
            the effect is switched off. */}
        <div className="flex flex-none items-center gap-3">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="select-none rounded px-1.5 py-0.5 text-xs text-muted outline-none transition-colors hover:bg-white/5 hover:text-fg"
            >
              기본값
            </button>
          )}
          <Switch checked={enabled} onChange={(e) => onEnabledChange(e.currentTarget.checked)} />
        </div>
      </div>

      {open && (
        // A fieldset so switching the effect off makes its controls genuinely
        // inert, not merely faded. Indented to sit under the title, not the
        // chevron, so the nesting is legible without a border to draw it.
        <fieldset disabled={!enabled} className={`pb-1 pl-5 ${enabled ? "" : "opacity-45"}`}>
          {children}
        </fieldset>
      )}
    </section>
  )
}
