import "@testing-library/jest-dom/vitest";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enTranslations from "../locales/en/translation.json";

i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: enTranslations } },
  interpolation: { escapeValue: false },
});

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;
