import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "./ru";
import uz from "./uz";
import ko from "./ko";

export const LANGUAGES = ["ru", "uz", "ko"] as const;
const KEY = "dm.lang";

function saved(): string {
  try { return localStorage.getItem(KEY) ?? "ru"; } catch { return "ru"; }
}

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, uz: { translation: uz }, ko: { translation: ko } },
  lng: LANGUAGES.includes(saved() as never) ? saved() : "ru",
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: string) {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* private mode: just not remembered */ }
}

export default i18n;
