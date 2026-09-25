# Mutarea hărții în aplicația separată (TTR Hartă)

**Data:** 2026-09-24 · **Unde:** `C:\projects\ttrmap` (repo separat)

Harta, planificatorul de trasee și tot ce ține de ele au fost mutate într-o aplicație separată, ca
aplicația de antrenament să nu mai care 1 MB de MapLibre și un strat de date care nu se folosește pe
niciunul dintre ecranele ei. Cele două rămîn **un singur produs**: același backend, același cont,
aceeași paletă. Decizia și consecințele ei sînt notate în `STUDY-MAP.md` §16.

## Ce a plecat

`MapExplorerView.vue` → `MapView.vue`, `ElevationProfileChart.vue`, `services/map/*`,
`services/api/{mountainPoisApi,elevationApi,routingApi,routesApi}.ts`,
`services/gpx/{GpxParser,GpxWriter}.ts`, `services/geo/{geoMath,geoFix,locationTransport}.ts`,
`utils/{trailStats,elevationProfile,html,duration,apiBase,userScopedStorage}.ts`, `assets/theme.css`,
`LanguageSelector.vue`, plus testele lor (13 fișiere, 122 de teste).

`docs/STUDY-MAP.md` și `docs/F0-MAP-IMPLEMENTATION.md` s-au mutat și ele — sînt documentația hărții, iar
aici nu mai are cine să le țină la zi.

## Ce a rămas (deliberat)

- **Hărțile mici Leaflet** din antrenament: `MapTrack.vue` (Ride, Run), `SessionTrackMap.vue`
  (ActivityRow), `GroupRouteMap.vue` (Grupuri). Acolo harta e un detaliu de ecran, nu ecranul.
- **`services/gpx/GpxParser.ts`**, **`stores/route.ts`**, **`utils/apiBase.ts`** — folosite de ride,
  grupuri și de restul aplicației.
- **`PersonalHeatmapView.vue`** — e tot o hartă, dar citește activități și se leagă de istoricul de
  antrenament; mutarea ei ar trage după sine jumătate din TTR.
- **Backend-ul întreg**, inclusiv `MountainPoisController`, `ElevationController`,
  `RoutingController`: aplicația de hartă e un al doilea client al aceluiași API.

## De ce nu s-a partajat codul

Codul comun dintre cele două aplicații (autentificare, `apiBase`, `userScopedStorage`, `GpxParser`,
paleta) e **copiat**, nu extras într-un pachet. Motivul e mărimea: ~600 de linii, fiecare cu teste deja
scrise, într-o zonă care se schimbă rar. Un pachet partajat ar aduce un workspace npm, o versiune de
publicat și un CI care trebuie să treacă pentru amîndouă înainte ca oricare să poată livra — cost care
nu se plătește la 600 de linii.

Unde duplicarea ar începe să doară: cînd unul dintre cele două schimbă *contractul* (nu
implementarea) — de exemplu dacă autentificarea capătă alt flux. Atunci se extrage.

## Ce urmează în aplicația nouă

Offline pe regiune (F4) și urmărirea pe traseu (F3b) — amîndouă sînt în `STUDY-MAP.md` §9, cu
măsurătorile deja făcute pentru offline.
