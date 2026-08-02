import type { ComponentProps } from "react"

// One entry in a sidebar nav. `active` marks the current section. Children lay
// out in a row, so an icon can sit before the label.
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
      className={`flex items-center gap-2 rounded px-3 py-1.5 text-left text-sm outline-none transition-colors ${tone} ${className}`.trim()}
      {...props}
    />
  )
}
