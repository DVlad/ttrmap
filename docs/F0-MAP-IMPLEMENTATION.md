# Fișă de execuție: F0 — poarta de decizie pentru hartă (offline + rutare + DEM)

> **Acest document trăiește acum aici**, în repo-ul aplicației de hartă (mutat din TTR pe 2026-09-24,
> odată cu harta). Vezi [STUDY-MAP.md](STUDY-MAP.md) §16 pentru ce s-a mutat și ce a rămas în TTR.

**Stare:** **parțial măsurat** (2026-09-23). Ce se putea măsura fără telefon și fără VPS s-a măsurat
deja și e în §2. Ce rămîne cere hardware (§3–§5) și nu se poate face din repo.

**Studiul din care pleacă:** [STUDY-MAP.md](STUDY-MAP.md) — §6 (offline pe regiune), §7.3 (zone de risc),
§8 (navigare), §9 (faze), unde **F1 e deja livrat**.

**De ce există F0:** offline-ul și rutarea sînt singurele părți din studiu care pot eșua din motive pe
care nu le știm azi. F0 nu livrează cod de produs: livrează **cifre** și o **decizie** (mergem / amânăm).
Fără ele, promisiunea de offline e o presupunere.

---

## 1. Cele trei întrebări la care F0 răspunde

| # | Întrebare | Poarta |
| --- | --- | --- |
| 1 | Poate aplicația să citească o hartă offline **pe dispozitiv**, pe Android și pe iOS? | dacă **nu** pe Android → offline-ul se amână |
| 2 | Merită un motor de rutare găzduit (Valhalla) față de A\* local peste traseele marcate? | dacă niciunul nu bate OSRM-ul actual pe trasee reale → rămînem pe rutare simplă |
| 3 | E utilă banda de pantă 30–45° din DEM ca strat de risc? | dacă nu se potrivește cu zonele cunoscute → rămîne doar catalogul de zone semnalizate |

---

## 2. Ce s-a măsurat deja (2026-09-23, fără telefon, fără VPS)

Totul de mai jos a fost rulat pe mașina de dezvoltare. **Nu e estimare** — comenzile sînt în text, deci
se pot repeta.

### 2.1 Mărimea hărții offline (bază vectorială Protomaps)

Sursă: build-ul public zilnic Protomaps (`build.protomaps.com/<YYYYMMDD>.pmtiles`), dată OSM
**2026-09-23T04:00Z** (din metadata arhivei). Unealta: `protomaps/go-pmtiles` prin Docker.

```powershell
$src = "https://build.protomaps.com/20260923.pmtiles"
docker run --rm -v "${env:TEMP}:/data" protomaps/go-pmtiles extract $src /data/fagaras.pmtiles `
  --bbox=24.20,45.30,25.00,45.75 --maxzoom=14
```

| Regiune | maxzoom | Tile-uri | **Mărime pe disc** |
| --- | --- | --- | --- |
| Făgăraș (24.20,45.30 → 25.00,45.75) | 14 | 1 549 | **8,7 MB** |
| Făgăraș | 15 | 5 892 | **13,2 MB** |
| Retezat (22.60,45.25 → 23.30,45.55) | 14 | 916 | **4,8 MB** |
| România întreagă (20.20,43.60 → 29.70,48.30) | 14 | 174 520 | **613,8 MB** |

Extracția unui masiv a durat **12 secunde**, 61 de cereri HTTP (PMTiles citește doar intervalele
necesare). Atribuirea (`© OpenStreetMap`) e **în arhivă**, în metadata — nu trebuie adăugată de mînă,
dar trebuie citită și afișată.

### 2.2 Mărimea stratului **nostru** (trasee marcate, POI, dificultate)

Baza Protomaps **nu** conține ce ne interesează cel mai mult: marcajele `osmc:symbol`, cabanele,
zonele de dificultate. Alea se construiesc de noi. Măsurat pe Făgăraș, prin Overpass (`out geom`):

| Ce | Cît |
| --- | --- |
| Răspuns JSON necomprimat | **4 161 KB (4,1 MB)** |
| Timp de răspuns | **177,7 s** (aproape 3 minute) |
| Mirror-ul principal (`overpass-api.de`) | **HTTP 504** |
| Elemente | 26 noduri · 231 way-uri · 104 relații |
| …din care cu `osmc:symbol` | 112 |
| …cabane (`alpine_hut`/`wilderness_hut`/`chalet`) | **41** |
| …refugii (`shelter_type=basic_hut/lean_to`) | **17** |
| …posturi Salvamont | 2 |
| …way-uri cu `sac_scale` | **205** |
| …way-uri cu `mtb:scale` | 12 |

**4,1 MB e un plafon superior, nu mărimea finală:** e JSON brut de la Overpass, cu geometrie completă
și fără simplificare. După conversie în tile-uri vectoriale (geometrie simplificată pe zoom, cîmpuri
reținute) se așteaptă **sub 1 MB** — de măsurat la F2, nu de presupus aici.

### 2.3 DEM (Copernicus GLO-30)

Tile-uri de 1°×1°, COG GeoTIFF, pe AWS Open Data, **fără cont și fără cheie** (verificat: HTTP 200).

| Tile | Mărime |
| --- | --- |
| `N45_00_E024_00` (acoperă Făgărașul vestic) | **41,2 MB** |
| `N45_00_E025_00` | 40,6 MB |
| `N46_00_E024_00` | 41,1 MB |

Un masiv intră în 1–2 tile-uri → **~41–82 MB** de descărcat **o singură dată, pe server**. Ce ajunge
la telefon e derivatul (umbrire + bandă de pantă), nu COG-ul — de măsurat în F0 #3 (§5).

### 2.4 Ce au arătat măsurătorile (și ce schimbă în studiu)

1. **Mărimea nu mai e un risc.** Estimarea din studiu („zeci de MB per masiv") era pesimistă:
   **8,7 MB** per masiv la zoom 14. Offline-ul nu se mai poate amâna pe motiv de spațiu.
2. **Overpass e inutilizabil în calea critică.** 178 de secunde și un 504 pentru **un singur masiv**,
   pe cel mai bun mirror. Nu e o problemă de optimizare: e dovada că F2 (datele noastre, servite de noi)
   e obligatoriu, nu o îmbunătățire. Vezi `STUDY-MAP.md` §3.2.6.
3. **Datele montane există în OSM pe Făgăraș** — 205 way-uri cu `sac_scale`, 41 de cabane, 17 refugii.
   Stratul de dificultate și cel de POI nu pornesc de la zero (§7.3.2 din studiu nu mai e o speranță).
4. **Rămîne poarta reală**, neschimbată: citirea arhivei **pe dispozitiv** (§3). Măsurătorile de aici
   sînt pe desktop, prin Docker — nu dovedesc nimic despre WebView.

### 2.5 Ce a mai ieșit la primul import real (F2, 2026-09-23)

Nu e o măsurătoare de F0, dar tot cifre sînt, și tot din sursa reală. Importul s-a rulat prin
`--import-mountain-pois 45.32,25.35,45.48,25.60` (Bucegi), în baza de dev.

| Constatare | Cifră / dovadă |
| --- | --- |
| Puncte importate dintr-o zonă mică | **132** (45 indicatoare, 41 belvedere, 28 cabane, 10 Salvamont, 6 izvoare, 2 refugii) |
| Timp de răspuns al sursei | **17,8 s**, 25 KB — pe mirror-ul `private.coffee` |
| Failover pe mirror-uri | `overpass-api.de` → **504** (8,1 s); `kumi.systems` → **429**; `private.coffee` → OK |
| **`User-Agent` obligatoriu** | Fără el, Overpass răspunde **406 Not Acceptable**. `HttpClient` nu trimite niciunul implicit |
| Cabane desenate ca **suprafață** | **11 din 29** în Bucegi — fără `out center` în interogare, sînt sărite în tăcere |
| Idempotența importului | A doua rulare: **128 actualizate, 4 noi, 0 duplicate** |
| Nume lipsă | **64 din 132** puncte n-au nume (mai ales indicatoare și belvedere) — de aceea ecranul cade pe eticheta categoriei |

**Consecință de produs, nu doar tehnică:** dintr-o zonă mică, 86 din 132 de puncte sînt indicatoare și
belvedere. Dacă toate ar fi bifate implicit, harta s-ar umple de puncte mărunte exact acolo unde omul
caută o cabană. Implicitul din aplicație e deci cabane + refugii + Salvamont + apă, iar restul se
bifează la cerere.

---

## 3. F0 #1 — offline pe dispozitiv (poarta care poate opri tot)

**De ce e greu:** MapLibre citește un `.pmtiles` prin cereri `Range`. Pe desktop merge. În WebView-ul
aplicației native, fișierul stă pe disc, iar `fetch()` **nu poate citi `file://`**. Pe iOS se mai adaugă
că `capacitor://` **nu are service worker**.

### Ce se încearcă, în ordine

1. **Android, server local în pluginul Capacitor** — cel mai probabil să meargă: un `ServerSocket`
   mic care servește fișierul cu suport de `Range`, iar MapLibre primește `http://127.0.0.1:<port>/…`.
   Precedent în proiect: pluginul propriu `RunTrackingPlugin.java` (foreground service).
2. **Android, OPFS / Cache Storage** — varianta fără server: arhiva se ține în OPFS, iar un protocol
   custom `pmtiles://` o citește prin `FileSystemSyncAccessHandle`. De verificat dacă merge în WebView.
3. **iOS** — `frontend/ios` **nu există** în repo (`0` fișiere în git), deci nu se poate testa nimic
   pînă nu se adaugă platforma (`npx cap add ios`, Mac + Xcode). **Asta e o decizie de produs, nu o
   măsurătoare** — vezi §7.

### Ce se notează (obligatoriu, altfel măsurătoarea nu contează)

| Ce | De ce |
| --- | --- |
| Se încarcă harta cu **modul avion pornit**? | condiția de bază |
| Timp pînă la prima tile desenată | peste 2 s, omul crede că e stricat |
| Memorie folosită cu o arhivă de 13 MB | WebView-ul de pe telefoanele slabe e limita reală |
| Se poate **șterge** regiunea din aplicație? | fără asta, promisiunea de spațiu e goală |
| Merge și cu ecranul stins (hartă în fundal)? | nu e cerință de offline, dar e de navigare |

### Poarta

**Dacă (1) nu trece pe Android, offline-ul se amână** și se spune deschis. Nu se livrează „offline" care
merge doar pe desktop.

---

## 4. F0 #2 — rutare: Valhalla găzduit vs. A\* local

> **Măsurat pe 2026-09-24.** Rezultatele sînt în §4.1, iar poarta a fost trecută: motorul a fost
> adoptat și integrat (§4.2). Ce rămîne din capitolul ăsta e partea de A\* local, neîncepută.

```powershell
# 1. Extractul OSM al României (Geofabrik)
#    romania-latest.osm.pbf  (313,6 MB, descărcat în 423 s)
# 2. Valhalla în Docker, cu tile-uri construite din extract
#    imaginea: ghcr.io/valhalla/valhalla:latest — are toate binarele, dar NU are entrypoint
#    și nu construiește nimic, deci scriptul de pornire e al nostru (docker/valhalla/)
# 3. Trei cereri de rută, pe cele trei trasee de test
```

**Traseele de test** (de ales concret, cu puncte de start/sosire reale):

| # | Tip | Ce verifică |
| --- | --- | --- |
| 1 | Traseu marcat, cu `osmc:symbol` | preferă poteca marcată sau taie pe drum forestier? |
| 2 | Traseu MTB (`mtb:scale`) | refuză sau acceptă poteca prea tehnică? |
| 3 | Traseu de creastă, expus (`sac_scale=demanding_alpine_hiking`) | îl acceptă, îl ocolește, sau refuză? |

**Se notează:** timp de răspuns, dacă ruta respectă `sac_scale`, distanța față de traseul real,
și dacă instrucțiunile (pentru navigare, §8.3) au sens pe potecă nemarcată.

**Poarta:** dacă Valhalla nu bate vizibil rutarea actuală pe trasee reale de munte, **nu se introduce** —
se păstrează rutarea simplă și se investește în hartă și offline.

### 4.1 Rezultatele măsurătorii (2026-09-24)

Metoda: pentru fiecare tip de traseu s-a luat **traseul real din OSM** ca referință (o relație marcată
sau un drum cu `sac_scale` / `mtb:scale`), iar capetele lui au fost date ca plecare/sosire ambelor
motoare. S-a măsurat ce fracțiune din ruta întoarsă stă la **mai puțin de 50 m** de traseul de
referință („pe traseu"), plus abaterea maximă. Scripturile de măsurare sînt în `.verify/` (nu intră în
repo — sînt unelte de măsurat, nu cod de produs).

| Traseu | Referință | Valhalla | OSRM public (`foot` / `bike`) |
| --- | --- | --- | --- |
| Marcat (`osmc:symbol`, Azuga → Diham) | 11,92 km | **6,20 km**, 73 min, 263 ms, **100% pe traseu**, abatere 0 m | 41,02 km, 84 min, 153 ms, **0,1%**, abatere **11 500 m** |
| MTB (`mtb:scale=1`) | 1,16 km | **1,16 km**, 6 min, 53 ms, **100%**, 0 m | 38,35 km, 127 min, 240 ms, **0,2%**, abatere **11 021 m** |
| Creastă expusă (`demanding_alpine_hiking`) | 3,04 km | 5,18 km, 78 min, 4 ms, 3,9%, 1051 m | 37,35 km, 71 min, 82 ms, **0%**, abatere **8 908 m** |

**Opțiunile de cost sînt respectate** — verificat printr-o baleiere separată, pe creasta expusă:

| Setare | Distanță |
| --- | --- |
| `max_hiking_difficulty=1` (T1, implicitul motorului) | **22,25 km** — ocolește poteca T5 |
| `max_hiking_difficulty=3` | 5,18 km |
| `max_hiking_difficulty=6` | 5,18 km |

Adică opțiunea nu e decorativă, iar valoarea implicită (1) ar fi refuzat tăcut exact potecii de munte
care ne interesează. De aceea aplicația trimite **6**.

**Verdict: poarta trece.** Valhalla bate OSRM-ul public fără discuție pe primele două trasee (100%
față de 0,1%) și rămîne mult mai aproape pe al treilea. Cifra care contează nu e milisecunda, ci faptul
că ruta **e pe potecă**.

Costul infrastructurii, tot măsurat: **378 MB** de tile-uri pentru toată România, construite în
**356 s** (~6 minute), cu **81 MB RSS** în repaus — tile-urile se citesc prin `mmap`, deci nu cer heap
pe măsură. Nu justifică o cutie separată de VPS-ul actual.

### 4.2 Ce s-a livrat

Motorul e integrat: backend-ul îl cheamă (`ValhallaRoutingProvider`), ecranul cheamă backend-ul
(`POST /api/routing/route`), iar ambele stive Docker au serviciul în profilul `routing`. Detaliile
livrării și verificarea end-to-end sînt în [STUDY-MAP.md](STUDY-MAP.md) §9 (F3c).

**Nu s-a făcut:** A\* peste graful descărcat (rămîne pentru rutarea offline, §6.4 din studiu) și
tile-urile de altitudine Valhalla, care ar aduce pantele reale în calcul.

---

## 5. F0 #3 — DEM ca bandă de pantă

**Parțial rezolvat de F2 (2026-09-23).** Întrebarea „de unde luăm altitudini" **are răspuns**, și e
verificat pe teren: Copernicus GLO-30, citit prin cereri parțiale, dă **2506 m la Vîrful Omu** față de
2505 m cît are în OSM. Detaliile sînt în [STUDY-MAP.md](STUDY-MAP.md) §9 (F2).

Ce rămîne de aflat, și e o măsurătoare de produs, nu de infrastructură:

1. Cît ocupă **derivatul** pentru un masiv (umbrire + bandă 30–45°), nu COG-ul de 41 MB — ce se
   descarcă pe telefon la offline (§6 din studiu).
2. Cît durează prelucrarea unui masiv (o singură dată, pe server).
3. **Corespunde banda 30–45° cu zonele periculoase cunoscute?** Verificarea nu e automată: se iau
   2–3 locuri pe care le știi ca expuse și 2–3 pe care le știi ca sigure, și se compară cu harta.

**Poarta:** dacă banda nu se potrivește cu realitatea de pe teren, se renunță la ea și rămîne doar
catalogul de zone semnalizate (§7.3.3 din studiu). **Un strat de risc care nu se potrivește cu terenul
e mai rău decît niciunul.**

---

## 6. Tabel de rezultate (de completat la rulare)

| Măsurătoare | Valoare | Data | Verdict |
| --- | --- | --- | --- |
| Mărime basemap masiv (z14) | 8,7 MB (Făgăraș) | 2026-09-23 | ✅ |
| Mărime basemap masiv (z15) | 13,2 MB (Făgăraș) | 2026-09-23 | ✅ |
| Mărime basemap România (z14) | 613,8 MB | 2026-09-23 | ✅ |
| Mărime strat propriu (brut) | 4,1 MB JSON (Făgăraș) | 2026-09-23 | ✅ plafon superior |
| Timp răspuns Overpass / masiv | 177,7 s (+ un 504) | 2026-09-23 | ❌ inacceptabil |
| Copernicus GLO-30, tile 1° | ~41 MB | 2026-09-23 | ✅ |
| **PMTiles citit pe Android, mod avion** | — | — | ⬜ poarta |
| **PMTiles citit pe iOS** | — | — | ⬜ (platformă inexistentă) |
| **Valhalla vs. OSRM, 3 trasee** | **100% / 0,1% pe traseu; 378 MB tile-uri, 356 s build** | 2026-09-24 | ✅ §4.1 |
| Banda 30–45° vs. teren cunoscut | — | — | ⬜ |

---

## 7. Decizii care depind de F0

1. **Offline pe iOS:** adăugăm platforma (Mac + Xcode) sau rămînem Android + web? Azi `frontend/ios`
   nu există, deci „merge pe iOS" nu e o afirmație verificabilă.
2. **Motorul de rutare:** Valhalla găzduit (cost lunar + întreținere) sau A\* local (muncă proprie)?
   **Decis 2026-09-24: Valhalla găzduit.** Costul măsurat e mic (378 MB disc, 81 MB RSS, o construcție
   de 6 minute o singură dată), iar A\* rămîne doar pentru rutarea **offline** (§6.4 din studiu), unde
   nu e o alternativă la Valhalla, ci singura variantă.
3. **Structura arhivei offline:** un singur `.pmtiles` (bază + strat propriu + teren) sau două
   (bază separat, actualizabilă independent)? Recomandarea mea rămîne **unul**, dar măsurătoarea de
   la §5 poate schimba calculul dacă terenul iese mare.

---

## 8. Ce NU face F0

- **Nu scrie cod de produs.** Rezultatul e un tabel completat și o decizie.
  *(Excepție asumată, 2026-09-24: după ce poarta rutării a trecut, integrării i s-a dat cod de produs
  — vezi §4.2. Măsurătoarea în sine a rămas separată, în `.verify/`.)*
- **Nu alege furnizorul de DEM** în locul tău dincolo de ce s-a verificat tehnic (Copernicus e
  disponibil și fără cont; licența se confirmă înainte de import).
- **Nu promite offline.** Promisiunea se face după poarta din §3.
- **Nu atinge F1** (livrat) și nu începe F2/F3.
