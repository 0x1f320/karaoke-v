import { ChevronRight } from "lucide-react"
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
  children,
}: {
  title: string
  description?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  children: ReactNode
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      {/* Padding matches SettingRow's, uneven for the same reason: the title's
          line box has more leading above its glyphs than the description's has
          below, so equal padding reads as a rule sitting too high. */}
      <div className="flex items-center justify-between gap-6 pt-2.25 pb-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="group flex min-w-0 flex-1 items-start gap-1.5 text-left outline-none"
        >
          <ChevronRight
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className={`mt-0.5 flex-none text-muted transition-[transform,color] group-hover:text-fg ${open ? "rotate-90" : ""}`}
          />
          <span className="min-w-0">
            <span className="block select-none text-sm">{title}</span>
            {description && (
              <span className="mt-0.5 block select-none text-xs text-muted">{description}</span>
            )}
          </span>
        </button>
        <div className="flex-none">
          <Switch checked={enabled} onChange={(e) => onEnabledChange(e.currentTarget.checked)} />
        </div>
      </div>

      {/* Collapsing by animating a grid row between 0fr and 1fr: the rows keep
          their natural height, so nothing has to be measured and the group can
          hold anything. The content stays mounted — `inert` is what takes it out
          of the tab order and the a11y tree while it is folded away. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {/* A fieldset so switching the effect off makes its controls genuinely
              inert, not merely faded. Indented to sit under the title, not the
              chevron, so the nesting is legible without a border to draw it.
              No padding of its own: every rule in this list wants the same 12px
              of content above and below it, and the rows already carry that — an
              extra few px here made an expanded group sit lower off its rule
              than a collapsed one does. */}
          <fieldset
            inert={!open}
            disabled={!enabled}
            className={`pl-5.5 ${enabled ? "" : "opacity-45"}`}
          >
            {children}
          </fieldset>
        </div>
      </div>
    </section>
  )
}
