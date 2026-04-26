import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

// Initialize i18next
const baseConfig = localStorage.getItem('appConfig');
let initialLang = 'en-US';
if (baseConfig) {
    try {
        const parsed = JSON.parse(baseConfig);
        if (parsed.language) {
            initialLang = parsed.language;
        }
    } catch {}
}

const resources = {
  'en-US': enUS,
  'zh-CN': zhCN
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang,
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false // React already escapes by default
    }
  });

export default i18n;
