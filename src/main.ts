import "./assets/main.css";
// Paleta aplicației: se importă **după** `main.css`, ca suprascrierile de variabile de culoare să bată
// valorile implicite Tailwind. E aceeași paletă ca în TTR, deliberat — cele două aplicații trebuie să
// arate ca un singur produs, iar culorile straturilor de hartă (trasee, puncte, planificator) vin din ea.
import "./assets/theme.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";

import App from "./App.vue";
import router from "./router";
import { i18n, initialLocale, loadLocaleMessages } from "./i18n";
import { useAuthStore } from "./stores/auth";
import { installAuthenticatedFetch } from "./utils/apiBase";

// După un deploy nou, chunk-urile vechi (hash schimbat) nu mai există pe server — reîncărcăm pagina o
// singură dată, ca să luăm `index.html` și chunk-urile curente.
const RELOAD_FLAG = "ttrmap_chunk_reload";
window.addEventListener("vite:preloadError", () => {
  if (!sessionStorage.getItem(RELOAD_FLAG)) {
    sessionStorage.setItem(RELOAD_FLAG, "1");
    window.location.reload();
  }
});

if ("serviceWorker" in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW: (_serviceWorkerUrl, registration) => {
      const checkForUpdate = () => void registration?.update().catch(() => undefined);
      checkForUpdate();
      window.addEventListener("pageshow", checkForUpdate);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    },
  });
}

const app = createApp(App);
const pinia = createPinia();

// Învelișul de `fetch` care pune tokenul și reînnoiește perechea la expirare. Se instalează **înainte**
// de orice cerere: altfel primele apeluri (restaurarea sesiunii) ar merge fără antet de autorizare.
installAuthenticatedFetch();

app.use(pinia);

const authStore = useAuthStore(pinia);

// Un 401 venit din orice cerere încheie sesiunea și readuce ecranul de autentificare. Fără el, un token
// expirat ar lăsa ecranul de hartă să pară funcțional, dar fără date.
window.addEventListener("ttr:unauthorized", () => {
  authStore.handleUnauthorized();
  if (router.currentRoute.value.name !== "login") {
    void router.replace({ name: "login", query: { redirect: router.currentRoute.value.fullPath } });
  }
});

await authStore.restoreSession();

app.use(router);

// Mesajele limbii active se descarcă într-un chunk separat; le așteptăm înainte de mount, ca primul
// ecran randat să aibă texte, nu chei. Dacă descărcarea eșuează (rețea căzută la prima vizită),
// pornim oricum: UI-ul arată chei pînă la un reload, dar nu rămîne ecran alb.
try {
  await loadLocaleMessages(initialLocale);
} catch {
  console.warn("Mesajele limbii nu au putut fi încărcate; se afișează cheile de traducere.");
}
app.use(i18n);

app.mount("#app");
sessionStorage.removeItem(RELOAD_FLAG);
