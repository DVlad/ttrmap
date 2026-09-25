// Verifică ecranul de hartă într-un Chrome real: ce s-a randat, ce dimensiuni are canvas-ul,
// ce erori a dat, și salvează o captură.
//
// De ce există: suita rulează în jsdom, care **nu are layout și nu are WebGL**, deci poate trece verde
// în timp ce în browser nu se vede nimic. Exact asta s-a întîmplat pe 2026-09-24 — harta apărea goală
// din două motive pe care niciun test nu le putea prinde (worker-ul MapLibre nu ajungea în build, iar
// învelișul de `fetch` trimitea credențiale către sursa de tile-uri, care răspunde cu
// `Access-Control-Allow-Origin: *`). Scriptul le-a găsit pe amîndouă în cîteva minute.
//
// Rulare (aplicația trebuie să fie deja pornită):
//   npm run check:map                                   # dev server pe 5173
//   APP_URL=http://localhost:4173 npm run check:map     # build de producție (vite preview)
//
// Folosește Chrome-ul instalat pe mașină (prin `playwright-core`, fără descărcare de browser) și se
// autentifică singur, cu un cont de test creat prin API.

import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const API = process.env.API_URL || `${APP}/api`;
const OUT = process.env.OUT_SUFFIX ?? "";

const email = `harta-${Math.random().toString(36).slice(2, 10)}@example.com`;
const reg = await fetch(`${API}/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "Test-Parola-1234", name: "Test Harta" }),
});
const auth = await reg.json();
console.log("cont de test:", reg.status, auth.user?.id ? `id ${auth.user.id}` : JSON.stringify(auth).slice(0, 200));
if (!reg.ok) process.exit(1);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Sesiunea se injectează înainte de orice navigare: ruta /map e protejată.
await page.addInitScript(
  ([token, refresh, user, accountId]) => {
    localStorage.setItem("ttr_auth_token", token);
    localStorage.setItem("ttr_auth_refresh_token", refresh);
    localStorage.setItem("ttr_auth_user", user);
    localStorage.setItem("ttr_account_id", accountId);
  },
  [auth.token, auth.refreshToken ?? "", JSON.stringify(auth.user), String(auth.user?.id ?? 0)],
);

const consoleLines = [];
const pageErrors = [];
const failedRequests = [];
const requested = [];

page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));
page.on("request", (req) => requested.push(req.url()));
page.on("requestfailed", (req) => failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`));
page.on("response", (res) => {
  if (res.status() >= 400) failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
});

await page.goto(`${APP}/map`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(20000);

const info = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const canvas = document.querySelector(".maplibregl-canvas");
  const aside = document.querySelector("aside");
  return {
    path: location.pathname,
    hasSidebarTitle: document.body.innerText.includes("Harta traseelor"),
    bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 350),
    aside: rect(aside),
    canvas: rect(canvas),
    canvasPixels: canvas ? `${canvas.width}x${canvas.height}` : null,
    mapError:
      document.body.innerText.includes("nu a putut") || document.body.innerText.includes("nu s-au putut"),
    openfreemapResources: performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("openfreemap")).length,
  };
});

console.log("\n=== ce e în pagină ===");
console.log("ruta:", info.path, "| titlul barei laterale:", info.hasSidebarTitle);
console.log("aside:", JSON.stringify(info.aside));
console.log("canvas:", JSON.stringify(info.canvas), info.canvasPixels);
console.log("resurse openfreemap:", info.openfreemapResources, "| mesaj de eroare vizibil:", info.mapError);
console.log("text:", info.bodyText);

console.log("\n=== erori de pagină ===");
console.log(pageErrors.length ? pageErrors.slice(0, 5).join("\n") : "(niciuna)");

console.log("\n=== cereri eșuate ===");
console.log(failedRequests.length ? [...new Set(failedRequests)].slice(0, 10).join("\n") : "(niciuna)");

console.log("\n=== consolă (ultimele 15) ===");
console.log(consoleLines.slice(-15).join("\n") || "(goală)");

await page.screenshot({ path: `C:/projects/ttrmap/.verify/map-screenshot${OUT}.png` });

const viewRequests = requested.filter((url) => url.includes("views/") || url.includes("MapExplorer"));
console.log("\n=== a cerut browserul componenta hărții? ===");
console.log(viewRequests.length ? viewRequests.join("\n") : "(NICIO cerere către views/MapView)");

const mapDependencies = requested.filter(
  (url) =>
    url.includes("maplibre") ||
    url.includes("services/map/") ||
    url.includes("elevationProfile") ||
    url.includes("elevationApi") ||
    url.includes("poiLayer") ||
    url.includes("osmTrails") ||
    url.includes("trailStats"),
);
console.log("\n=== dependențele hărții, cerute de browser ===");
console.log(mapDependencies.length ? mapDependencies.join("\n") : "(NICIUNA — modulul nu s-a executat pînă la capăt)");

console.log(`\ntotal cereri: ${requested.length}`);

// Ce conține de fapt DOM-ul: dacă RouterView-ul e gol, componenta rutei nu s-a randat.
const dom = await page.evaluate(() => {
  const app = document.querySelector("#app");
  const all = app ? app.innerHTML : "(nu există #app)";
  return {
    appExists: Boolean(app),
    length: all.length,
    tail: all.slice(-1200),
    routeCommentNodes: all.match(/<!--[^>]*-->/g)?.slice(-6) ?? [],
  };
});
console.log("\n=== DOM-ul aplicației ===");
console.log("#app există:", dom.appExists, "| lungime innerHTML:", dom.length);
console.log("coada innerHTML:\n", dom.tail);

const external = requested.filter((url) => url.includes("openfreemap"));
console.log("\n=== cereri către sursa de tile-uri ===");
console.log(external.length ? external.join("\n") : "(NICIUNA — MapLibre nu a cerut deloc stilul)");

console.log("\n=== TOATĂ consola ===");
console.log(consoleLines.join("\n") || "(goală)");

// Se randează și alte rute? Izolează dacă problema e la /map sau în toată aplicația.
for (const route of ["/", "/history", "/calendar"]) {
  await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => {
    const app = document.querySelector("#app");
    const content = app?.querySelector("div > div.pb-\\[calc\\(7\\.5rem_\\+_env\\(safe-area-inset-bottom\\)\\)\\]");
    return {
      contentLength: content ? content.innerHTML.length : -1,
      contentPreview: content ? content.innerHTML.slice(0, 120) : "(nu am găsit containerul)",
      textLength: document.body.innerText.length,
    };
  });
  console.log(`${route}: innerHTML=${state.contentLength} | text=${state.textLength} | ${state.contentPreview}`);
}
writeFileSync(
  `C:/projects/ttrmap/.verify/map-report${OUT}.json`,
  JSON.stringify({ info, pageErrors, failedRequests, consoleLines }, null, 2),
);
console.log(`\nscreenshot: .verify/map-screenshot${OUT}.png`);

await browser.close();
