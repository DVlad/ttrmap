/**
 * Matematică geografică folosită de mai multe module (parserul GPX, înregistrarea alergării).
 *
 * Stă separat, într-un modul propriu, fiindcă formulele astea trebuie să fie **identice** oriunde
 * apar: dacă distanța unui traseu importat și cea a unei alergări înregistrate ar folosi constante
 * diferite, cele două n-ar mai fi comparabile, iar diferența ar apărea ca o eroare de măsurare.
 */

/** Raza medie a Pământului (metri) — aceeași constantă ca la parserul GPX. */
const EARTH_RADIUS_M = 6_371_000;

/** Distanța pe suprafața Pământului între două coordonate (metri), formula haversine. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
