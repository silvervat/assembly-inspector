import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations - ET
import etCommon from './locales/et/common.json';
import etDelivery from './locales/et/delivery.json';
import etInstallation from './locales/et/installation.json';
import etInspection from './locales/et/inspection.json';
import etOrganizer from './locales/et/organizer.json';
import etAdmin from './locales/et/admin.json';
import etErrors from './locales/et/errors.json';
import etTools from './locales/et/tools.json';

// Import translations - EN
import enCommon from './locales/en/common.json';
import enDelivery from './locales/en/delivery.json';
import enInstallation from './locales/en/installation.json';
import enInspection from './locales/en/inspection.json';
import enOrganizer from './locales/en/organizer.json';
import enAdmin from './locales/en/admin.json';
import enErrors from './locales/en/errors.json';
import enTools from './locales/en/tools.json';

// RU and FI will be added later
// import ruCommon from './locales/ru/common.json';
// import fiCommon from './locales/fi/common.json';

export const defaultNS = 'common';
export const resources = {
  et: {
    common: etCommon,
    delivery: etDelivery,
    installation: etInstallation,
    inspection: etInspection,
    organizer: etOrganizer,
    admin: etAdmin,
    errors: etErrors,
    tools: etTools,
  },
  en: {
    common: enCommon,
    delivery: enDelivery,
    installation: enInstallation,
    inspection: enInspection,
    organizer: enOrganizer,
    admin: enAdmin,
    errors: enErrors,
    tools: enTools,
  },
  // ru: { common: ruCommon, ... },
  // fi: { common: fiCommon, ... },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    fallbackLng: 'et',
    supportedLngs: ['et', 'en'], // Add 'ru', 'fi' later

    interpolation: {
      escapeValue: false, // React already escapes
    },

    detection: {
      // Language is loaded from user's database preference (trimble_ex_users.preferred_language)
      // Navigator is used as fallback for initial load before user data is available
      order: ['navigator'],
      caches: [], // Don't cache - database is the source of truth
    },
  });

export default i18n;
