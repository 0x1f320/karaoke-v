import { createRoot } from "react-dom/client"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "../../shared/i18n"
import { resolveLanguage } from "../../shared/language"
import { App } from "./App"
import "./index.css"

const container = document.getElementById("root")

// Rendering waits on the stored language: every window here is small enough to
// paint in one go, and a first frame in the wrong language would be a visible
// flip a moment later.
if (container) {
  Promise.all([window.preferences.get(), window.i18n.systemLanguages()]).then(
    ([preferences, system]) => {
      const i18n = createI18n(resolveLanguage(preferences.language, system))
      window.preferences.onChange((next) => {
        const language = resolveLanguage(next.language, system)
        if (language !== i18n.language) {
          i18n.changeLanguage(language)
        }
      })
      createRoot(container).render(
        <I18nextProvider i18n={i18n}>
          <App />
        </I18nextProvider>,
      )
    },
  )
}
