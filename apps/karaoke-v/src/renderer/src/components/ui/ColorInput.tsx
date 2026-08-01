import type { ComponentProps } from "react"

// Color swatch for a SettingRow control slot.
export function ColorInput({ className = "", ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="color"
      className={`h-7 w-12 rounded border border-border bg-transparent ${className}`.trim()}
      {...props}
    />
  )
}
