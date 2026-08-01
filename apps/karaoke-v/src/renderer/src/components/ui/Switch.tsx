import type { ComponentProps } from "react"

// On/off toggle for a SettingRow control slot. A real checkbox drives it — the
// input is visually hidden and the track/knob follow it via peer-checked, so
// clicking the label, keyboard focus and form semantics all still work.
export function Switch({ className = "", ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <label className={`relative inline-flex items-center ${className}`.trim()}>
      <input type="checkbox" className="peer sr-only" {...props} />
      <span className="h-5 w-9 rounded-full bg-border transition-colors peer-checked:bg-accent" />
      <span className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </label>
  )
}
