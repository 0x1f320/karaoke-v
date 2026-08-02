import type { ComponentProps } from "react"

// Range control for a SettingRow slot. The readout is fixed-width and tabular so
// the track does not shift as the number changes under the thumb.
export function Slider({
  className = "",
  readout,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { readout: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <input type="range" className="w-44 accent-accent" {...props} />
      <span className="w-16 select-none text-right text-xs tabular-nums text-muted">{readout}</span>
    </div>
  )
}
