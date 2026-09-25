# TTR Hartă

Aplicația de hartă a proiectului TTR: hartă vectorială, planificator de trasee, puncte montane și — în
curînd — offline pe regiune și urmărire pe traseu.

**De ce e o aplicație separată.** Harta aduce MapLibre plus stratul ei de date, adică peste 1 MB de
JavaScript care se descarcă doar ca să te uiți la o hartă. Aplicația de antrenament n-are nevoie de el
pe niciunul dintre cele 40 de ecrane ale ei, iar offline-ul pe regiune (hartă descărcată pe masiv, DEM,
rutare pe graful local) e o poveste de produs diferită. Cele două se despart aici, dar rămîn **un
singur produs**: același backend, același cont, aceeași paletă.

## Ce e aici

| | |
| --- | --- |
| Harta (`/map`) | MapLibre GL cu tile-uri vectoriale OpenFreeMap, 4 stiluri, fără cheie de API |
| Planificatorul | puncte pe hartă, tragere, anulare, profil de mers, distanță, D+/D−, profil altimetric, salvare, export GPX |
| Puncte montane | cabane, refugii, Salvamont, apă, belvedere, indicatoare — din backend, nu din Overpass la citire |
| Trasee marcate | din Overpass, colorate după `osmc:symbol` |
| Rutarea | prin backend (`POST /api/routing/route`), care cheamă motorul Valhalla al proiectului |

Documentația de hartă, cu măsurătorile care au dus la fiecare decizie:

- [`docs/STUDY-MAP.md`](docs/STUDY-MAP.md) — studiul principal: defecte, paritate cu Mapy, arhitectură,
  offline pe regiune, marcaje montane, fezabilitatea navigării, faze.
- [`docs/F0-MAP-IMPLEMENTATION.md`](docs/F0-MAP-IMPLEMENTATION.md) — foaia de execuție F0, cu
  măsurătorile (dimensiuni offline, timpi Overpass, DEM, comparatia motoarelor de rutare).

## Ce încă **nu** există

Scrise explicit, ca să nu pară gata:

- **Offline pe regiune.** Nu se descarcă nimic pe dispozitiv încă. Studiul are dimensiunile măsurate
  (Făgăraș 8,7 MB la z14) și planul (`§6`), iar poarta de dispozitiv din F0 încă nu e trecută.
- **Urmărirea pe traseu / navigarea.** Doar studiul de fezabilitate (`§8`).
- **Zonele de risc.** Mecanismul există în backend (`MountainPoiCategory.Warning`), conținutul e muncă
  de teren (`§7.3`).
- **Geocodare** de localități și străzi, măsurare de distanțe pe hartă, heatmap.

## Dezvoltare

```powershell
npm install
npm run dev            # http://localhost:5173, cu proxy /api către localhost:5177
```

Backend-ul e cel din TTR:

```powershell
cd C:\projects\ttr\ttr
docker compose up -d postgres redis
dotnet run --project backend\TTR.Api        # pe 5177
```

Rutarea are nevoie de motorul Valhalla, care stă într-un profil Docker separat (prima pornire descarcă
extractul OSM al României și construiește tile-urile, ~6 minute):

```powershell
cd C:\projects\ttr\ttr
docker compose --profile routing up -d valhalla
```

Fără el, aplicația merge în continuare: planificatorul desenează linii drepte și **spune** că rutarea nu
e disponibilă.

### Verificări

```powershell
npm run type-check     # vue-tsc
npm run lint-ci        # oxlint + eslint
npx vitest run         # suita
npm run build          # build de producție
npm run check:map      # deschide harta într-un Chrome real și raportează ce vede
```

`check:map` e verificarea care contează cel mai mult pentru ecranul de hartă: jsdom nu are layout și nu
are WebGL, deci suita poate trece verde în timp ce ecranul e gol. Exact așa s-au ascuns trei defecte
reale pe 2026-09-24 (worker MapLibre neemís, credențiale trimise către sursa de tile-uri, dimensiune
nerecalculată).

```powershell
$env:APP_URL="http://localhost:4173"; $env:API_URL="http://localhost:5177/api"; npm run check:map
```

## Aplicația de pe telefon

Aplicația merge ca PWA (instalabilă, cu precache pentru shell). Pentru pachetul nativ:

```powershell
npx cap add android      # o singură dată, necesită Android SDK
npm run build:android
npm run open:android
```

`android/` nu e în repo: se generează local. `appId` e `com.ttr.map`, diferit de `com.ttr.app` al
aplicației de antrenament — altfel cele două nu pot fi instalate pe același telefon.

## Deploy

```powershell
docker build -t ttrmap .
docker run --rm -p 8081:80 ttrmap
```

`nginx.conf` face SPA fallback și pasează `/api/` către backend. Punctul care a costat odată: `.mjs`
nu e în `mime.types` din imaginea nginx, deci worker-ul MapLibre are `location`-ul lui cu
`default_type text/javascript` — fără el, harta rămîne goală exact în producție.
