import { describe, expect, it } from "vitest"
import { FALLBACK_LANGUAGE, isLanguagePreference, LANGUAGES, resolveLanguage } from "./language"

describe("isLanguagePreference", () => {
  it("accepts every supported language and system", () => {
    expect(isLanguagePreference("system")).toBe(true)
    for (const language of LANGUAGES) {
      expect(isLanguagePreference(language)).toBe(true)
    }
  })

  it("rejects anything else", () => {
    for (const value of ["", "KO", "ko-KR", "fr", null, undefined, 0, {}]) {
      expect(isLanguagePreference(value)).toBe(false)
    }
  })
})

describe("resolveLanguage", () => {
  it("returns an explicit choice whatever the system says", () => {
    expect(resolveLanguage("ja", ["ko-KR"])).toBe("ja")
    expect(resolveLanguage("ko", [])).toBe("ko")
  })

  it("follows the system's most preferred supported locale", () => {
    expect(resolveLanguage("system", ["ko-KR", "en-US"])).toBe("ko")
    expect(resolveLanguage("system", ["fr-FR", "ja-JP", "ko-KR"])).toBe("ja")
  })

  it("matches on the primary subtag alone", () => {
    expect(resolveLanguage("system", ["ja-JP"])).toBe("ja")
    expect(resolveLanguage("system", ["ko_KR"])).toBe("ko")
    expect(resolveLanguage("system", ["EN-GB"])).toBe("en")
  })

  it("falls back when the system names nothing supported", () => {
    expect(resolveLanguage("system", ["fr-FR", "de"])).toBe(FALLBACK_LANGUAGE)
    expect(resolveLanguage("system", [])).toBe(FALLBACK_LANGUAGE)
  })
})
