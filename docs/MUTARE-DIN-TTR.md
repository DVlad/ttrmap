# Mutarea hărții în aplicația separată (TTR Hartă)

**Data:** 2026-09-24 (frontend) și 2026-09-25 (backend) · **Unde:** `C:\projects\ttrmap`

Harta, planificatorul de trasee și tot ce ține de ele au fost mutate într-o aplicație separată. Cele
două aplicații rămîn **un singur produs**: același cont, aceeași bibliotecă de trasee, aceeași paletă.

## Două etape

**Etapa 1 (2026-09-24) — frontend-ul.** Ecranele, straturile de hartă și planificatorul au plecat din
TTR, care a scăpat astfel de 1,08 MB de MapLibre (chunk leneș, dar prezent în repo), de dependența
`maplibre-gl` și de 1500 de linii de ecran.

**Etapa 2 (2026-09-25) — backend-ul de hartă.** Au plecat și `MountainPoisController`,
`ElevationController`, `RoutingController`, serviciile lor (Overpass, DEM Copernicus, Valhalla),
entitatea, repository-ul, migrarea și serviciul Valhalla din `docker-compose`. TTR nu mai are **nicio**
urmă de hartă: nici cod, nici tabelă, nici motor de rutare.

## Ce a plecat

**Frontend:** `MapExplorerView.vue` → `MapView.vue`, `ElevationProfileChart.vue`, `services/map/*`,
`services/api/{mountainPoisApi,elevationApi,routingApi,routesApi}.ts`,
`services/gpx/{GpxParser,GpxWriter}.ts`, `services/geo/{geoMath,geoFix,locationTransport}.ts`,
`utils/{trailStats,elevationProfile,html,duration,apiBase,userScopedStorage}.ts`, `assets/theme.css`,
`LanguageSelector.vue`, plus testele lor.

**Backend:** `TTRMap.Domain` / `TTRMap.Application` / `TTRMap.Infrastructure` / `TTRMap.Api` /
`TTRMap.Tests` — 19 fișiere mutate, 133 de teste. `MapDbContext` are **o singură tabelă**
(`MountainPois`), iar migrarea `InitialMapSchema` o creează de la zero.

**Documentație și infrastructură:** `docs/STUDY-MAP.md`, `docs/F0-MAP-IMPLEMENTATION.md`,
`docker/valhalla/` (imaginea motorului de rutare).

## Ce a rămas (deliberat)

- **Hărțile mici Leaflet** din antrenament: `MapTrack.vue` (Ride, Run), `SessionTrackMap.vue`
  (ActivityRow), `GroupRouteMap.vue` (Grupuri). Acolo harta e un detaliu de ecran, nu ecranul.
- **`services/gpx/GpxParser.ts`**, **`stores/route.ts`**, **`utils/apiBase.ts`** — folosite de ride,
  grupuri și de restul aplicației.
- **`PersonalHeatmapView.vue`** — e tot o hartă, dar citește activități și se leagă de istoricul de
  antrenament; folosește Leaflet, nu MapLibre.
- **Contul și traseele salvate.** Tabelele `Users` și `Routes` rămîn în TTR, fiindcă le folosește și
  antrenamentul. Harta le cheamă de acolo, cu același token.

## Cum se țin împreună, acum că sînt două servicii

| | |
| --- | --- |
| Contul | Token JWT emis de TTR, validat de serviciul de hartă (același issuer, audience și **secret**) |
| Traseele salvate | `GET/POST /api/routes` din TTR — harta nu are tabelă de trasee |
| Punctele montane, altitudinile, rutarea | Serviciul de hartă, sub `/map-api` în producție |
| Paleta și textele | Aceeași paletă (`assets/theme.css`), cataloage i18n proprii, decupate |

**Ce se pierde, spus explicit** (consecințe reale ale separării, nu scăpări):

1. **Rolul de administrator nu se mai citește din bază.** Serviciul de hartă nu are tabel de
   utilizatori, deci poarta de admin (`[AdministratorOnly]`, doar pe importul de puncte) se sprijină pe
   lista `Admin:Emails` din configurare. Un admin scos din listă păstrează accesul pînă îi expiră
   tokenul (30 de minute).
2. **Un token revocat în TTR rămîne valid la serviciul de hartă** pînă la expirare (≤30 de minute).
   TTR verifică versiunea de sesiune din bază; aici nu se poate. Expunerea e mică și suprafața e
   punctele montane, altitudinile și rutarea.
3. **Datele nu se mută singure.** TTR are o migrare `DropMountainPois`, iar baza hărții pornește goală.
   Ordinea corectă la deploy: se importă punctele în baza hărții (sau se copiază tabela), **apoi** se
   aplică migrarea de drop. Altfel se pierd verificările făcute de un om — importul singur le reface pe
   toate ca neverificate.

## De ce codul comun e copiat, nu partajat

Autentificarea, `apiBase`, `userScopedStorage`, `GpxParser` și paleta sînt **copiate**, nu extrase
într-un pachet: ~600 de linii care se schimbă rar. Un pachet partajat ar aduce un workspace npm, o
versiune de publicat și un CI cuplat pentru ambele aplicații — cost care nu se plătește la mărimea asta.

Unde duplicarea ar începe să doară: cînd se schimbă *contractul* (nu implementarea) — de exemplu dacă
autentificarea capară alt flux. Atunci se extrage.

## Ce urmează în aplicația nouă

Offline pe regiune (F4) și urmărirea pe traseu (F3b) — amîndouă sînt în `STUDY-MAP.md` §9, cu
măsurătorile deja făcute pentru offline.
