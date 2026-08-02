import type { ComponentProps } from "react"

// Icon-only button: no background, hover just brightens the icon. Pass the icon
// as children and size/width via className.
//
// `danger` marks the ones that destroy something. It starts less faded than the
// plain tone — a red dimmed to half reads as a muddy brown rather than as a
// warning.
const TONES = {
  default: "text-white opacity-50 hover:opacity-80",
  danger: "text-danger opacity-75 hover:opacity-100",
} as const

const ON = "text-accent opacity-100"

export function IconButton({
  tone = "default",
  on = false,
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { tone?: keyof typeof TONES; on?: boolean }) {
  return (
    <button
      type={type}
      className={`inline-flex aspect-square items-center justify-center outline-none transition-opacity active:opacity-100 ${on ? ON : TONES[tone]} ${className}`.trim()}
      {...props}
    />
  )
}
