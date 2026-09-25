import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // `transformAssetUrls: false` — în mediul de test, un `src="/pwa-192x192.png"` dintr-un template
  // (asset din `public/`) este transformat într-un import pe care pipeline-ul node al vitest îl
  // rezolvă greșit: `TypeError: The argument 'filename' must be a file URL object… Received
  // 'file:///pwa-192x192.png'`, iar componenta nu se mai poate importa deloc (`InstallAppBanner`).
  // În teste nu avem nevoie de URL-uri de asset rezolvate — în browser ele rămân aceleași string-uri.
  plugins: [vue({ template: { transformAssetUrls: false } })],
  resolve: {
    // Același alias ca în vite.config.ts (vezi comentariul de acolo): altfel testele ar valida altă
    // rezolvare decât bundle-ul de producție.
    alias: [
      { find: /^leaflet$/, replacement: "leaflet/dist/leaflet-src.esm.js" },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
    root: fileURLToPath(new URL("./", import.meta.url)),
    /**
     * Fusul de test e **fixat** (România, +02:00 iarna / +03:00 vara), ca testele care ating ore de
     * perete să fie deterministe. Fără el, un test care apără conversia „oră de perete → instant"
     * (timestamp-uri de server fără fus, ora de sincronizare) ar trece pe o mașină UTC chiar și cu
     * bug-ul prezent, fiindcă acolo ora de perete și UTC-ul coincid.
     *
     * Atenție: blocul `test` din `vite.config.ts` **nu** se aplică — vitest folosește acest fișier și
     * nu îl îmbină cu celălalt —, deci setarea trebuie să stea aici ca să aibă efect.
     */
    env: { TZ: "Europe/Bucharest" },
    // Zgomotul i18n se stinge o singură dată, pentru toată suita — vezi comentariul din fișier.
    setupFiles: ["./src/test/setup.ts"],
  },
});
