import { ChevronsUpDown } from "lucide-react"
import type { ComponentProps } from "react"

// Pick one of an open-ended list. Segmented covers the closed handful; this
// covers the case where the entries are the user's own and there is no telling
// how many there will be.
//
// A real <select> underneath: the popup, the keyboard handling and the
// type-ahead are the platform's. Only the closed state is restyled — the
// chevron is drawn beside it and the control's own arrow is taken off with
// appearance-none.
export function Select({
  className = "",
  children,
  ...props
}: Omit<ComponentProps<"select">, "size">) {
  return (
    <div className={`relative inline-flex items-center ${className}`.trim()}>
      <select
        // The popup itself is the platform's to draw, and it takes its colours
        // from the scheme rather than from these classes.
        className="w-full appearance-none rounded-md border border-border bg-black/15 py-1.5 pr-8 pl-2.5 text-xs text-fg outline-none [color-scheme:dark] focus-visible:border-accent"
        {...props}
      >
        {children}
      </select>
      <ChevronsUpDown
        size={13}
        strokeWidth={2}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 text-muted"
      />
    </div>
  )
}
