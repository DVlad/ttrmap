import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Worker-ul MapLibre, servit de la o cale stabilă.
 *
 * De ce e nevoie: MapLibre nu-și importă worker-ul, ci îl **caută la rulare** lîngă chunk-ul în care
 * a ajuns codul lui (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`). Într-un build Vite,
 * `import.meta.url` e chunk-ul din `assets/`, iar acolo fișierul nu ajunge niciodată — bundler-ul nu
 * vede un import pe care să-l urmărească. Rezultatul e „Worker failed to load", iar harta rămîne
 * goală, deși tile-urile se descarcă.
 *
 * Worker-ul importă la rîndul lui `maplibre-gl-shared.mjs`, deci ambele fișiere trebuie servite
 * **alături** — de aceea sînt tratate împreună, în dev și în build, din același loc.
 */
function maplibreWorker(): Plugin {
  const dir = "maplibre-worker";
  const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(`./node_modules/maplibre-gl/dist/${name}`, import.meta.url)));

  return {
    name: "ttrmap-maplibre-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = files.find((file) => req.url === `/${dir}/${file}`);
        if (!name) return next();
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(read(name));
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({ type: "asset", fileName: `${dir}/${name}`, source: read(name) });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    vueDevTools(),
    maplibreWorker(),
    tailwindcss(),
    VitePWA({
      disable: mode === "android",
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.ico", "pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "TTR Hartă",
        short_name: "TTR Hartă",
        description: "Hartă, planificator de trasee și offline pe regiune.",
        theme_color: "#0d0f12",
        background_color: "#0d0f12",
        display: "standalone",
        id: "/",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Fără lista asta, service worker-ul servește `index.html` în loc să lase cererile de API să
        // ajungă la backend, iar aplicația pare că funcționează și nu întoarce nimic.
        navigateFallbackDenylist: [/^\/api\//, /^\/hubs\//, /\/[^/]+\.[^/]+$/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Aici, spre deosebire de TTR, MapLibre **nu** se exclude din precache: în aplicația asta
        // harta e ecranul principal, nu o pagină pe care mulți n-o deschid niciodată. Chunk-ul rămîne
        // separat (lazy) ca prima încărcare să nu aștepte, dar offline trebuie să fie acolo.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  resolve: {
    alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
  },
  server: {
    proxy: {
      "/api": "http://localhost:5177",
      "/hubs": { target: "http://localhost:5177", ws: true },
    },
  },
  // `vite preview` nu moștenește proxy-ul de dev, iar build-ul de producție cheamă `/api` pe același
  // origin (vezi `.env.production`). Fără blocul ăsta, verificarea build-ului de producție pe
  // `localhost:4173` ajunge cross-origin la API și e refuzată de CORS — exact ce s-a întîmplat la
  // prima rulare a `check:map`. Aici proxy-ul e o comoditate de verificare, nu ceva de producție:
  // în producție nginx face același lucru.
  preview: {
    proxy: {
      "/api": "http://localhost:5177",
      "/hubs": { target: "http://localhost:5177", ws: true },
    },
  },
  test: {
    /** Fusul de test e fixat (România), ca testele care ating ore de perete să fie deterministe. */
    env: { TZ: "Europe/Bucharest" },
  },
}));
