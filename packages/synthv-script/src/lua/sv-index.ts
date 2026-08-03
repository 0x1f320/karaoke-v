/**
 * SynthV's Lua API counts from 1 and errors out on 0, while TypeScript counts
 * from 0. Every index handed to the API goes through here, so the conversion is
 * one visible call rather than a `+ 1` that reads like a typo — and `SVIndex`
 * being unforgeable means a raw loop counter cannot reach an API method by
 * accident.
 */
export function svIndex(zeroBased: number): SVIndex {
  return (zeroBased + 1) as SVIndex
}

/** The inverse, for indices the API hands back (`getIndexInParent`). */
export function fromSVIndex(index: SVIndex): number {
  return index - 1
}
