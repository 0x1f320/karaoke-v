import { Slider as SliderPrimitive } from "radix-ui"
import { useDisabled } from "./disabled"

export function Slider({
  value,
  onValueChange,
  readout,
  disabled,
  className = "",
  ...limits
}: {
  value: number
  onValueChange: (value: number) => void
  readout: string
  min: number
  max: number
  step: number
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <SliderPrimitive.Root
        {...limits}
        value={[value]}
        onValueChange={([next]) => onValueChange(next)}
        disabled={useDisabled(disabled)}
        aria-label={readout}
        className="group relative flex h-5 w-44 touch-none select-none items-center data-disabled:cursor-default"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-black/30 inset-ring inset-ring-white/5">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent shadow-[0_0_8px_-2px_var(--color-accent)] transition-colors group-data-disabled:bg-muted group-data-disabled:shadow-none" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-3.5 cursor-pointer rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.5)] ring-1 ring-black/25 outline-none transition-transform hover:scale-115 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app active:scale-95 data-disabled:scale-100 data-disabled:cursor-default data-disabled:bg-muted" />
      </SliderPrimitive.Root>
      <span className="w-16 select-none text-right text-xs tabular-nums text-muted">{readout}</span>
    </div>
  )
}
