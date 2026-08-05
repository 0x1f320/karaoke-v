import { Check, ChevronsUpDown } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"
import type { ReactNode } from "react"
import { useDisabled } from "./disabled"

export function Select({
  value,
  onValueChange,
  disabled,
  className = "",
  children,
  ...props
}: {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
  children: ReactNode
  "aria-label"?: string
}) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      disabled={useDisabled(disabled)}
    >
      <SelectPrimitive.Trigger
        {...props}
        className={`inline-flex items-center justify-between gap-2 rounded-md border border-border bg-black/15 py-1.5 pr-2.5 pl-2.5 text-xs text-fg outline-none select-none focus-visible:border-accent data-[state=open]:border-accent ${className}`.trim()}
      >
        <span className="truncate">
          <SelectPrimitive.Value />
        </span>
        <SelectPrimitive.Icon className="flex-none text-muted">
          <ChevronsUpDown size={13} strokeWidth={2} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-app text-fg shadow-xl"
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className="relative flex cursor-pointer items-center rounded py-1.5 pr-2 pl-6 text-xs outline-none select-none data-highlighted:bg-white/10"
    >
      <SelectPrimitive.ItemIndicator className="absolute left-1.5 text-accent">
        <Check size={12} strokeWidth={2.5} aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}
