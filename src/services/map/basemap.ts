/**
 * Stilurile hărții de bază — tile-uri **vectoriale**, fără cheie de API și fără cont.
 *
 * De ce vectorial și nu raster (decizia din `docs/STUDY-MAP.md` §5.1, §6):
 * - un strat de trasee devine o **stilizare**, nu mii de obiecte desenate de mînă (problema măsurată
 *   a ecranului vechi, §3.2.2);
 * - offline-ul se poate construi pe **un singur fișier** per regiune, pentru că aceleași date se pot
 *   servi dintr-o arhivă (măsurat: 8,7 MB pentru un masiv, §6.6);
 * - furnizorii publici de raster (`tile.openstreetmap.org`, OpenTopoMap) **interzic** descărcarea în
 *   volum, deci pe ei offline-ul nu se putea construi oricum.
 *
 * Stilurile de mai jos sînt servite public de OpenFreeMap (date OpenStreetMap, fără înregistrare).
 * Cînd trecem la tile-urile noastre (F4), se schimbă **doar `url`-ul** din `sources`, nu layerele.
 */

export const MAP_STYLES = [
  { key: "liberty", labelKey: "map.layers.liberty", url: "https://tiles.openfreemap.org/styles/liberty" },
  { key: "bright", labelKey: "map.layers.bright", url: "https://tiles.openfreemap.org/styles/bright" },
  { key: "positron", labelKey: "map.layers.positron", url: "https://tiles.openfreemap.org/styles/positron" },
  { key: "dark", labelKey: "map.layers.dark", url: "https://tiles.openfreemap.org/styles/dark" },
] as const;

export type MapStyleKey = (typeof MAP_STYLES)[number]["key"];

export const DEFAULT_MAP_STYLE: MapStyleKey = "liberty";

/** Adresa stilului, după cheie. Aruncă dacă cheia nu există — un stil inventat ar însemna hartă albă. */
export function mapStyleUrl(key: MapStyleKey): string {
  const style = MAP_STYLES.find((entry) => entry.key === key);
  if (!style) throw new Error(`Stil de hartă necunoscut: ${key}`);
  return style.url;
}

/**
 * Id-urile straturilor noastre, peste stilul de bază. Sînt constante pentru că harta le caută după
 * nume la fiecare actualizare de date: o literă schimbată într-un singur loc ar face ca stratul să nu
 * se mai actualizeze, fără nicio eroare vizibilă.
 */
export const OUR_LAYERS = {
  trails: "ttr-trails",
  plannedRoute: "ttr-planned-route",
  /** Segmentele de rută ale planificatorului, cînd există. */
  myRoutes: "ttr-my-routes",
  pois: "ttr-pois",
} as const;

export const OUR_SOURCES = {
  trails: "ttr-trails-src",
  plannedRoute: "ttr-planned-route-src",
  myRoutes: "ttr-my-routes-src",
  pois: "ttr-pois-src",
} as const;
