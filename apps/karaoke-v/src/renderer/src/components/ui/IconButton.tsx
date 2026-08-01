import type { ComponentProps } from "react"

// Icon-only button: no background, hover just brightens the icon. Pass the icon
// as children and size/width via className.
export function IconButton({
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={`inline-flex aspect-square items-center justify-center text-white opacity-50 transition-opacity hover:opacity-80 active:opacity-100 ${className}`.trim()}
      {...props}
    />
  )
}
