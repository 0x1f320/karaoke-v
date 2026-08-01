// Persisted user preferences. The main process owns the values and the
// defaults; the renderer only ever imports the type.

export type Preferences = {
  /** Draw note bounding boxes on the overlay. */
  debug: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  debug: false,
}

// Preferences come from a file on disk and from IPC, so neither shape is
// trusted: keep the known keys that carry the right type, drop the rest.
export function sanitizePreferences(input: unknown): Partial<Preferences> {
  const out: Partial<Preferences> = {}
  if (typeof input !== "object" || input === null) {
    return out
  }
  const { debug } = input as Record<string, unknown>
  if (typeof debug === "boolean") {
    out.debug = debug
  }
  return out
}
