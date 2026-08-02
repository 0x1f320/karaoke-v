// Pick one of a handful of named choices, for a SettingRow control slot.
//
// Shaped like the macOS segmented control: one recessed track holding equal-width
// segments, the selected one a raised chip rather than a filled accent — it sits
// beside sliders and a switch, and a saturated block would outshout all of them.
// Radio inputs drive it, so arrow keys move through the segments and the group
// takes one tab stop, which is what the native control does too.
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  className = "",
}: {
  /** Radio group name; must be unique within the window. */
  name: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      className={`inline-flex select-none rounded-md border border-border bg-black/15 p-0.5 ${className}`.trim()}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          // The label is the segment: the input inside it is visually hidden but
          // still focusable, so clicking, arrow keys and focus rings all work
          // without rebuilding radio behaviour by hand.
          <label
            key={option.value}
            className={`relative flex min-w-18 items-center justify-center rounded px-3 py-1 text-xs transition-colors has-focus-visible:ring-1 has-focus-visible:ring-accent ${
              active ? "bg-white/12 text-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={active}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
