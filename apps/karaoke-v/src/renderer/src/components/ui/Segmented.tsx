// Pick one of a handful of named choices, for a SettingRow control slot. Sized
// like the other controls in the column, so rows stay on one grid.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={`flex select-none gap-0.5 rounded bg-border/50 p-0.5 ${className}`.trim()}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded px-3 py-1 text-xs outline-none transition-colors ${
              active ? "bg-accent text-app" : "text-muted hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
