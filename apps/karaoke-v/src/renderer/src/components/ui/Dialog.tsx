import { type ReactNode, useEffect, useRef } from "react"

// A modal that stays inside the window it was raised from — a settings prompt
// is part of the settings, not a second app window.
//
// Built on <dialog>, so the focus trap, the inert background, Esc and the
// backdrop come from the platform rather than from hand-rolled key handlers.
// It is mounted only while open, which is also what makes autofocus fire on
// every raise instead of just the first.

export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  description?: string
  /** Esc, a backdrop click, or a control inside calling it. */
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // So the listeners below can be attached once and still call the current
  // handler, rather than being torn down and rebuilt every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) {
      return
    }
    // showModal is what puts it in the top layer and makes the rest inert;
    // rendering the element open would give neither.
    dialog.showModal()

    // Esc closes through the caller instead of the platform, so the state that
    // mounted this stays the one thing deciding whether it is up.
    const onCancel = (event: Event) => {
      event.preventDefault()
      closeRef.current()
    }
    // The backdrop is not an element of its own — a click on it lands on the
    // dialog itself, which the padding-free panel inside can never be.
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) {
        closeRef.current()
      }
    }
    dialog.addEventListener("cancel", onCancel)
    dialog.addEventListener("click", onClick)
    return () => {
      dialog.removeEventListener("cancel", onCancel)
      dialog.removeEventListener("click", onClick)
      dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      className="m-auto w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-app p-0 text-fg shadow-2xl backdrop:bg-black/45"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 id="dialog-title" className="select-none text-sm font-medium">
            {title}
          </h2>
          {description && (
            <p className="select-none text-xs leading-relaxed text-muted">{description}</p>
          )}
        </div>
        {children}
      </div>
    </dialog>
  )
}

/** Right-aligned button row for a dialog's actions, primary last. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2">{children}</div>
}
