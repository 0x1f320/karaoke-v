import { OverlayScrollbarsComponent } from "overlayscrollbars-react"
import type { ReactNode } from "react"

// Scrollable region with an overlay scrollbar: it floats above the content
// instead of taking a column from it, so a list does not reflow the moment it
// grows past the viewport. Native macOS scrollbars behave this way only while
// "Show scroll bars" is set to automatic — this makes it unconditional.
//
// `os-theme-light` is the light-coloured handle, which is the one that reads on
// this app's dark surfaces.

export function ScrollArea({
  className = "",
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <OverlayScrollbarsComponent
      defer
      className={className}
      options={{
        scrollbars: {
          theme: "os-theme-light",
          // Visible while scrolling and on hover, gone otherwise — the point of
          // an overlay scrollbar is that it is absent until it is wanted.
          autoHide: "leave",
          autoHideDelay: 500,
        },
      }}
    >
      {children}
    </OverlayScrollbarsComponent>
  )
}
