import { ChevronRight } from "lucide-react"
import { Collapsible } from "radix-ui"
import type { ReactNode } from "react"
import { DisabledContext } from "./disabled"
import { Switch } from "./Switch"

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
    <Collapsible.Root asChild open={open} onOpenChange={onOpenChange}>
      <section className="border-b border-border last:border-b-0">
        <div className="flex items-center justify-between gap-6 pt-2.25 pb-3">
          <Collapsible.Trigger className="group flex min-w-0 flex-1 items-start gap-1.5 text-left outline-none">
            <ChevronRight
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              className="mt-0.5 flex-none text-muted transition-[transform,color] group-hover:text-fg group-data-[state=open]:rotate-90"
            />
            <span className="min-w-0">
              <span className="block select-none text-sm">{title}</span>
              {description && (
                <span className="mt-0.5 block select-none text-xs text-muted">{description}</span>
              )}
            </span>
          </Collapsible.Trigger>
          <Switch aria-label={title} checked={enabled} onCheckedChange={onEnabledChange} />
        </div>

        <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
          <DisabledContext.Provider value={!enabled}>
            <fieldset disabled={!enabled} className={`pl-5.5 ${enabled ? "" : "opacity-45"}`}>
              {children}
            </fieldset>
          </DisabledContext.Provider>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  )
}
