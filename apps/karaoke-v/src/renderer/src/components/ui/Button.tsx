import type { ComponentProps } from "react"

// Text button with an optional leading icon, for the commit bar. Two tones only:
// `primary` for the one action a bar is about, `ghost` for the way back out.

const TONES = {
  primary: "bg-accent text-app hover:brightness-110 active:brightness-95",
  ghost: "text-muted hover:bg-white/5 hover:text-fg",
} as const

export function Button({
  tone = "ghost",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { tone?: keyof typeof TONES }) {
  return (
    <button
      type={type}
      className={`inline-flex select-none items-center gap-1.5 rounded px-2.5 py-1.5 text-xs outline-none transition-[background-color,color,filter] focus-visible:ring-1 focus-visible:ring-accent ${TONES[tone]} ${className}`.trim()}
      {...props}
    />
  )
}
