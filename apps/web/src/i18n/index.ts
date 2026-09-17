import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: "fr",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18next;
