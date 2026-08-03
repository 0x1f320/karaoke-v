// Which language the UI speaks. Kept apart from the i18n module so preferences
// and the preload can name a language without pulling in every resource bundle.

export const LANGUAGES = ["ko", "en", "ja"] as const

export type Language = (typeof LANGUAGES)[number]

/** What the user picked: a language, or the OS deciding. */
export type LanguagePreference = Language | "system"

export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ["system", ...LANGUAGES]

/** Each language named in itself — never translated. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
}

/** Where anything not covered lands, and the fallback for missing keys. */
export const FALLBACK_LANGUAGE: Language = "en"

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return LANGUAGE_PREFERENCES.includes(value as LanguagePreference)
}

/**
 * The language to actually render in. `locales` is the system's list, most
 * preferred first, in BCP 47 form — only the primary subtag is looked at, so a
 * "ja-JP" system lands on ja.
 */
export function resolveLanguage(
  preference: LanguagePreference,
  locales: readonly string[],
): Language {
  if (preference !== "system") {
    return preference
  }
  for (const locale of locales) {
    const base = locale.toLowerCase().split(/[-_]/)[0]
    const match = LANGUAGES.find((language) => language === base)
    if (match) {
      return match
    }
  }
  return FALLBACK_LANGUAGE
}
