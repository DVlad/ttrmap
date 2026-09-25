/**
 * Un fix de poziție, normalizat: aceeași formă indiferent dacă vine din Web Geolocation sau din
 * pluginul Capacitor. Tipul stă singur, fără nicio dependență, fiindcă îl folosesc și transportul de
 * poziție, și viitoarea urmărire pe traseu.
 *
 * <p>
 * În TTR tipul ăsta locuiește lîngă metricile de alergare (`services/geo/runMetrics.ts`), care trag
 * după ele înregistratorul de serie și BLE. Aici nu are ce căuta toată lanțul — de aceea e separat.
 * </p>
 */
export interface GeoFix {
  latitude: number;
  longitude: number;
  /** Altitudinea (metri), dacă platforma a raportat-o. */
  altitudeM: number | null;
  /** Precizia orizontală raportată (metri), dacă platforma a raportat-o. */
  accuracyM: number | null;
  /** Viteza raportată de senzor (m/s), dacă platforma a raportat-o. */
  speedMps: number | null;
  /** Momentul fixului (epoch ms). */
  timestampMs: number;
}
