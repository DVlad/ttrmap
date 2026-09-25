import { i18n } from "@/i18n";

/**
 * Zgomotul i18n din teste, stins **la sursă**.
 *
 * Mediul de test nu încarcă niciun catalog de traduceri (mesajele se descarcă pe limbă, în chunk-uri):
 * fiecare spec care montează un ecran folosește instanța globală de `i18n`, iar fiecare cheie `t()`
 * produce atunci un avertisment intlify. Sînt mii de linii pe suită, iar ele nu sînt semnal: acoperirea
 * cheilor e verificată de `usedTranslationKeys.spec.ts` (orice cheie folosită în cod trebuie să existe
 * în catalog) și de `catalogParity.spec.ts` (catalogul are exact aceleași chei în toate limbile).
 *
 * Nu e doar cosmetic: volumul de consolă ținea RPC-ul `onUserConsoleLog` al worker-ului ocupat pînă la
 * teardown, iar vitest ieșea cu `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
 * pending` — intermitent și cu **toate testele trecute**, adică un exit code 1 care flutura CI-ul.
 * (Aceeași lecție e notată și în TTR, de unde vine fișierul.)
 */
i18n.global.missingWarn = false;
i18n.global.fallbackWarn = false;
