import i18next, { type i18n } from "i18next"
import { FALLBACK_LANGUAGE, type Language } from "../language"
import en from "./locales/en.json"
import ja from "./locales/ja.json"
import ko from "./locales/ko.json"

// The translation resources and the instance factory. Main and each renderer
// build bundle this file separately and run an instance of their own — they are
// different processes, so there is nothing to share but the strings.

/** The product name, as it appears to the user. */
export const APP_NAME = "Voxpane"

/** The host application, under the full name it carries in its own UI. */
export const SYNTHV_NAME = "Synthesizer V Studio 2"

const resources = {
  ko: { translation: ko },
  en: { translation: en },
  ja: { translation: ja },
}

export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance()
  instance.init({
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    resources,
    // Every resource is already here, so init and changeLanguage settle within
    // the call rather than a tick later — the tray menu and the first paint both
    // read translations the moment they are asked for.
    initAsync: false,
    interpolation: {
      // React escapes what it renders, and the main process is not putting
      // strings into markup at all.
      escapeValue: false,
      // Product names, so no translation has to spell either of them and a
      // rename stays a one-line change.
      defaultVariables: { app: APP_NAME, synthv: SYNTHV_NAME },
    },
  })
  return instance
}
