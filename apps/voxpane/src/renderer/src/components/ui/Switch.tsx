import { Switch as SwitchPrimitive } from "radix-ui"
import { useDisabled } from "./disabled"

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className = "",
  ...props
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  "aria-label"?: string
}) {
  return (
    <SwitchPrimitive.Root
      {...props}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={useDisabled(disabled)}
      className={`relative h-5 w-9 flex-none rounded-full bg-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app data-[state=checked]:bg-accent ${className}`.trim()}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4.5" />
    </SwitchPrimitive.Root>
  )
}
