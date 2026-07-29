import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import enTranslations from "../locales/en/translation.json";
import kmTranslations from "../locales/km/translation.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      km: {
        translation: kmTranslations,
      },
    },
    lng: "km", // Set default language to Khmer
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React safely escapes XSS by default
    },
  });

export default i18n;
