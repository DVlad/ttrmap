# Studiu: secțiunea Hartă — planificator de traseu, offline pe regiune, marcaje montane

> **Acest document trăiește acum aici.** Pînă pe 2026-09-24 stătea în repo-ul TTR; odată cu mutarea
> hărții într-o aplicație separată a venit cu ea. Numerele de linie din §2 și §3 trimit la fișiere care
> sînt acum în `C:\projects\ttrmap\src\` — corespondențele de nume sînt în §16. Backend-ul
> (`MountainPoisController`, `ElevationController`, `RoutingController`) a rămas în TTR, fiindcă
> aplicația asta e un al doilea client al aceluiași API.

**Stare:** studiu. **F1 („oprește minciuna") e livrat** (2026-09-23), **F0 e parțial măsurat**, **F2 a
livrat prima felie** (puncte montane din OSM, cu proveniență) și **F3 a livrat harta nouă** (`/map` pe
MapLibre cu tile-uri vectoriale). Ce s-a putut măsura fără telefon și fără VPS e în
[F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md) §2, cu comenzi care se pot repeta. Pleacă de la
trei cereri:
1. harta să funcționeze „ca Mapy" (outdoor, nu harta rutieră de azi);
2. planificatorul de traseu „e cam praf, nu merge ok" — de reparat sau de rescris;
3. **offline cu descărcare de hărți pe regiune**, plus marcaje montane (cabane, refugii,
   zone de risc).

**Data:** 2026-09-23.

**Recomandarea pe scurt:** plansul de azi nu are un bug, are **trei goluri de fundație** — nu are
altitudine (endpoint-ul `/api/elevation` **nu există**, deci D+ afișat e inventat), nu are un motor de
rutare propriu (rulează pe serverul demo public OSRM, profil pietonal rutier, nu de traseu), și nu are
niciun strat de date montane (cabane/refugii/risc). Offline pe regiune **nu se poate construi peste
`tile.openstreetmap.org`** — politicile de utilizare interzic descărcarea în volum, deci offline-ul
cere oricum trecerea la **tile-uri vectoriale într-un singur fișier per regiune**. Concluzia practică:
prima livrare nu e „harta nouă", ci **faza 0 (câteva ore) care oprește minciuna** (D+ inventat, hint de
zoom care contrazice codul, drag care nu face nimic, traseu planificat care nu se poate salva) și un
**F0 cu poartă de decizie** pentru motorul de rutare și pentru modul de citire a tile-urilor offline pe
iOS/Android. Fără F0 nu promitem offline.

**Ce am citit:** `frontend/src/views/MapExplorerView.vue` (911 linii, tot), `components/MapTrack.vue`,
`components/SessionTrackMap.vue`, `components/GroupRouteMap.vue`, `stores/route.ts`,
`services/api/routesApi.ts`, `views/PersonalHeatmapView.vue` (parțial), `backend/TTR.Api/Controllers/`
(lista completă de controllere), `RoutesController.cs`, `OsmCacheController.cs`,
`Application/Services/OsmCachePolicy.cs`, `vite.config.ts`, `locales/ro.ts` (blocul `map`),
`nav/navConfig.ts`, `docs/BACKLOG.md` (punctele despre OSM/hartă), `docs/STUDY-3D-ROUTE.md`.

---

## 1. Ce am înțeles din cerere (și ce am presupus)

| Cererea | Cum am citit-o | Încredere |
| --- | --- | --- |
| „să funcționeze cam ca **mappy**" | [Mapy.com](https://help.mapy.com/offline-maps/) (fost Mapy.cz) — aplicația care se vinde ca „offline hiking maps": hartă outdoor cu trasee marcate, planificator pe profiluri (pe jos / bicicletă / MTB), puncte de interes montane, **descărcare de hartă pe regiuni** | medie — de confirmat cu tine |
| „route planerul e cam praf" | nu e o impresie: are patru defecte concrete, verificabile în cod (§3.1) | mare |
| „offline cu download de hărți pe regiune" | descărcare per **masiv/județ** (alegere din listă) **și** per **„zona traseului meu"** (poligon/buffer în jurul unui GPX) | mare |
| „zonele montane: potențiale **zone de isc** (zone de risc), **cabane**, etc." | **confirmat de tine:** zone de risc / „tricky" / periculoase, **așa cum sînt marcate pe munții noștri** — porțiuni expuse, dificile, semnalizate. Nu e vorba de o prognoză, e vorba de **semnalistica de pe teren** (§7.3) | mare |

### 1.1 Deciziile tale (2026-09-23)

| Întrebare | Răspunsul tău | Ce înseamnă |
| --- | --- | --- |
| Ce sînt „zonele de isc" | zone de risc / periculoase, **cum sînt marcate la noi** | §7.3 se rescrie: catalog de **zone semnalizate** + dificultate pe traseu, nu prognoză de avalanșă |
| Cît de departe cu „ca Mapy" | **fără navigare deocamdată**, dar se studiază fezabilitatea | livrabil nou: **§8, studiu de fezabilitate navigare**, cu recomandare și poartă |
| Arhitectura nouă (vectoriale proprii + DEM) | **merge pe recomandarea mea** | §5 și §6 rămîn cum sînt: Protomaps/OpenFreeMap + PostGIS propriu + Copernicus DEM |
| Sursă de risc avalanșă | nu există; „nu știu despre ce e vorba" | se explică în §7.3.6 și **nu se integrează** nimic din surse neclare |
| Rutare offline în v1 | „cum zici tu" | **nu în v1**: se face offline de **vizualizare + traseul meu + POI**; rutarea offline rămîne F4b, după ce descărcarea funcționează (§6.4) |

---

## 2. Ce există azi (verificat în cod, nu presupus)

### 2.1 Frontend — `MapExplorerView.vue`

| Ce | Unde | Stare |
| --- | --- | --- |
| Hartă Leaflet imperativă, centrată pe România, zoom 7 | `MapExplorerView.vue:341` | funcțional |
| 3 straturi raster: OSM standard (implicit), OpenTopoMap, ESRI satelit | `:194-217`, implicit la `:220` | funcțional, dar toate de la terți |
| Filtre de trasee: marcate (`osmc:symbol`), poteci hiking, MTB, ciclism | `:223-236`, implicite `:240` | funcțional |
| Interogare **Overpass direct din browser**, 3 mirror-uri, timeout 15 s | `:503-507`, `:518` | funcțional, client-side |
| Cache: server (`POST /api/osm-cache`) cu fallback `localStorage`, TTL 24 h local | `:266-287`, `:263-264` | funcțional |
| Re-randare pe schimbare de filtre, din cache | `:709-723` | funcțional |
| Parser `osmc:symbol` → culoare de marcaj + etichetă în popup | `:610-628`, `:641-675` | funcțional, cea mai bună parte a ecranului |
| Legendă de marcaje | `:560-567` | funcțional |
| „Rutele mele" (din DB) + focus pe rută | `:391-428` | funcțional |
| Planificator de traseu (click-uri, OSRM, distanță) | `:725-888` | **parțial rupt** (§3.1) |
| Altitudine/D+/D− pentru traseul planificat | `:851-883` | **nu funcționează deloc** (§3.1.1) |
| Marker-e POI (cabane, refugii, apă, Salvamont) | — | **lipsesc complet** |
| Strat de risc / pantă / iarnă | — | **lipsește complet** |
| Căutare locuri / POI, „unde sunt", măsurare, profil altimetric al planului | — | **lipsesc** |

### 2.2 Backend — ce servește harta azi

| Ce | Unde | Observație |
| --- | --- | --- |
| `GET /api/routes/user/{id}`, `POST /api/routes`, redenumire, ștergere | `RoutesController.cs:38-116` | trasee cu puncte (lat, lon, **altitudine**, dist, pantă) |
| Cache partajat de elemente Overpass pe bbox | `OsmCacheController.cs:24-55` | TTL 30 zile, plafon 2 MB/payload, 5000 rânduri, LRU |
| Politica de cache (cheie validată, span max 10°) | `OsmCachePolicy.cs` | comentariul spune explicit „zoom ≥ 11" |
| Rate limit pe scrierea cache-ului | `RateLimiting.cs:50`, `Program.cs:282` | 600/oră per cont (`BACKLOG.md:472`) |
| **`GET /api/elevation`** | **nu există** | frontend-ul îl cheamă la `MapExplorerView.vue:864`; eșecul e înghițit la `:878-880` |
| **Cache de tile-uri raster** | **nu există** | README spune „cache tile pe backend" — nu e adevărat (`STUDY-3D-ROUTE.md:68-72`) |
| **Motor de rutare propriu** | **nu există** | se folosește `router.project-osrm.org` (`:812`) |

### 2.3 Offline — ce există azi

| Ce | Unde | Ce acoperă |
| --- | --- | --- |
| PWA cu service worker (precache doar shell) | `vite.config.ts:36-47` | **fără `runtimeCaching`**: tile-urile și Overpass nu se cache-uiesc deloc |
| `globPatterns` prinde doar js/css/html/ico/png/svg/woff2 | `vite.config.ts:44` | bundle-ul aplicației |
| Cache OSM în `localStorage`, TTL 24 h | `MapExplorerView.vue:263-331` | doar **vectorii** Overpass, în bugetul de ~5 MB al originii |
| Coadă de scriere offline pe IndexedDB (`ttr-sync-queue`) | `services/storage/syncQueueStore.ts` | **scrieri** (sesiuni, jurnale), nu citiri de hartă |
| Capacitor (Android/iOS) | `frontend/package.json` | nicio strategie de fișiere pentru hărți |

**Consecința directă:** azi, fără rețea, `/map` e o hartă gri cu o listă de trasee. Nu există noțiunea de
„regiune descărcată".

### 2.4 Meniu și acoperire de teste

- `/map` **e** în navigare acum: `nav/navConfig.ts:121-126` (documentul `MOBILE-NAV.md:59` e istoric).
- Accesibil și din căutarea globală: `composables/useGlobalSearch.ts:246`.
- **Zero teste** pentru `MapExplorerView`: în `views/__tests__/` nu există niciun fișier care să-l
  monteze (doar `RideView.spec.ts` și `RunView.spec.ts` ating `MapTrack` incidental). Ecranul cel mai
  complex din aplicație e și cel mai puțin apărat.

---

## 3. De ce „nu merge ok" — defecte concrete

### 3.1 Planificatorul de traseu

> **Notă (2026-09-23):** defectele de mai jos au fost **reparate** — majoritatea în F1 (§9), iar
> altitudinea inventată abia în F2, cînd a apărut sursa reală (`/api/elevation`, DEM Copernicus).
> Textul rămîne ca descriere a stării de dinainte, iar numerele de linie trimit la fișierul de atunci.
> **Toate** sînt reparate acum: rutarea pe serverul public (§3.1.2) și căderea tăcută pe linie dreaptă
> (§3.1.3) au fost înlocuite pe 2026-09-24 de motorul propriu de rutare (§9, F3b).

**3.1.1 D+ și D− sunt inventați.** `doFetchElevations()` cheamă `${API_BASE}/elevation?locations=…`
(`MapExplorerView.vue:864`), dar **endpoint-ul nu există** în niciun controller din
`backend/TTR.Api/Controllers/` și nu e rutat în `Caddyfile`. `fetch` aruncă, `catch`-ul tace
(`:878-880`), iar `plannerElevGain`/`plannerElevLoss` rămân `0` (`:730-731`). Deci ecranul afișează
„Urcuș (D+) 0 m" ca și cum ar fi un răspuns. README-ul promite „elevație estimată" — nu există.
Același lucru e notat deja în `STUDY-3D-ROUTE.md:61-67` și `:303-304`.

**3.1.2 Rutarea e pe serverul demo public, cu profil pietonal rutier.** `fetchOsrmSegment()`
(`:810-824`) lovește `router.project-osrm.org` cu profilul `foot`. Consecințe:
- nu e un endpoint de producție (fără SLA, fără cheie, poate fi limitat oricând);
- profilul `foot` **nu e conștient de trasee montane** — nu știe `sac_scale`, nu preferă poteca
  marcată, taie prin drumuri forestiere sau pe șosea;
- **nu există profil de bicicletă / MTB / gravel**, deși aplicația are ride, grupuri și planuri de
  ciclism;
- fără altitudine, ruta nu poate fi ponderată pe pantă (adică exact ce contează la munte).

> **Reparat (2026-09-24, F0 #2 → F3).** Planificatorul cheamă acum `/api/routing/route`, iar backend-ul
> cere ruta motorului nostru (Valhalla auto-găzduit). Măsurătorile care au fundamentat schimbarea, pe
> trasee montane reale, sînt în [F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md) §4.1: pe un traseu
> marcat, OSRM răspundea **41,02 km** în loc de **6,20 km**, cu **0,1%** din rută pe traseul marcat;
> Valhalla a stat pe traseu **100%**. Rezumatul livrării e în §9 (F3b).

**3.1.3 Căderea pe linie dreaptă e tăcută.** Dacă OSRM eșuează, `catch`-ul întoarce `[from, to]`
(`:822`) — o linie dreaptă de 4 km peste un munte, raportată ca traseu, cu distanță mai mică decât
realitatea și fără niciun avertisment în UI.

> **Reparat (2026-09-24).** Cînd motorul nu răspunde, backend-ul întoarce **503** cu un mesaj citibil,
> iar ecranul desenează în continuare linii drepte, dar **spune** într-o bandă galbenă că rutarea nu e
> disponibilă și că traseul nu urmează drumuri. Cele două situații nu mai arată la fel.

**3.1.4 Drag-ul pe puncte e un buton mort.** Markerii sunt creați `draggable: true` (`:783`) și au
handler de `drag` (`:784`), dar `updateSegmentsFromDrag()` e **gol, cu `TODO`** (`:885-888`). Deci
utilizatorul poate trage de puncte, iar polilinia, distanța și D+ rămân cele vechi — ecranul minte.

**3.1.5 Rezultatul nu se poate salva.** `saveRoute` există și e folosit doar la import de GPX
(`stores/route.ts:54`). Planificatorul nu apelează niciodată nimic care să persiste — nici în DB
(`POST /api/routes`), nici în listă, nici în GPX. Traseul planificat moare la primul click pe „✕" sau
la ieșirea din ecran (`plannerClear`, `:745-755`). **Un planificator din care nu poți pleca cu
traseul e un demo, nu o funcție.**

**3.1.6 La „Anulează ultimul" rămâne D+ vechi.** `plannerUndo()` (`:757-766`) scoate punctul și
polilinia, apoi cheamă doar `recalcStats()` (`:826-839`), care recalculează **strict distanța**.
`plannerElevGain`/`plannerElevLoss` nu sunt resetate și nu se recalculează (recalcularea se declanșează
doar la un segment nou, `:802`), deci valorile vechi rămân afișate.

**3.1.7 Alte lipsuri de planificator:** fără reordonare de puncte, fără „dus-întors" sau „buclă",
fără alternative de rută, fără profil altimetric al traseului planificat (deși aplicația are unul
foarte bun pentru GPX, în `RideView`), fără timp estimat, fără export GPX, fără a trimite ruta către
ride/grup/ceas.

### 3.2 Harta în ansamblu

**3.2.1 Hint-ul de zoom contrazice codul.** Interfața scrie „Zoom ≥ 11 pentru trasee OSM"
(`locales/ro.ts:2140`) și „Mărește zoom-ul pentru a vedea traseele de hiking" (`:2160`), dar codul taie
la `MIN_ZOOM = 13` (`MapExplorerView.vue:333`) — iar `OsmCachePolicy` e construită pentru ≥ 11
(comentariul ei). Deci la zoom 11–12 utilizatorul vede mesajul „mărește zoom-ul" și nu înțelege la ce.
Aici se vede și simptomul „nu merge ok": **harta e goală exact la zoom-ul de ansamblu** (7–12), adică
în starea în care te uiți la o zonă nouă.

**3.2.2 Un obiect Leaflet per membru de relație.** `renderOsmRoutes()` adaugă câte o `L.polyline` pentru
fiecare way membru al fiecărei relații (`:685-691`) și încă una per way (`:701-703`). Pentru o zonă
montană reală asta înseamnă mii de straturi, fiecare cu popup propriu; numărul e recalculat prin
scanarea grupului (`:706`). Fără clustering, fără simplificare, fără randare pe canvas. **Aici e
costul real de performanță al ecranului**, nu în numărul de requesturi.

**3.2.3 Watcher profund peste toate punctele.** `watch(() => routeStore.routes, renderMyRoutes, { deep: true })`
(`:389`) reconstruiește toate poliliniile la orice modificare — semnalat deja în auditul de frontend
(`docs/audit-frontend.md`, H14).

**3.2.4 Cache-ul e consultat, dar nu e „încălzit".** `restoreCache()` (`:315-331`) citește **doar**
`localStorage`; cache-ul partajat din DB (30 de zile, util altui utilizator) e verificat abia per bbox
la zoom ≥ 13 (`:460`). Un utilizator nou pe o zonă deja cercetată de altcineva tot pleacă spre Overpass.

**3.2.5 Cheia de bbox se schimbă la fiecare pan.** `bboxKey()` rotunjește la 1 zecimală (`:443-450`),
dar e calculată din **viewport-ul curent**, deci fiecare pan/zoom nou = cheie nouă = request nou către
Overpass (până la 3 mirror-uri × 15 s). Cu plafonul de 600 de scrieri/oră, o explorare serioasă a
câtorva masive poate atinge peretele.

**3.2.6 Overpass direct din client.** Interogarea se compune în browser (`:483-498`) și se trimite la
mirror-uri publice. Pentru un produs asta înseamnă: fără control, fără SLA, fără posibilitate de a
servi offline, plus suprafață de atac pentru conținut (cache-ul partajat a fost deja securizat în
`BACKLOG.md` #7, dar rămâne un cache scriibil de orice cont, prin design). **Măsurat (2026-09-23):**
pentru un singur masiv (Făgăraș), interogarea a luat **177,7 secunde**, iar mirror-ul principal a
răspuns `HTTP 504`. Nu e o problemă de optimizare — e dovada că Overpass nu poate sta în calea critică.

**3.2.7 Etichete neinternaționalizate.** `TILE_LAYERS[].label` (`:197`, `:205`, `:212`) sunt șiruri
românești scrise direct în cod, deci nu apar în cataloagele de traducere (aceeași clasă de problemă
notată în `docs/audit-frontend.md` pentru cataloagele fr/es/it).

### 3.3 Offline

Azi nu există offline de hartă, în niciun înțeles al cuvântului:
- tile-urile nu se cache-uiesc (`vite.config.ts:36-47`, fără `runtimeCaching`);
- vectorii se cache-uiesc 24 h în `localStorage`, adică în același buget de ~5 MB cu restul aplicației
  (risc notat deja în `docs/audit-frontend.md`);
- nu există listă de regiuni, progres de descărcare, dimensiune, ștergere, versiune sau reîmprospătare;
- nu există strategie pentru Capacitor (iOS `capacitor://localhost` **nu suportă service worker** —
  de asta „îl punem în SW" nu e un răspuns suficient pentru aplicația nativă; de verificat în F0).

Și un blocaj de licență: `tile.openstreetmap.org` **interzice explicit descărcarea sistematică în
volum** (politica de utilizare a tile-urilor OSM), la fel OpenTopoMap. Deci „descarcă regiunea" nu se
poate construi peste furnizorii actuali, oricât de mult am vrea. **Offline-ul forțează oricum schimbarea
de arhitectură** — ceea ce e un argument pentru a o face o dată, bine, nu de două ori.

---

## 4. Ce înseamnă „ca Mapy" (matrice de paritate)

Lista de feature-uri Mapy e din cunoștințele mele despre produs (`help.mapy.com/offline-maps`); nu am
putut deschide pagina în acest mediu, deci **de confirmat pe ecranele reale** înainte de a fixa scopul.

| Feature Mapy | Avem | Verdict |
| --- | --- | --- |
| Hartă outdoor cu trasee marcate, colorate pe marcaj | ✅ parțial (`osmc:symbol`) | **păstrăm** — e chiar punctul nostru forte |
| Planificator pe profiluri (pe jos / bicicletă / MTB / schi) | ❌ (doar `foot` demo) | **de făcut** (§5.3) |
| Profil altimetric al rutei + timp estimat | ❌ | **de făcut** (blocat de DEM) |
| POI montane: cabane, refugii, restaurante, puncte de belvedere | ❌ | **de făcut** (§7) |
| Căutare locuri + POI | ❌ | de făcut (necesită geocoder) |
| Descărcare hartă pe regiune (offline) | ❌ | **de făcut** (§6) |
| Rutare offline în regiunea descărcată | ❌ | F0/decizie (§6.4) |
| Strat de iarnă (pârtii, trasee de schi) | ❌ | opțional, ieftin după §5.2 |
| Urmărire pe traseu („unde sînt pe traseu", abatere, voce) | ❌ | **fezabil ieftin** — studiu în §8, se poate face fără backend nou |
| Navigare turn-by-turn adevărată | ❌ | studiu în §8; **nu în v1** |
| Recoltare traseu (tracking) | ✅ există în `/run`, `/ride` | de reutilizat, nu de rescris |
| Hartă personală / heatmap | ✅ `/heatmap` separat | de adus ca strat în harta nouă |
| Strat foto, trafic | ❌ | **nu facem** (§10) |

---

## 5. Arhitectura propusă

### 5.1 Decizia de bază: Leaflet rămâne, `/map` trece pe vectorial

Nu propun „al doilea motor de hărți ca să vedem" (`STUDY-3D-ROUTE.md:269` avertizează exact despre
asta). Propun o graniță clară:

| Ecran | Motor | De ce |
| --- | --- | --- |
| `MapTrack`, `SessionTrackMap`, `GroupRouteMap`, heatmap | **Leaflet, neschimbat** | hărți mici, o polilinină, deja testate, ieftine |
| `MapExplorerView` (`/map`) | **MapLibre GL JS + tile-uri vectoriale** | 4 straturi de date peste aceeași bază, stilizare declarativă, offline dintr-un singur fișier |

Motivul nu e estetic, e structural: cu vectoriale, „trasee marcate + MTB + piste + POI + pantă" sunt
**straturi într-un stil**, nu mii de obiecte Leaflet (§3.2.2). Iar offline-ul devine **un fișier**.

Cost: MapLibre ~220–250 KB gzip (`STUDY-3D-ROUTE.md:105`, estimare de măsurat), chunk încărcat lazy
doar pe `/map`, excluse din precache-ul PWA (`vite.config.ts:44`).

### 5.2 Sursele de date

| Strat | Sursă propusă | Licență / observație |
| --- | --- | --- |
| Bază hartă (vectorial) | **Protomaps** basemap (schemat Shortbread) sau **OpenFreeMap** | date ODbL (OSM), extracție per bbox cu `pmtiles extract` — **de verificat** în F0 |
| Trasee marcate / poteci / MTB | OSM, dar **servite de noi** (PostGIS + tile-uri vectoriale proprii) | ODbL, cu atribuire; elimină Overpass din calea critică |
| POI montane | OSM + catalog propriu cu proveniență (§7.2) | ODbL + date proprii |
| Altitudine / DEM | **Copernicus GLO-30** (global, 30 m) sau SRTM 1″ | ambele gratuite; Copernicus cere atribuire — **de confirmat licența exactă** |
| Umbrire de relief + bandă de pantă | precalculată din DEM, raster teren (stil terrarium) | derivat, stocabil |
| Piste de schi / strat iarnă | OSM (`piste:type`, `piste:difficulty`) | ODbL |
| Risc avalanșă | **nu există în OSM**; vezi §7.3 | — |

Pipeline-ul „servite de noi" e o schimbare de backend (import Geofabrik România → PostGIS → tile-uri
vectoriale), dar rezolvă simultan: Overpass scos din client (§3.2.6), cache-ul comun oricum existent
devine inutil, iar **extracția pentru offline devine o singură comandă** pe același set de date.
Alternativa (rămânem pe Overpass online + Protomaps doar pentru offline) e mai ieftină acum și mai
scumpă mai târziu; o las ca variantă B explicită în §13.2.

### 5.3 Motorul de rutare — decizia F0

Planificatorul actual nu se „repară", se **înlocuiește** (`:810-824`). Candidate, cu ce contează
pentru hiking:

| Candidat | Profiluri | `sac_scale` / potecă | Pantă | Note |
| --- | --- | --- | --- | --- |
| **Valhalla** (self-hosted, MIT) | pedestrian, bicycle, MTB | `use_trails`, **`max_hiking_difficulty`** (scară SAC) | penalizare de pantă, altitudine | alternativa de buclă, `isochrone`, Docker; **recomandarea mea** |
| **GraphHopper** (self-hosted) | hike, bike, mtb, racingbike | `hike` cu preferințe de traseu | `elevation` în profil | matur, licență de verificat pentru ediția comercială |
| **BRouter** (Java) | hiking, MTB, trekking | foarte bun pe trasee | **conștient de altitudine** | singurul care rulează și **pe dispozitiv** (app Android) — candidat pentru rutare offline |
| **OSRM** self-hosted | foot/bike (Lua) | slab pe `sac_scale` | nu nativ | doar dacă vrem efort minim |
| Client-side A* pe graful de trasee descărcat | „doar trasee marcate" | perfect controlabil | cu DEM local | foarte potrivit produsului (§6.4), dar e cod propriu de scris |

**Recomandare:** F0 compară **Valhalla** (online, principalul) cu **A\* peste graful descărcat**
(offline, doar trasee marcate). BRouter rămâne planul B pentru offline dacă A* iese prea scump.

Valhalla nu e doar pentru planificator: el e și backend-ul de rutare al variantei de **navigare** din
§8.3 (Ferrostar are adaptor Valhalla), deci F0 se uită la amîndouă cînd alege.

**Decis (2026-09-24): Valhalla, găzduit de noi.** Poarta din F0 a trecut fără discuție — pe trasee
montane reale, OSRM-ul public ocolea de la 6 la 20 de ori mai mult și rata complet traseul marcat.
Numerele sînt în [F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md) §4.1, iar livrarea în §9 (F3b).

Ce am aflat construind tile-urile (măsurat, nu presupus):

| | Valoare |
| --- | --- |
| Extract OSM România (Geofabrik) | 313,6 MB |
| Construcția tile-urilor, 10 fire | **356 s** (~6 minute) |
| Tile-uri rezultate | **378 MB** |
| Memorie în repaus, după construcție | 81 MB RSS (tile-urile se citesc prin `mmap`) |
| Latență rută (pedestrian, 2 puncte) | **4–263 ms**, tipic sub 15 ms |

Adică **nu** e nevoie de o cutie separată: 378 MB de disc și ~100 MB de memorie încap pe VPS-ul de
~5 €, iar construcția se face o dată, în volumul propriu.

### 5.4 Ce înseamnă concret pentru `MapExplorerView.vue`

Fișierul de 911 linii se sparge, nu se patchuiește:

```
views/MapExplorerView.vue          → shell: layout, stare, legătura cu store-urile
components/map/MapCanvas.vue       → MapLibre + stiluri + straturile
components/map/MapPoiLayer.vue     → POI montane (cabane, refugii, apă, Salvamont)
components/map/MapRiskLayer.vue    → bandă de pantă + avertizări
components/map/RoutePlannerPanel.vue → planificatorul (puncte, profil, salvare, export)
composables/useTrailPlanner.ts     → stare pură: puncte, segmente, statistici  (testabil fără hartă)
composables/useOfflineRegions.ts   → descărcare/ștergere/reîmprospătare regiuni
services/map/tiles.ts              → surse de tile-uri (online / offline), o singură abstracție
```

Regula care aduce cea mai multă valoare: **logica de planificare și de statistici iese din componentă**
(`useTrailPlanner`), exact cum `routeProgress`/`routeMarkers` au fost scoase din harta de grup
(`BACKLOG.md:4396`) — ca să poată fi testată fără Leaflet/MapLibre. Azi nu există niciun test care să
atingă planificatorul.

---

## 6. Offline pe regiune

### 6.1 Ce e „o regiune"

Două modalități, ambele necesare (Mapy are prima; a doua e ce vrea un montaniard):

1. **Regiune administrativă/masiv**, aleasă din listă: județ, sau masiv (Făgăraș, Retezat, Bucegi,
   Piatra Craiului, Ceahlău…). Lista de masive nu există în proiect — se definește ca date statice
   (nume + bbox/poligon), ~50–100 de intrări pentru România.
2. **Zona traseului meu**: buffer de N km (implicit 5) în jurul unui GPX din bibliotecă sau al unei rute
   planificate. Rezolvă cazul real („plec pe traseul X, vreau să-l am offline") fără să descarci un județ.

### 6.2 Ce se descarcă (un singur artefact per regiune)

```
regiune.pmtiles        bază vectorială + straturile noastre (trasee, POI, piste)
regiune.terrain.pmtiles raster de teren (umbrire + bandă de pantă)   [opțional în v1]
manifest.json          id, nume, bbox, versiune, dată, dimensiuni, sursă
```

**Un fișier = o descărcare = o ștergere = o versiune.** Asta e tot trucul care face offline-ul
întreținibil; 5000 de tiles într-un IndexedDB nu se pot nici număra, nici șterge, nici actualiza corect.

### 6.3 Unde se ține

| Platformă | Stocare | Servire către MapLibre |
| --- | --- | --- |
| Web (PWA) | OPFS sau Cache Storage | protocol `pmtiles://` în worker + Cache API |
| Android (Capacitor) | filesystem + stocare externă | **server HTTP local** care știe `Range` (de verificat) |
| iOS (Capacitor) | filesystem | idem; **service worker nu e o opțiune** pe `capacitor://` |

Punctul 3 e **riscul principal al offline-ului** și de aceea e poarta F0: PMTiles are nevoie de
`Range` requests, iar WebView-ul nu le poate face pe un `file://`. Variantele de testat în F0:
server local în plugin Capacitor, sau rezolvarea `FileSource` a `pmtiles` peste un `File` deschis prin
File System Access / Capacitor Filesystem. **Dacă F0 nu trece, offline-ul se amână** — nu se livrează
o promisiune pe jumătate.

### 6.4 Rutare offline

Nu promitem rutare offline în v1. Calea realistă, dacă o vrem:

- **A\* peste graful de trasee marcate** din regiunea descărcată (noduri/muchii extrase la build, câteva
  mii per masiv). Dă exact ce cere produsul: „rută pe trasee marcate, între cabane", fără motor extern,
  fără Docker pe telefon. Cost: un modul pur, testabil — și e o funcție **mai bună** pentru hiking decât
  rutarea rutieră actuală.
- Alternativa BRouter-în-app e mai puternică și mai scumpă (JVM pe dispozitiv).

### 6.5 Ciclul de viață și gardurile

- Descărcare cu progres real, reluabilă, anulabilă; dimensiune **măsurată și afișată înainte** de start.
- Listă „Regiuni descărcate" cu: dimensiune ocupată, data descărcării, versiunea datelor, buton
  Actualizează / Șterge, plus totalul ocupat vs. spațiul disponibil.
- Avertisment înainte de a depăși un prag al dispozitivului.
- **Atribuire obligatorie** vizibilă („© OpenStreetMap, ODbL") inclusiv offline — nu doar în popup.
- Data are **versiune**; la update de date, regiunile vechi se marchează „se poate actualiza", nu se
  șterg singure.
- Fără descărcare automată în fundal fără acțiune explicită a utilizatorului.

### 6.6 Dimensiuni — **măsurate** (2026-09-23)

Estimarea din prima versiune („zeci de MB per masiv") a fost **pesimistă**. Cifre reale, obținute cu
`protomaps/go-pmtiles` prin Docker, pe build-ul public Protomaps (date OSM 2026-09-23):

| Regiune | maxzoom | Tile-uri | Mărime |
| --- | --- | --- | --- |
| Făgăraș (24.20,45.30 → 25.00,45.75) | 14 | 1 549 | **8,7 MB** |
| Făgăraș | 15 | 5 892 | **13,2 MB** |
| Retezat | 14 | 916 | **4,8 MB** |
| România întreagă | 14 | 174 520 | **613,8 MB** |

Extracția unui masiv durează **12 secunde** (arhiva se citește pe intervale, nu se descarcă întreagă).
La asta se adaugă stratul **nostru** (trasee marcate, POI, dificultate), care nu vine din Protomaps:
pe Făgăraș, răspunsul Overpass brut are 4,1 MB JSON, dar după conversie în tile-uri vectoriale se
așteaptă sub 1 MB. DEM-ul (Copernicus GLO-30) e ~41 MB **per tile de 1°**, descărcat o dată pe server,
nu pe telefon.

**Concluzia care contează pentru decizie:** un masiv complet offline intră în **~15 MB**, nu în zeci.
Mărimea nu mai e un argument nici pentru a amâna, nici pentru a tăia din straturi. Detaliile, comenzile
și ce a rămas de măsurat: [F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md) §2.

---

## 7. Marcaje montane: cabane, refugii, zone de risc

### 7.1 Ce marcăm

| Categorie | Sursă OSM (etichete) | Culoare/prioritate |
| --- | --- | --- |
| Cabană | `tourism=alpine_hut`, `tourism=chalet` | prioritate 1 |
| Refugiu | `tourism=wilderness_hut`, `amenity=shelter` | prioritate 1 |
| Post Salvamont / salvare montană | `emergency=mountain_rescue` (+ `office=*`) | prioritate 1 |
| Apă potabilă / izvor | `natural=spring` + `drinking_water=yes` | prioritate 2 |
| Indicator de traseu | `information=guidepost` | prioritate 2 |
| Belvedere / punct de interes | `tourism=viewpoint`, `historic=wayside_cross` | prioritate 3 |
| Pârtie / traseu de schi | `piste:type=downhill\|nordic`, `piste:difficulty` | strat de iarnă |
| Dificultate traseu | `sac_scale` pe way/relație | **afișată pe traseu**, nu doar în popup |
| Zonă periculoasă / avertisment | **catalog propriu, cu proveniență** (§7.3) | **prioritate 1** — la fel de important ca o cabană |

Fiecare POI e **filtrabil ca orice atribut** — proiectul are deja tiparul în catalogul de echipament
(`GearController`, `docs/STUDY-GEAR.md`), iar panoul de filtre se generează din dicționar. Nu inventăm
un mecanism nou.

### 7.2 Proveniență, refolosind tiparul existent

Proiectul are deja, pentru echipament, pattern-ul „fiecare valoare cu **sursa** și **data citirii**".
Exact așa trebuie tratate și POI-urile montane, pentru că datele OSM pe cabane sînt **neuniforme**:

- `source` (osm / salvamont / contribuție utilizator), `sourceRef` (id OSM), `readAt`, `verifiedAt`,
  `verifiedBy`;
- un POI neverificat se afișează distinct (contur punctat) — la munte, „cabană deschisă" greșită
  înseamnă o noapte afară;
- contradicțiile se marchează, nu se rezolvă în tăcere.

### 7.3 Zone de risc / periculoase — cum sînt marcate la noi

Ai confirmat că nu e vorba de o prognoză (avalanșă, vreme), ci de **zonele „tricky" ale munților
noștri, așa cum sînt ele semnalizate**: porțiuni expuse, dificile, periculoase. Asta schimbă stratul
dintr-o „prognoză" într-un **inventar de semnalistică**, mult mai fezabil și mult mai onest.

#### 7.3.1 Ce am aflat despre marcarea la noi (cercetare, nu presupuneri)

- **Semnele de marcaj** folosite pe traseele turistice montane din România sînt un set fix — bandă
  (roșie / albastră / galbenă), cruce, triunghi, punct — aplicate pe copaci, stînci, iar în golurile
  alpine pe stîlpi. Sursă: [ghidul de marcaje al CJ Sibiu](https://www.cjsibiu.ro/wp-content/uploads/2021/07/Ghid-marcaje-anii-drumetiei-30072021.pdf).
  **Acesta e exact setul pe care aplicația îl citește deja** din `osmc:symbol` (`MapExplorerView.vue:610-628`
  și legenda din `:560-567`). Partea de marcare a traseelor e deci deja corectă — nu trebuie inventată.
- **Dificultatea și pericolele nu sînt un strat de poligoane.** Ele trăiesc în **fișele de traseu**
  emise de serviciile Salvamont județene (durată, diferență de nivel, dificultate, puncte de reper),
  publicate ca PDF-uri per masiv — de exemplu
  [Retezat](http://salvamonthd.ro/uploads/traseeRetezat/TraseeRetezat-11.pdf) și
  [Bihor](http://salvamontbihor.ro/download/trasee/Masiv%20Bihor%20-%20jud.%20Bihor/Zona%20Cristior%20-%20Baita/Tr.%20%20Poiana%20-%20La%20Rascruce%20-%20TA.pdf).
- Există și distincția **trasee omologate / neomologate / omologate ce urmează a fi închise** — utilă
  ca atribut: un traseu neomologat nu are cine să-l întrețină.
- **Nu am putut deschide documentele** în acest mediu (`web_fetch` e indisponibil aici; am doar titluri
  și fragmente din rezultatele căutării). Deci **structura exactă a fișei rămîne de citit** înainte de a
  proiecta importul — nu am inventat cîmpuri.
- **Nu am găsit** un set de date național deschis cu „zone de risc" poligonale. Concluzia de lucru:
  stratul **se construiește**, nu se descarcă.

#### 7.3.2 Ce putem lua din OSM (fără muncă de teren)

| Ce | Etichetă | Ce spune |
| --- | --- | --- |
| Dificultate tehnică | `sac_scale` (`hiking` → `demanding_alpine_hiking`) | unde traseul cere mîini, expunere, echipament |
| Vizibilitate pe teren | `trail_visibility` | unde se pierde poteca |
| Ferrata | `via_ferrata_scale` | trasee cu cabluri |
| MTB tehnic | `mtb:scale` | deja filtrat azi (`MapExplorerView.vue:234`) |
| Semnalistică de reper | `information=guidepost` | unde sînt panouri și indicatoare |

Acoperirea reală în România **se măsoară** (§7.3.7). Dacă e subțire, stratul de dificultate se
completează din catalogul propriu, nu se preface că există.

#### 7.3.3 Ce construim: catalog de zone periculoase, cu proveniență

Același mecanism ca la POI-uri (§7.2): un avertisment e tot un punct (sau un segment) pe hartă, doar cu
altă categorie.

| Categorie (propunere de start, de confirmat cu tine) | Exemplu |
| --- | --- |
| Porțiune expusă | brînă, muchie, cădere pe versant |
| Echipament fix | cablu, lanț, scară, horn |
| Cățărare / mîini | potecă ce cere utilizarea mîinilor |
| Vale de avalanșă (iarna) | jgheab, văiugă, versant deschis |
| Stîncărie / surpare | grohotiș instabil, surpări |
| Trecere de apă | vad, pîrîu umflat la ploaie |
| Faună | zonă frecventată de urs |
| Fără semnal | zonă fără acoperire GSM |
| Traseu închis / neomologat | omologare retrasă |

Fiecare intrare: **cine a spus** (fișă Salvamont / OSM / contribuție), **cînd s-a citit**, **cînd a fost
verificată de un om**, și pe ce **segment de traseu** e (nu un punct vag în pădure). Un avertisment
neverificat se vede distinct.

#### 7.3.4 Bandă de pantă din DEM — suport vizual, nu verdict

Din DEM se poate colora panta **30°–45°** (banda clasică de declanșare) și expunerea. E util ca
**fundal** care explică de ce un loc e periculos, dar:

- se etichetează **„teren cu potențial de avalanșă"**, calculat, nu observat;
- **nu** se combină cu catalogul de mai sus într-un scor unic — un scor agregat ar arăta ca o evaluare
  de siguranță pe care nu o putem susține;
- se afișează doar iarna sau la cerere, nu implicit.

#### 7.3.5 Semnale de avertizare — cum arată în aplicație

- Pe hartă: pictogramă distinctă, **nu** roșu/verde tăios — un triunghi de avertizare cu categorie.
- Pe traseu: segmentul respectiv se evidențiază la zoom mare, cu dificultatea (`sac_scale`) și
  avertismentele lui.
- În planificare: dacă ruta trece printr-o zonă semnalizată, **spune-o înainte** de plecare, în sumarul
  traseului („3 porțiuni expuse, una cu cablu"), nu doar ca punct pe hartă.
- Text fix, scurt, la fiecare afișare: informația e orientativă, nu înlocuiește semnalizarea de pe teren
  și echipamentul.

#### 7.3.6 Ce am vrut să spun cu „sursă de risc avalanșă" (și de ce rămîne neintegrată)

Mă refeream la **buletinul nivologic**: o evaluare zilnică a riscului de avalanșă pe grade (1–5), pe
masiv, emisă de structuri de profil. E o informație **dinamică**, valabilă o zi, nu un strat de hartă.
Nu am o sursă pe care să o pot garanta ca stabilă, completă și licențiabilă, iar tu ai confirmat că nu
ai una — deci **nu se integrează**. Ce rămîne în v1: catalogul de zone semnalizate (§7.3.3) plus banda
de pantă calculată (§7.3.4), ambele cu data la vedere. Dacă apare o sursă oficială serioasă, se adaugă
atunci, ca strat separat, cu data citirii afișată.

#### 7.3.7 Ce rămîne de măsurat

**Măsurat (2026-09-23, Overpass):**

| Interogare | Rezultat |
| --- | --- |
| `tourism=alpine_hut`, toată România | **219** obiecte |
| Făgăraș (45.30,24.20 → 45.75,25.00), setul complet de mai jos | 4 161 KB JSON, **177,7 s**, un `HTTP 504` pe mirror-ul principal |

Pe Făgăraș, interogarea combinată (trasee marcate + poteci cu `sac_scale` + MTB + cabane + refugii +
Salvamont) a întors: **112** obiecte cu `osmc:symbol`, **41** cabane, **17** refugii, **2** posturi
Salvamont, **205** way-uri cu `sac_scale`, **12** cu `mtb:scale`. Adică **datele există** — stratul de
dificultate și cel de POI nu pornesc de la zero. Ce nu s-a măsurat se scrie „nemăsurat", nu estimat.

> **Capcană de numărare, de reținut la F2:** `amenity=shelter` **nu** înseamnă „refugiu montan" —
> majoritatea sînt adăposturi de transport public. Pentru refugii trebuie filtrat pe `shelter_type`
> (`basic_hut`, `lean_to`, `wilderness_hut`), altfel numărătoarea umflă stratul cu mii de stații de autobuz.

Rămîne de măsurat:

1. ~~Cît `sac_scale` există pe Făgăraș~~ — **măsurat: 205 way-uri.** Rămîne pentru celelalte masive
   (Retezat, Bucegi, Piatra Craiului) și pentru `trail_visibility` / `via_ferrata_scale`.
2. ~~Cîte refugii reale ies după filtrarea pe `shelter_type`~~ — **măsurat pe Făgăraș: 17** (plus 41 de
   cabane și 2 posturi Salvamont). Rămîne pe celelalte masive.
3. ~~Cîte relații de traseu marcate există~~ — **măsurat pe Făgăraș: 112 obiecte cu `osmc:symbol`,
   din 104 relații**. Dimensionează importul în PostGIS; de repetat pe țară la F2.
4. Structura fișei de traseu Salvamont (după citirea cîtorva fișe reale) → cîmpurile catalogului.
5. Cîte zone semnalizate se pot strînge realist pentru 3–4 masive pilot, ca să se vadă dacă merită
   efortul de conținut — pentru că **aici costul e conținutul, nu codul**.

**Regula de produs, nenegociabilă:** stratul de risc e informativ, cu sursa și data la vedere, niciodată
un verdict. Nu vindem siguranță — vindem informație.

### 7.4 Legătura cu restul aplicației

Un POI nu e doar un punct pe hartă: **cabană ca punct de trecere în planificator** („rută cu popas la
X"), refugiu ca punct de salvare în execuție, pârtie ca referință pentru planurile de iarnă. Datele
există o dată, în harta nouă, și se citesc de unde e nevoie.

---

## 8. Navigare turn-by-turn — studiu de fezabilitate

**Cererea ta:** deocamdată **fără navigare**, dar să studiez dacă e fezabilă.

**Concluzia pe scurt:** fezabil, dar în **două trepte cu prețuri foarte diferite**, și merită să nu le
amestecăm.

- **Treapta 1 — „urmărire pe traseu"** (unde sînt, cît mai am, am ieșit de pe traseu, voce la praguri):
  **ieftină**, se sprijină aproape integral pe ce există deja în cod, **fără backend nou**. Se poate
  livra odată cu harta nouă (F3).
- **Treapta 2 — turn-by-turn adevărat** (manevre, rerutare, voce contextuală): cere un **motor de
  navigare**. Se poate lua gata făcut (open source, se leagă exact de Valhalla pe care oricum vrem să-l
  găzduim) sau scrie de la zero. **Nu are rost înainte de F2/F3.**

Recomandarea mea: **treapta 1 în v1**, treapta 2 studiată și decisă după ce rutarea și harta există.

### 8.1 Ce există deja (verificat în cod, nu presupus)

| Ce | Unde | Ce ne dă pentru navigare |
| --- | --- | --- |
| Urmărire GPS cu filtru de fixuri, distanță cumulată și stare | `services/geo/GpsTracker.ts` (+ `GpsTracker.spec.ts`) | exact stratul de date de care are nevoie orice navigare |
| Cadență și precizie: 1 Hz, `enableHighAccuracy`, ambele platforme | `services/geo/locationTransport.ts:25-33` | suficient pentru hiking |
| Android: foreground service propriu, `foregroundServiceType="location"`, **fără** `ACCESS_BACKGROUND_LOCATION` | `services/geo/backgroundTracking.ts:1-13`, `android/app/src/main/AndroidManifest.xml:103-111,130-135` | GPS-ul trăiește cu ecranul stins — condiția de bază |
| Ecran ținut aprins, notificări locale | `composables/useScreenWakeLock.ts`, `services/notifications.ts` | alertă de abatere / km rămași |
| Poziția pe traseu, interpolată (căutare binară) | `services/groups/groupLobby.ts:443-471` (`pointAtDistance`), testată | „unde sînt pe traseu" există deja |
| Hartă care urmărește poziția curentă | `components/MapTrack.vue:134-141` | urmărirea vizuală e deja făcută, în mic |
| Ceasul Garmin trimite deja poziție și distanță | `garmin/TtrLive/source/TtrTelemetry.mc:27-60` | a doua suprafață de afișare, fără protocol nou |

**Concluzia din tabel:** jumătatea grea a navigării — poziția, filtrul, traseul, progresul, fundalul pe
Android — **există și e testată**. Ce lipsește e prezentarea și logica de abatere.

### 8.2 Ce lipsește (și ce e onest să spunem)

1. **iOS nu există ca platformă.** `frontend/ios` nu e pe disc și **nu e în git** (0 fișiere urmărite),
   deși `frontend/package.json` are `@capacitor/ios`. Deci orice afirmație „merge pe iOS" e pe hîrtie
   pînă se adaugă platforma (Mac + Xcode + `npx cap add ios`). Pentru navigare asta cîntărește dublu:
   iOS are nevoie de `UIBackgroundModes: location` și **nu are service worker**.
2. **Fără voce.** `speechSynthesis` nu apare nicăieri în cod. Se poate adăuga prin Web Speech (merge în
   WebView-ul Android) sau printr-un plugin Capacitor dedicat.
3. **Fără „off route".** Nu există niciun calcul de distanță laterală față de traseu — `routeProgress`
   și `pointAtDistance` merg pe **distanță parcursă**, nu pe abatere.
4. **Fără manevre.** Un GPX nu conține instrucțiuni; „virează la dreapta în 200 m" fie se calculează din
   geometrie (unghiuri), fie vine de la un motor de rutare care întoarce instrucțiuni.
5. **Fără orientare.** Nu există calcul de bearing și nicio hartă orientată după direcția de mers.
6. **Consumul.** 1 Hz + ecran aprins + hartă = baterie. O navigare de 8 ore cere obligatoriu un mod
   „ecran stins, doar voce și alarme" — altfel funcția nu se folosește pe o tură reală.

### 8.3 Variante, cu preț și verdict

| Variantă | Ce dă | Cost | Verdict |
| --- | --- | --- | --- |
| **A. Urmărire pe traseu, scrisă de noi** | unde sînt, km rămași, D+ rămas, „ai ieșit de pe traseu cu X m", alertă vocală la praguri, urmărire pe hartă | **mic** — module pure peste ce există (§8.1); zero backend nou | **recomandat pentru v1** |
| **B. [Ferrostar](https://stadiamaps.github.io/ferrostar/web-getting-started.html)** (open source, Stadia Maps) peste Valhalla | turn-by-turn adevărat: manevre, relevelare, off-route, voce; are **adaptor de rutare Valhalla** și suport web/WASM peste core-ul Rust | mediu–mare de integrare, dar **nu scriem noi motorul de navigare** | **candidatul serios** pentru treapta 2, după F2 |
| **C. [MapLibre Navigation](https://klibs.io/project/maplibre/maplibre-navigation-android)** (KMP: Android/iOS/JVM/Wasm/JS) | aceeași clasă de funcții, cu hartă MapLibre integrată | mediu–mare | plan B; se potrivește mai bine unui proiect Kotlin Multiplatform decît nouă |
| **D. Motor propriu complet** (manevre, rerutare, voce contextuală) | control total | **mare** și greu de întreținut | **nu** — nu scriem un motor de navigare |

### 8.4 De ce „off route" e jumătatea cu adevărat valoroasă

Pe munte, întrebarea reală nu e „care e următoarea manevră", ci **„mai sînt pe traseu?"**. Abaterea se
calculează ieftin: distanța minimă de la poziția curentă la polilinia traseului (proiecție pe segmente),
cu un prag de alarmă și **histerezis** (nu alarma la 30 m, nu re-alarma pînă nu revii sub prag).

Două avertismente de onestitate, care trebuie tratate ca cerințe, nu ca note de subsol:

- **Sub coronament, GPS-ul derapează** — 20–50 m de eroare sînt normale în pădure și pe văi. Fără prag
  adaptat la precizia raportată (`accuracyM` există deja în fix, `locationTransport.ts:56-59`) și fără o
  fereastră de confirmare, funcția va urla „ai ieșit de pe traseu" exact acolo unde traseul e cel mai
  puțin vizibil. Un avertisment care se înșală des e mai rău decît absent.
- **Nu înlocuiește orientarea.** Textul din ecran trebuie să spună că e o indicație, nu o garanție.

### 8.5 Poarta de decizie (dacă mergem spre treapta 2)

Trei măsurători, pe 3 trasee reale (unul de creastă, unul împădurit, unul cu potecă ștearsă):

1. **Cît de des se înșală „off route"** cu prag + histerezis, pe traseul împădurit.
2. **Consumul de baterie** pe o tură de 3 ore cu ecran stins și voce pornită.
3. **Cît de bună e instrucțiunea** produsă (Ferrostar + Valhalla) pe potecă nemarcată, față de „urmărește
   linia" din varianta A.

Dacă (1) sau (2) ies prost, rămînem la A și nu promitem nimic mai mult.

### 8.6 Ce spunem explicit în UI

„Urmărești traseul" — nu „navigație". Termenul „navigație" promite manevre și rerutare, iar dacă le
promitem fără să le livrăm, prima tură în care omul se rătăcește transformă funcția în problemă de
siguranță.

---

## 9. Faze

### F0 — poartă de decizie · **parțial măsurat (2026-09-23)**

Nu se scrie cod de produs. Se răspunde la trei întrebări, cu cifre:

1. **Tile-uri offline pe dispozitiv:** PMTiles citit din `Range` pe Android **și** iOS, în WebView
   Capacitor. Livrabil: un ecran izolat care afișează o regiune descărcată cu avionul pornit, plus
   cifra de dimensiune.
2. **Rutare:** Valhalla self-hosted vs. A\* local, pe 3 trasee reale din Făgăraș/Retezat (unul marcat,
   unul MTB, unul de creastă). Livrabil: cele două rute una lângă alta + timp de răspuns + unde greșesc.
3. **DEM:** Copernicus GLO-30 pentru un masiv — cât ocupă, cât durează, cât de bună e banda 30–45°.

**Dacă 1 nu trece, offline-ul e amânat** (nu livrăm pe jumătate). Dacă 2 nu convinge, rămâne online.

**Ce s-a măsurat deja** (fără telefon, fără VPS — fișa completă: [F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md)):

- **Mărimea nu mai e un risc:** un masiv offline = **8,7 MB** (zoom 14) / **13,2 MB** (zoom 15);
  România întreagă = 613,8 MB. Vezi §6.6.
- **Overpass e inutilizabil în calea critică:** 177,7 secunde și un `HTTP 504` pentru **un singur
  masiv** (§3.2.6). F2 devine obligatoriu, nu o îmbunătățire.
- **Datele montane există pe Făgăraș:** 205 way-uri cu `sac_scale`, 41 de cabane, 17 refugii,
  112 obiecte cu `osmc:symbol` (§7.3.7).
- **Poarta reală rămîne neatinsă:** citirea arhivei **pe dispozitiv** (§3 din fișă). Măsurătorile de
  mai sus sînt pe desktop, prin Docker, și nu dovedesc nimic despre WebView.

### F1 — „oprește minciuna" · **livrat (2026-09-23)**

Independent de F0, s-a făcut imediat. Ce s-a schimbat, cu dovada în cod:

| Ce era | Ce e acum | Unde |
| --- | --- | --- |
| Apel mort către `/api/elevation`, cu D+/D− afișat `0 m` dintr-un `catch` gol | Apelul a dispărut; D+/D− **nu se mai afișează deloc**, ci o linie care spune de ce (F2 aduce sursa) | `MapExplorerView.vue:119`, `trailStats.ts` |
| Markere `draggable: true` cu handler gol (`TODO`) | Tragerea reconstruiește segmentele, pe `dragend` (nu pe `drag`), cu bilet de ordine care aruncă răspunsurile întârziate | `MapExplorerView.vue:873-875, 886` |
| „Anulează ultimul" lăsa D+/D− vechi | Anulează și cererile în zbor, apoi recalculează din segmentele rămase | `MapExplorerView.vue:918` |
| Traseul planificat nu se putea salva nicăieri | Buton de salvare (ajunge în „Rutele mele", prin `addRouteObject`) + **export GPX**; cîmpul are nume accesibil | `MapExplorerView.vue:129-148, 958-967`, `stores/route.ts:81`, `services/gpx/GpxWriter.ts` |
| Hint „Zoom ≥ 11" vs. cod `MIN_ZOOM = 13` | Hint-ul spune 13. **Nu** am coborât pragul la 11: la 13 randarea e deja prin mii de obiecte Leaflet (§3.2.2), iar la 11 ar fi de ~16 ori mai multă zonă — coborârea aparține lui F3, când straturile devin vectoriale | `locales/{ro,en,fr}.ts` (`zoomHint`), `MapExplorerView.vue:372` |
| Etichete de tile-uri scrise în cod | Trecute în cataloage (`map.layers.*`), deci traduse în toate cele trei limbi | `MapExplorerView.vue:236`, `locales/*` |
| `addRoute` cu eșec înghițit de un `catch` gol | Întoarce `true`/`false`, iar planificatorul spune „salvat local" când serverul nu răspunde | `stores/route.ts:50-82` |

**Cod nou, cu teste:** `utils/trailStats.ts` (distanța segmentelor, îmbinarea lor, construirea
traseului — testabil fără hartă) și `services/gpx/GpxWriter.ts` (scriere + descărcare GPX, verificată
prin tur complet: serializează → parsează → aceleași puncte). 21 de teste noi.

**Gardurile de design au prins trei lucruri, reparate:** chenar fără rază pe cîmpul de nume
(`panelStyle`), cîmp fără nume accesibil (`accessibleNames`) și textul „GPX" scris direct în template
(`hardcodedText`) — acum butonul are etichetă tradusă, iar cîmpul are `aria-label`.

**Neschimbat deliberat, cu motiv:** serverul de rutare e tot cel public OSRM cu profil `foot`
(§3.1.2) — se înlocuiește la F0/F2, nu se patchuiește acum; un traseu planificat salvat are
**profil plat** (altitudinea e 0 asumată), iar ecranul o spune explicit.

**Verificat:** `vue-tsc --build` 0 erori · `oxlint` + `eslint` 0 erori · suita de frontend completă.


### F2 — backend de date montane · **prima felie livrată (2026-09-23)**

**Livrat:** lanțul complet **OSM → baza noastră → API → hartă**, pentru puncte montane.

| Ce | Unde |
| --- | --- |
| Entitate cu proveniență (`Source`, `SourceRef`, `ReadAt`, `VerifiedAt/By`, `Notes`, atribute în listă albă) | `TTR.Domain/Entities/MountainPoi.cs`, `TTR.Domain/Enums/MountainPoiCategory.cs` |
| Clasificare pură, testabilă fără rețea | `TTR.Application/Services/OsmMountainPoiMapper.cs` |
| Import din OSM, cu failover pe mirror-uri | `TTR.Infrastructure/Services/OverpassMountainPoiImporter.cs` |
| Upsert idempotent, care **nu șterge verificarea unui om** | `Repositories.cs` (`MountainPoiRepository`) |
| `GET /api/mountain-pois?bbox=&categories=&limit=` + `POST /api/mountain-pois/import` (admin) | `MountainPoisController.cs` |
| Comandă de ops pentru primul import (cînd nu e nimeni logat) | `--import-mountain-pois <lat_s,lon_v,lat_n,lon_e>` |
| Strat pe hartă, cu filtre pe categorii și popup cu proveniență | `MapExplorerView.vue`, `services/api/mountainPoisApi.ts` |
| Migrația `AddMountainPois` | `20260923212426_AddMountainPois.cs` |

**Verificat pe date reale, nu doar în teste** (Bucegi, 45.32,25.35 → 45.48,25.60): **132 de puncte**
importate în 17,8 s, apoi citite prin API cu aceeași cifră. Distribuție: 45 de indicatoare, 41 de
belvedere, 28 de cabane, 10 posturi Salvamont, 6 izvoare, 2 refugii. Filtrul pe categorii a întors
exact 38 (28 + 10). Idempotență confirmată la a doua rulare: **128 actualizate, 0 duplicate**.

**Trei lucruri pe care le-a prins verificarea pe date reale** (toate reparate):

1. **Overpass cere `User-Agent`** — fără el răspunde `406 Not Acceptable`. `HttpClient` nu trimite
   niciunul implicit, deci importul ar fi picat în producție la fel.
2. **Mai bine de o treime din cabane sînt desenate ca suprafață** (11 din 29 în Bucegi). Fără
   `out center` în interogare, exact acelea ar fi fost sărite în tăcere.
3. **`wilderness_hut` nu e o cabană.** `node/430758331` se numește „Refugiul Coștila" și e tag-uit
   `wilderness_hut`: pus la cabane, harta ar fi mințit exact acolo unde contează. Clasificarea a fost
   corectată, iar testul citează cazul real.

**`/api/elevation` — livrat (2026-09-23).** Sursa e **Copernicus DEM GLO-30**, găzduit public de AWS
Open Data (fără cont, fără cheie, ~41 MB per tile de 1°), citit prin **cereri parțiale `Range`**: nu se
descarcă niciodată fișiere întregi ca să afli o altitudine, ci capul fișierului și tile-ul de 1024×1024
care conține punctul.

| Ce | Unde |
| --- | --- |
| Cititor GeoTIFF minim (header, DEFLATE, predictor, proiecție) | `TTR.Application/Services/GeoTiffDem.cs` |
| Validarea cererii (max 100 de puncte, coordonate, „0 nu e necunoscut") | `TTR.Application/Services/ElevationPolicy.cs` |
| Furnizorul DEM, cu cache pe tile-uri decodate | `TTR.Infrastructure/Services/CopernicusElevationProvider.cs` |
| `GET /api/elevation?locations=lat,lon\|lat,lon` (plafonat la 120/oră) | `ElevationController.cs` |
| D+/D− real în planificator, cu atribuirea Copernicus pe hartă | `MapExplorerView.vue`, `elevationApi.ts` |

**Partea grea a fost predictorul, nu rețeaua.** Fișierele au `Predictor = 3`, adică predictor pentru
virgulă mobilă: octeții decomprimați **nu** sînt flotanții, ci (a) o sumă cumulativă pe octeți, pe
fiecare rînd, apoi (b) patru „plane" de octeți per rînd, cu octetul cel mai semnificativ primul.
Prima citire a dat `-0.0 m` la Omu și `4.3e15` la Babele, adică exact semnătura unei scheme greșite.

**De ce nu GDAL:** rezolvă tot, dar vine cu ~200 MB de binare native, iar aplicația rulează pe un VPS
de ~5 €. Cititorul nostru acoperă **doar** forma pe care o folosim (float32, tile-uri, DEFLATE,
predictor 3) și **refuză explicit** orice altceva — un DEM cu int16 sau fără predictor se raportează,
nu se citește pe încredere.

**Verificat pe teren real** (nu pe fixture-uri), prin API-ul pornit local:

| Punct | DEM | Referință |
| --- | --- | --- |
| **Vîrful Omu** | **2506 m** | 2505 m (OSM) — **+1 m** |
| Cabana Omu (în poală) | 2447 m | sub vîrf, plauzibil |
| Lacul Bâlea | 2075 m | 2034 m |
| București | 70 m | ~70–90 m |
| Ocean (0,0) | „indisponibil" | nu există tile → `null`, nu zero |

Timpul: **1,9 s** pentru 7 puncte la rece (două tile-uri de la AWS), **0,05 s** la a doua cerere —
cache-ul pe tile-uri, nu pe puncte, e de 38×. Dacă DEM-ul e indisponibil, ecranul spune „altitudinea nu
e disponibilă acum"; nu mai există drumul care afișa `0 m` dintr-un `catch` gol (§3.1.1).

**Rămîne din F2:** tile-urile vectoriale proprii (Geofabrik → PostGIS).
Punctele montane nu mai depind de Overpass la citire — Overpass a rămas doar în import, adică exact
„în afara căii critice" cum cerea §3.2.6.

### F3 — harta nouă (`/map` pe MapLibre) · **prima felie livrată (2026-09-23)**

**Livrat:** `/map` rulează pe **MapLibre GL cu tile-uri vectoriale**, fără cheie de API.

| Ce | Unde |
| --- | --- |
| 4 stiluri de bază vectoriale (Liberty, Bright, Positron, Dark) | `services/map/basemap.ts` |
| Traseele OSM → **un singur strat** stilizat, nu mii de obiecte | `services/map/osmTrails.ts`, stratul `ttr-trails` |
| Punctele montane ca strat de cercuri, cu contur plin la cele verificate | `services/map/poiLayer.ts` |
| Traseele mele + traseul planificat ca straturi GeoJSON | `services/map/routeLayers.ts` |
| Planificatorul, portat pe MapLibre (drag, undo, salvare, export GPX) | `MapExplorerView.vue` |
| Fallback vizibil cînd WebGL lipsește | `map.webglUnavailable` |

**Măsurat la build** (nu estimat — cifra din §5.1 era 220–250 kB gzip, realitatea e mai mare):

| Ce | Mărime |
| --- | --- |
| Chunk-ul hărții (`MapExplorerView-*.js`, cu MapLibre în el) | **1,06 MB · 288,74 kB gzip** |
| CSS-ul hărții | 83 kB · 10,80 kB gzip |
| Bundle-ul principal (`index-*.js`) | **59 kB · 18,84 kB gzip** — neschimbat |

Chunk-ul e **lazy** și **exclus din precache-ul PWA** (`vite.config.ts`, `globIgnores`), verificat în
`dist/sw.js`: manifestul nu conține `MapExplorerView`, dar conține `index`. Adică cine nu deschide
harta nu plătește nimic pentru ea.

**Nou în cod, cu teste:** `osmTrails.ts` (interogarea Overpass, `osmc:symbol`, conversia în GeoJSON),
`poiLayer.ts`, `routeLayers.ts`, `basemap.ts` — 30 de teste, toate fără browser. Rîndul care contează
cel mai mult: **coordonatele se scriu [lon, lat]**, iar un test apără asta explicit, fiindcă inversarea
lor e cea mai frecventă greșeală la trecerea de la Leaflet și simptomul e o hartă „mutată în altă
țară", nu o eroare.

**Livrat în a doua felie (2026-09-23):**

- **Căutare** în punctele noastre — nu într-un geocoder extern, care ar însemna altă dependență, altă
  politică de utilizare și altă cache. `GET /api/mountain-pois/search?q=`, cu `ILIKE`, **escaping
  corect al metacaracterelor `LIKE`** și ordonare „numele scurte întîi". Verificat pe date reale:
  „omu" și „OMU" întorc Cabana Omu, „cabana" întoarce 5 rezultate cu Cabana Omu prima, iar **„%"
  întoarce 0** — dovada că `%` e tratat literal, nu ca „orice". Un text sub 2 caractere întoarce listă
  goală, nu eroare: clientul cere la fiecare tastă apăsată.
- **„Unde sînt"** — o poziție, nu o urmărire continuă (urmărirea live e pentru înregistrare, unde
  contează fiecare secundă; aici ar consuma baterie degeaba), cu mesaje distincte pentru refuz,
  indisponibilitate și dispozitiv fără geolocație.

**Livrat în a treia felie (2026-09-23):**

- **Profilul altimetric al traseului planificat**, în planificator: grafic SVG propriu (fără bibliotecă
  de diagrame — sînt două linii și un polígon, iar una ar cîntări cît toată harta), cu indicator la
  trecerea cu mouse-ul care arată distanța și altitudinea, plus **durata estimată** (model tip Naismith:
  viteză pe plat + oră pentru fiecare urcuș, rotunjită la 5 minute ca să nu pară exactă).
  Devine posibil abia acum, pentru că are nevoie de DEM-ul din F2.
- Altitudinile lipsă **se scot din serie**, nu se pun la zero: puse la zero, o citire lipsă ar apărea
  ca o prăpastie pînă la nivelul mării și înapoi. Cînd lipsesc, ecranul spune pentru cîte puncte știe
  altitudinea.

**Ce rămîne din F3:** căutarea de localități și străzi (cere un geocoder, adică altă sursă de date),
măsurarea distanțelor pe hartă, heatmap-ul personal ca strat, sincronizarea graficului cu harta
(click pe profil → marker pe traseu) și spargerea vederii pe componente (§5.4) — logica a ieșit deja în
`services/map/` și `utils/`, dar fișierul e încă unul singur.

> **Neverificat vizual.** Ecranul a fost rescris fără să pot deschide un browser: ce e dovedit sînt
> type-check-ul, cele 2606 teste, build-ul, și faptul că sursa de tile-uri și stilurile răspund
> (`HTTP 200`, schemă decodată dintr-un tile real — 9 straturi, inclusiv `mountain_peak` și `poi`).
> Că harta **arată** bine e de confirmat pe ecran.

> **Verificat vizual (2026-09-24).** Harta a fost deschisă într-un Chrome real și fotografiată:
> bara laterală 288×735, canvas MapLibre 992×735, harta vectorială a României desenată, cu cele 132 de
> puncte montane importate vizibile în Făgăraș. Verificarea e repetabilă: `npm run check:map`
> (`frontend/scripts/check-map.mjs`, cu `playwright-core` peste Chrome-ul instalat).
>
> **Două defecte reale, găsite doar așa** — jsdom nu are layout și nu are WebGL, deci suita trecea verde
> în timp ce ecranul era gol:
>
> 1. **Worker-ul MapLibre nu ajungea în build.** MapLibre nu-și importă worker-ul, ci îl caută la rulare
>    lîngă chunk (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`) — un URL pe care bundler-ul nu-l
>    vede. Rezultat: „Worker failed to load", hartă goală deși tile-urile se descărcau. Reparat printr-un
>    plugin Vite care emite worker-ul (și `maplibre-gl-shared.mjs`, de care atîrnă) la o cale stabilă, plus
>    `maplibregl.setWorkerUrl(...)`.
> 2. **Învelișul de `fetch` trimitea credențiale către terți.** `installAuthenticatedFetch()`
>    (`utils/apiBase.ts`) forța `credentials: "include"` pe **toate** cererile, iar sursa de tile-uri
>    răspunde cu `Access-Control-Allow-Origin: *` — combinație pe care browserul o respinge. Defectul era
>    latent: hărțile vechi (Leaflet) încărcau tile-urile prin `<img>`, care nu trece prin `fetch`.
> 3. **MapLibre nu-și dă seama singur că containerul s-a așezat** (lipsea workaround-ul de dimensiune pe
>    care harta veche îl avea). Fără `resize()`, canvas-ul rămîne 0×0 și nu se repară niciodată.

> **Neverificat pe dispozitiv.** Toate verificările de mai sus sînt pe desktop, în Chrome. Că merge pe
> telefon (WebView Android) și pe iOS rămîne de confirmat la F0/F4.

### F3c — motorul de rutare (Valhalla auto-găzduit) · **livrat (2026-09-24)**

Închide §3.1.2 și §3.1.3, adică exact partea pe care „nu se repară, se înlocuiește".

**Livrat:**

| Ce | Unde |
| --- | --- |
| Motorul, cu tile-urile construite la prima pornire | `docker/valhalla/{Dockerfile,build.sh}` |
| Serviciu în ambele stive, în profilul `routing` | `docker-compose.yml`, `docker-compose.prod.yml` |
| Rutare prin Valhalla, cu cache pe rută | `TTR.Infrastructure/Services/ValhallaRoutingProvider.cs` |
| Decodorul de geometrie (polyline6) | `TTR.Application/Services/Polyline6.cs` |
| Regulile cererii, verificate înainte de motor | `TTR.Application/Services/RoutePlanPolicy.cs` |
| Endpoint-ul `POST /api/routing/route` (503, nu linie dreaptă) | `TTR.Api/Controllers/RoutingController.cs` |
| Clientul, cu profil de mers și mesaj de eșec | `services/api/routingApi.ts`, `MapExplorerView.vue` |

**Ce s-a schimbat pentru utilizator:**

1. **Ruta urmează poteca.** Pe cele trei trasee de test, Valhalla a stat pe traseul marcat în două
   cazuri (100%), unde OSRM public dădea 0,1% și 0,2% — adică rute de 38–41 km ca să evite exact
   poteca cerută. Numerele complete: [F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md) §4.1.
2. **Se poate alege cu ce mergi:** pe jos, bicicletă, MTB. Backend-ul le traduce în costuri diferite
   (pietonal cu `use_trails`; bicicletă „hybrid" ținută departe de poteci tehnice; MTB „mountain" cu
   `mtb:scale`). Treapta de dificultate maximă e 6 (T6), deliberat: aplicația nu știe cît de
   experimentat e omul, iar a refuza o potecă pe care o vede pe hartă e mai rău decît a i-o arăta.
3. **O singură cerere pentru tot traseul**, nu una per segment: un traseu cu 5 puncte însemna 5 cereri
   către un serviciu public; acum e una, iar motorul vede tot drumul deodată.
4. **Eșecul se vede.** Cînd motorul nu răspunde, endpoint-ul întoarce **503** cu mesaj citibil, iar
   ecranul desenează linii drepte și scrie într-o bandă galbenă că rutarea nu e disponibilă. Înainte,
   eșecul și reușita arătau la fel (§3.1.3).

**Verificat, nu presupus** (2026-09-24, API local + motor în Docker, cont real, rute reale):

| Probă | Rezultat |
| --- | --- |
| Azuga → Cabana Diham, pe jos (traseu real 11,92 km) | **6,21 km**, 73 min, 143 ms, 1 etapă, 218 puncte |
| Creasta expusă Brîul lui Răducu (T5) | 5,18 km, 78 min, 14 ms |
| Traseu cu 3 puncte | 2 etape, 184 ms, **o singură cerere** |
| A doua cerere identică (cache) | 6 ms față de 10 ms |
| Un singur punct / puncte identice / latitudine 91 / profil `car` | **400**, cu mesaj în corp |
| Motor oprit | **503**: „Rutarea nu e disponibilă acum. Traseul poate fi trasat, dar fără urmărirea drumurilor." |

Plus 43 de teste noi pe backend (decodorul, regulile, contractul cu motorul, cache-ul) și 15 pe frontend
(clientul API și ecranul: că se cheamă backend-ul, nu OSRM, și că eșecul se **spune**). Suita completă:
**1437** pe backend, **2646** pe frontend, toate trec.

> **Defect găsit scriind testul.** `new ResizeObserver(...)` era apelat fără gardă: pe un WebView care nu
> are `ResizeObserver` (Chrome < 64, Safari < 13.1), aruncarea oprea **tot restul** pornirii hărții —
> straturi, click, încărcarea rutelor — iar eroarea era o promisiune respinsă, deci nici măcar nu se
> vedea în consolă. Reparat cu `typeof ResizeObserver !== "undefined"`.

**Ce rămîne din F3c:** pantele reale în calcul (Valhalla știe să folosească DEM, dar tile-urile de
altitudine nu sînt construite — `WARN Elevation storage directory does not exist` la build), alternative
de rută între aceleași puncte, reordonarea punctelor, și rutarea offline pe graful descărcat (§6.4).

### F4 — offline pe regiune · 5–10 zile (depinde de F0)

- Lista de masive/județe + „zona traseului meu" (buffer pe GPX).
- Descărcare cu progres, listă de regiuni, ștergere, dimensiuni, versiuni, reîmprospătare.
- Atribuire offline, garduri de spațiu, mesaje oneste când lipsește regiunea.
- Opțional, dacă F0 l-a validat: rutare offline pe graful de trasee.

### F3b — urmărire pe traseu (treapta 1 din §8) · 3–5 zile

- „Unde sînt pe traseu", km rămași, D+ rămas — din `pointAtDistance`, care există deja.
- **Alertă de abatere**: distanță laterală, prag + histerezis, adaptat la `accuracyM`.
- Voce la praguri (Web Speech / plugin Capacitor) și mod „ecran stins".
- Text în UI: „urmărești traseul", nu „navigație" (§8.6).

### F5 — zone periculoase, risc și iarnă · deschis

- **Catalogul de zone periculoase** (§7.3.3): entitate cu proveniență, import din fișele Salvamont,
  3–4 masive pilot. Costul e conținutul, nu codul.
- Bandă de pantă 30°–45° din DEM + umbrire de relief, etichetată „teren potențial" (§7.3.4).
- Strat de iarnă (pârtii, trasee de schi).
- Buletin nivologic: **nu** se integrează fără o sursă stabilă și licențiabilă (§7.3.6).

### F6 — turn-by-turn (treapta 2) · condiționat de poarta din §8.5

- Ferrostar + Valhalla (varianta B din §8.3), **doar dacă** măsurătorile trec.
- Nu se promite nimic înainte de poartă.

---

## 10. Ce NU facem (explicit)

- **Nu descărcăm tile-uri de la `tile.openstreetmap.org` / OpenTopoMap.** Politicile lor interzic
  volumul sistematic; offline-ul se construiește pe date pe care le putem servi noi.
- **Nu înlocuim Leaflet peste tot.** `MapTrack`, `SessionTrackMap` și heatmap-ul rămân pe Leaflet.
- **Nu promitem rutare offline în v1.** Se decide la F0, pe măsurători.
- **Nu promitem turn-by-turn.** Studiul e în §8: v1 livrează „urmărire pe traseu", iar treapta 2 se
  decide pe măsurători (§8.5).
- **Nu afișăm „risc de avalanșă" ca verdict.** Doar zone semnalizate, cu sursă și dată, plus teren
  potențial calculat — niciodată un scor unic (§7.3).
- **Nu trimitem datele de hartă la un procesator extern** — nimic din hărți nu trece prin AI.
- **Nu facem strat foto, trafic, 3D** (§9 din `STUDY-3D-ROUTE.md` rămâne valabil; 3D-ul e altă livrare).
- **Nu promitem „la fel ca Mapy"** — promitem trasee marcate + offline + POI montane, care e chiar
  diferența noastră față de o hartă generalistă.

---

## 11. Riscuri

| Risc | De ce e real | Atenuare |
| --- | --- | --- |
| **PMTiles offline pe iOS WebView** | fără service worker pe `capacitor://`, `Range` peste `file://`; și **iOS nu e încă platformă în repo** (§8.2) | F0 pe Android ca poartă; arhitectură care nu depinde de service worker; iOS se adaugă conștient, nu presupus |
| **Navigare care se înșală** | sub coronament GPS-ul derapează 20–50 m; o alarmă falsă de abatere e mai rea decît lipsa funcției | prag + histerezis pe `accuracyM`, măsurat la poarta din §8.5; text onest în UI |
| **Licențe și atribuire** | OSM ODbL, Copernicus cere atribuire, unele surse de risc au licență neclară | verificare înainte de import; atribuire vizibilă offline |
| **Volum de date și cost de server** | PostGIS + DEM + tile-uri vectoriale pe un VPS de ~5 € | extrase per țară, nu global; cache agresiv; măsurat în F0 |
| **Bundle / precache PWA** | `globPatterns` prinde tot `**/*.js` (`vite.config.ts:44`) | MapLibre în chunk lazy, exclus din precache, verificat în `dist/` |
| **„Harta minte"** | precedentul `/api/elevation` arată cât de ușor se afișează o valoare falsă | nicio cifră fără sursă; eșecul se vede în UI, nu în `catch` gol |
| **Siguranță montană** | un POI sau un risc greșit poate răni pe cineva | proveniență + verificare umană + disclaimer + dată |
| **Performanță** | mii de straturi azi (§3.2.2) | vectoriale = straturi, nu obiecte; simplificare pe zoom |
| **i18n** | ecranul are șiruri în cod (§3.2.7), iar `fr/es/it` sînt parțiale | catalogul ro/en din prima zi; test de paritate există |
| **Dependență de un singur motor de rutare** | Valhalla self-hosted = serviciu de întreținut | A* local ca plan B; fallback la ruta manuală (polilinie) |

---

## 12. Backlog (puncte concrete, de copiat în `docs/BACKLOG.md` când se decide)

1. **✅ F1 — oprește minciuna în planificator** (livrat 2026-09-23): `/api/elevation` scos, D+/D−
   ascuns, drag implementat, undo corect, salvare + export GPX, `MIN_ZOOM` aliniat cu hint-ul,
   etichete de tile-uri în cataloage. *Dovada: `MapExplorerView.vue:119,141-145,372,873-875,886,918,958-967`,
   `utils/trailStats.ts`, `services/gpx/GpxWriter.ts`, `stores/route.ts:50-82`.*
2. **F0 — spike offline PMTiles pe Android + iOS WebView**, cu poartă de decizie. Livrabil: cifre și
   dimensiuni, nu un ecran.
3. **F0 — spike rutare** (Valhalla vs. A* local) pe 3 trasee reale.
4. **F2 — POI montane cu proveniență** (cabane, refugii, Salvamont, apă, belvedere) + filtrare ca
   atribut, refolosind tiparul din catalogul de echipament.
5. **F2 — backend de tile-uri vectoriale proprii** (Geofabrik → PostGIS), ca Overpass să iasă din
   calea critică. Include corectarea README („cache tile pe backend" nu exista).
6. **F3 — `/map` pe MapLibre**, cu `MapExplorerView.vue` spart pe componente și planificatorul mutat în
   `useTrailPlanner.ts` (testabil fără hartă).
7. **F4 — regiuni offline**: listă de masive + „zona traseului meu", progres, dimensiuni, ștergere,
   versiuni, atribuire offline.
8. **F5 — bandă de pantă 30–45° din DEM** + umbrire de relief, etichetat „teren potențial".
9. **✅ Curățenie i18n** (livrat odată cu F1): cheile devenite moarte (`map.gain`, `map.loss`,
   `map.calculatingElevation`) au fost scoase din toate cele trei cataloage, iar etichetele de tile-uri
   au intrat în ele. **Corectură la o afirmație din prima versiune a acestui studiu:** `map.start`,
   `map.finish` și `map.noRouteSelected` **nu** erau chei moarte — se folosesc în `MapTrack.vue:27,33,49`
   și `GroupRouteMap.vue:26,30`. Nu se șterg.
10. **Teste**: primele teste care ating planificatorul au venit cu F1 (`utils/__tests__/trailStats.spec.ts`,
    `services/gpx/__tests__/GpxWriter.spec.ts`). Rămîne de făcut un test de componentă pentru
    `MapExplorerView` (§3 din `docs/audit-frontend.md` arată de ce ecranul e greu de montat în teste:
    Leaflet imperativ + `watch` profund).
11. **F5 — catalog de zone periculoase cu proveniență** (§7.3.3), pornind din fișele de traseu
    Salvamont, plus `sac_scale` / `trail_visibility` afișate pe traseu. Costul e conținutul, nu codul.
12. **F3b — urmărire pe traseu**: „unde sînt", km rămași, **alertă de abatere cu histerezis adaptat la
    `accuracyM`**, voce la praguri, mod „ecran stins". Zero backend nou.
13. **F6 — turn-by-turn (Ferrostar + Valhalla)**, doar după poarta din §8.5.
14. **iOS**: platforma nu există în repo (`frontend/ios` — 0 fișiere în git). Dacă offline-ul și
    urmărirea trebuie să ajungă pe iOS, adăugarea platformei e un pas în sine (Mac + Xcode).

---

## 13. Decizii

### 13.1 Rămase deschise

1. **Cine scrie conținutul catalogului de zone periculoase** (§7.3.3). Citirea fișelor Salvamont pentru
   3–4 masive pilot e muncă de om, nu de cod; fără ea stratul rămîne doar din OSM, adică subțire.
2. **iOS**: adăugăm platforma (Mac + Xcode) sau rămînem Android + web pentru offline și urmărire?
   Azi `frontend/ios` nu există și nu e în git.
3. **Ferrostar / turn-by-turn** (§8.3, varianta B): se decide **după** poarta din §8.5, nu acum.

### 13.2 Luate

Decise de tine (2026-09-23):

- **Zone de risc** = zonele periculoase semnalizate la noi (porțiuni expuse, dificile), **nu** o
  prognoză. §7.3 e rescris ca inventar de semnalistică, cu proveniență.
- **Navigare**: fără turn-by-turn în v1; studiul de fezabilitate e §8, iar v1 livrează „urmărire pe
  traseu".
- **Arhitectura**: tile-uri vectoriale servite de noi + DEM propriu (recomandarea din §5).
- **Rutare offline**: nu în v1; rămîne F4b, după ce descărcarea de regiuni funcționează (§6.4).
- **Avalanșă**: nicio sursă neclară nu se integrează (§7.3.6).

Decise prin studiu, supuse confirmării:

- Leaflet rămîne pentru hărțile mici; `/map` trece pe MapLibre + vectoriale.
- Offline-ul se construiește pe tile-uri vectoriale proprii, **nu** pe furnizorii publici de raster.
- Planificatorul se înlocuiește, nu se patchuiește; logica iese în `useTrailPlanner` și se testează.
- F0 cu poartă de decizie, înainte de orice promisiune de offline.
- Riscul se afișează ca informație cu sursă și dată, niciodată ca verdict.

---

## 14. Verificare (cum se știe că studiul nu minte)

- Fiecare rând din §2 are fișier și linie; cele două „nu există" (`/api/elevation`, cache de tile-uri)
  sînt verificate prin grep pe `backend/**/*.cs`, `Caddyfile` și `frontend/vite.config.ts`.
- „Zero teste pentru `MapExplorerView`" — verificat prin listarea `frontend/src/views/__tests__/`.
- Afirmațiile din §8 sînt verificate în cod: `GpsTracker.ts` + `GpsTracker.spec.ts`,
  `LOCATION_WATCH_OPTIONS` (`locationTransport.ts:25-33`), `foregroundServiceType="location"` în
  `frontend/android/app/src/main/AndroidManifest.xml`, absența `frontend/ios` (0 fișiere în git).
- Interogările Overpass din §7.3.7 se rulează la redactare; cifrele se scriu acolo **cu data** citirii,
  iar ce nu se confirmă se notează „nemăsurat" — nu se estimează.
- Cifrele de dimensiune **sînt acum măsurate**, nu estimate: mărimea hărților offline (§6.6), timpul
  Overpass (§3.2.6) și DEM-ul (§7.3.7), toate cu comenzi repetabile în
  [F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md) §2. Rămîn de măsurat, și se notează acolo:
  citirea arhivei **pe dispozitiv**, bundle-ul MapLibre, fps-ul și rezultatele rutării.

---

## 16. Unde stă codul: aplicația separată (2026-09-24)

**Decis:** harta, planificatorul, offline-ul pe regiune și navigarea ies din aplicația de antrenament
într-o aplicație separată — `C:\projects\ttrmap`, repo propriu. Documentul de față, împreună cu
[F0-MAP-IMPLEMENTATION.md](F0-MAP-IMPLEMENTATION.md), s-a mutat cu ea.

**De ce.** Un singur motiv, măsurabil: `MapView` (fostul `MapExplorerView`) are **1,08 MB** de
JavaScript, 293,9 kB gzip, din care aproape tot e MapLibre. În aplicația de antrenament chunk-ul era
lazy și exclus din precache, deci cine nu deschidea harta nu-l plătea — dar rămînea un ecran de 1500 de
linii, un strat de date și trei endpoint-uri care nu au legătură cu antrenamentul, iar offline-ul care
urmează (hartă descărcată pe masiv, DEM, rutare pe graful local) e altă poveste de produs.

**Cum se țin împreună.** Rămîn un singur produs prin backend: aceeași bază, același cont, același JWT.
`MountainPoisController`, `ElevationController` și `RoutingController` **rămîn în TTR** — aplicația de
hartă e un al doilea client al aceluiași API, nu un al doilea backend.

**Ce rămîne deliberat în antrenament:** hărțile mici Leaflet (`MapTrack`, `SessionTrackMap`,
`GroupRouteMap`), `GpxParser`, `stores/route.ts`, `utils/apiBase.ts` și `PersonalHeatmapView`.

**Codul comun e copiat, nu partajat** (autentificare, `apiBase`, `userScopedStorage`, paleta): ~600 de
linii care se schimbă rar. Un pachet partajat ar aduce un workspace npm și un CI cuplat pentru toate
cele două, cost care nu se plătește la mărimea asta.

**Ce rămîne valabil din studiul de față:** tot. Numerele de linie din §2 și §3 trimit la fișiere care
acum sînt în `C:\projects\ttrmap\src\` (`MapExplorerView.vue` se numește `views/MapView.vue`,
`stores/route.ts` a devenit `stores/routes.ts`, iar `services/geo/locationTransport.ts` are tipul
`GeoFix` local, în `services/geo/geoFix.ts`, ca să nu tragă după el metricile de alergare).

**Ce încă nu e mutat:** nimic din ce ține de hartă. Au rămas doar cele de mai sus, deliberat.