import { RadioGroup } from "radix-ui"
import { useDisabled } from "./disabled"

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className = "",
  ...props
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  "aria-label"?: string
}) {
  return (
    <RadioGroup.Root
      {...props}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      disabled={useDisabled(disabled)}
      orientation="horizontal"
      loop={false}
      className={`inline-flex select-none rounded-md border border-border bg-black/15 p-0.5 ${className}`.trim()}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className="flex min-w-18 items-center justify-center rounded px-3 py-1 text-xs text-muted outline-none transition-colors hover:text-fg focus-visible:ring-1 focus-visible:ring-accent data-[state=checked]:bg-white/12 data-[state=checked]:text-fg data-[state=checked]:shadow-sm"
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
