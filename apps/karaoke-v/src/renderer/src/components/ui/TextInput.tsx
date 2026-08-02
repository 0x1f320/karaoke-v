import type { ComponentProps } from "react"

// Single-line text field. Sized like the other controls, recessed like the
// segmented control's track so it reads as somewhere to type rather than
// something to press.
export function TextInput({ className = "", ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="text"
      className={`w-full rounded-md border border-border bg-black/15 px-2.5 py-1.5 text-xs text-fg outline-none placeholder:text-muted/70 focus-visible:border-accent ${className}`.trim()}
      {...props}
    />
  )
}
