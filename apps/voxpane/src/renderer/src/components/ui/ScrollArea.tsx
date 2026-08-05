import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"
import type { ReactNode } from "react"

export function ScrollArea({
  className = "",
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <ScrollAreaPrimitive.Root
      type="hover"
      scrollHideDelay={500}
      className={`overflow-hidden ${className}`.trim()}
    >
      <ScrollAreaPrimitive.Viewport className="size-full">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none select-none p-0.5"
      >
        <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-white/25 transition-colors hover:bg-white/40" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}
