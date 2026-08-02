import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react"
import { type ReactNode, useEffect, useRef } from "react"

// Scrollable region with an overlay scrollbar: it floats above the content
// instead of taking a column from it, so a list does not reflow the moment it
// grows past the viewport. Native macOS scrollbars behave this way only while
// "Show scroll bars" is set to automatic — this makes it unconditional.
//
// `os-theme-light` is the light-coloured handle, which is the one that reads on
// this app's dark surfaces.

/**
 * Property whose transitions change how much there is to scroll.
 *
 * OverlayScrollbars notices DOM mutations and host resizes, but not a descendant
 * growing or shrinking purely in CSS — an accordion folding shut leaves the
 * handle at its old size until something else forces a recompute. Keying the
 * update to this one property keeps it off the colour and opacity transitions
 * all over the tree, which are frequent and change no scroll size.
 */
const RESIZING_PROPERTY = "grid-template-rows"

export function ScrollArea({
  className = "",
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const ref = useRef<OverlayScrollbarsComponentRef>(null)

  useEffect(() => {
    const host = ref.current?.getElement()
    if (!host) {
      return
    }
    // Per frame rather than once at the end: the handle should track the fold
    // while it runs, not snap into place after it.
    // Forced: an unforced update only acts on changes the instance detected for
    // itself, which is exactly what it cannot do here.
    let raf = 0
    const pump = () => {
      ref.current?.osInstance()?.update(true)
      raf = requestAnimationFrame(pump)
    }
    const start = (event: TransitionEvent) => {
      if (event.propertyName === RESIZING_PROPERTY && !raf) {
        pump()
      }
    }
    const stop = (event: TransitionEvent) => {
      if (event.propertyName !== RESIZING_PROPERTY) {
        return
      }
      cancelAnimationFrame(raf)
      raf = 0
      ref.current?.osInstance()?.update(true)
    }

    host.addEventListener("transitionstart", start)
    host.addEventListener("transitionend", stop)
    host.addEventListener("transitioncancel", stop)
    return () => {
      cancelAnimationFrame(raf)
      host.removeEventListener("transitionstart", start)
      host.removeEventListener("transitionend", stop)
      host.removeEventListener("transitioncancel", stop)
    }
  }, [])

  return (
    <OverlayScrollbarsComponent
      defer
      ref={ref}
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
