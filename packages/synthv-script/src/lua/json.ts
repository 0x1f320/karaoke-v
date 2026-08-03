/**
 * JSON for the Lua host, which has neither a JSON library nor a `JSON` global
 * for typescript-to-lua to compile against.
 *
 * Numbers are the reason this is hand-written rather than a `tostring` loop:
 * Lua 5.4 separates integers from floats, and `tostring` renders a blick that
 * went through a division as `2116800000.0` and a large one as `1e+15`. Blicks
 * must survive the wire exactly, so integers are formatted as integers and
 * floats get 14 significant digits — the precision Lua itself round-trips.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue }

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
}

function encodeString(text: string): string {
  const [escaped] = string.gsub(text, '[%c"\\]', (char: string) => {
    const known = ESCAPES[char]
    return known !== undefined ? known : string.format("\\u%04x", string.byte(char))
  })
  return `"${escaped}"`
}

function encodeNumber(value: number): string {
  if (math.type(value) === "integer") {
    return string.format("%d", value)
  }
  if (Number.isNaN(value) || value === math.huge || value === -math.huge) {
    return "null"
  }
  return string.format("%.14g", value)
}

/**
 * An empty Lua table is indistinguishable from an empty array, and `[]` is the
 * shape the payload actually has an empty case for (a group with no notes), so
 * that is the way the ambiguity is resolved.
 */
export function encodeJson(value: JsonValue): string {
  if (value === null || value === undefined) {
    return "null"
  }

  const kind = type(value)
  if (kind === "number") {
    return encodeNumber(value as number)
  }
  if (kind === "boolean") {
    return value === true ? "true" : "false"
  }
  if (kind === "string") {
    return encodeString(value as string)
  }

  const table = value as Record<string, JsonValue>
  const parts: string[] = []
  const count = (value as JsonValue[]).length
  if (count > 0 || next(table) === undefined) {
    const items = value as JsonValue[]
    for (let i = 0; i < count; i++) {
      parts[i] = encodeJson(items[i])
    }
    return `[${parts.join(",")}]`
  }

  for (const key in table) {
    // A field that is nil has no key at all in Lua, so an omitted key and an
    // explicit `undefined` reach the app the same way: absent.
    parts[parts.length] = `${encodeString(key)}:${encodeJson(table[key])}`
  }
  return `{${parts.join(",")}}`
}
