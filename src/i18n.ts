import { createI18n } from "vue-i18n";

/**
 * Limbile cu catalog propriu în `src/locales/` (ordinea e cea din selector).
 *
 * Cele trei cataloage au **paritate deplină de chei** între ele, verificată de
 * `catalogParity.spec.ts`. Sînt extrase din cataloagele TTR la mutarea hărții (2026-09-24) și conțin
 * doar secțiunile pe care le folosesc ecranele de aici — vezi `tools/extract-locales.mjs`.
 */
export const SUPPORTED_LOCALES = ["ro", "en", "fr"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Cheia din localStorage pentru limba aleasă (scrisă și de `LanguageSelector`). */
export const LOCALE_STORAGE_KEY = "user-locale";

/**
 * Engleza e referința: e limba în care sînt scrise cheile și catalogul față de care se verifică
 * paritatea celorlalte limbi.
 */
const FALLBACK_LOCALE: SupportedLocale = "en";

type LocaleModule = { default: Record<string, unknown> };

/**
 * Importuri dinamice, deci Vite face un chunk per limbă. Cu trei cataloguri de ~6 KB diferența e mică,
 * dar regula rămîne: nu se încarcă în bundle-ul inițial textele limbilor pe care omul nu le folosește.
 */
const localeLoaders: Record<SupportedLocale, () => Promise<LocaleModule>> = {
  ro: () => import("./locales/ro"),
  en: () => import("./locales/en"),
  fr: () => import("./locales/fr"),
};

function readSavedLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)?.toLowerCase();
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
      return saved as SupportedLocale;
    }
  } catch {
    // localStorage indisponibil (ex. mod privat) — rămîne limba implicită.
  }
  // Include cazul unei limbi salvate cîndva și scoase între timp: se cade pe engleză, nu pe chei brute.
  return "en";
}

export const initialLocale: SupportedLocale = readSavedLocale();

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: FALLBACK_LOCALE,
  // Mesajele se încarcă pe limbă (vezi `loadLocaleMessages`), nu stau în bundle-ul inițial.
  messages: {},
});

const loaded = new Set<SupportedLocale>();

async function loadOne(locale: SupportedLocale): Promise<void> {
  if (loaded.has(locale)) return;

  const messages = (await localeLoaders[locale]()).default;
  i18n.global.setLocaleMessage(locale, messages);
  loaded.add(locale);
}

/**
 * Încarcă mesajele unei limbi (o singură dată) plus catalogul englez, care e fallback-ul.
 *
 * Cataloagele au paritate deplină, deci fallback-ul nu e strict necesar pentru cheile statice — dar
 * rămîne intenționat, ca plasă de siguranță ieftină: dacă un client rulează cod nou cu un chunk de
 * limbă vechi din cache-ul PWA, o cheie nouă cade pe engleză în loc să apară brută în UI.
 */
export async function loadLocaleMessages(locale: SupportedLocale): Promise<void> {
  await loadOne(locale);
  if (locale !== FALLBACK_LOCALE) await loadOne(FALLBACK_LOCALE);
}

/** Comută limba activă; întîi încarcă mesajele, ca UI-ul să nu arate chei brute cît se descarcă. */
export async function setLocale(locale: SupportedLocale): Promise<void> {
  await loadLocaleMessages(locale);
  i18n.global.locale.value = locale;
}
