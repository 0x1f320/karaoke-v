import type { ComponentProps } from "react"

// One entry in a sidebar nav. `active` marks the current section.
export function NavItem({
  active = false,
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  const tone = active ? "bg-white/10 text-fg" : "text-muted hover:bg-white/5 hover:text-fg"
  return (
    <button
      type={type}
      className={`rounded px-3 py-1.5 text-left text-sm outline-none transition-colors ${tone} ${className}`.trim()}
      {...props}
    />
  )
}
