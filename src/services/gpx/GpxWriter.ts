import type { GpxRoute } from "./GpxParser";

/**
 * Scrierea unui traseu ca fișier `.gpx`, ca planificatorul să poată **ieși** din aplicație: pe ceas,
 * în altă aplicație, într-un mesaj către grup.
 *
 * Perechea parserului din `GpxParser.ts`: ce se scrie aici trebuie să se și poată citi înapoi, iar
 * testul face exact turul complet (serializează → parsează → aceleași puncte).
 */

/** Escape XML: numele traseului vine de la utilizator, deci poate conține `&` sau `<`. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Traseu → GPX 1.1.
 *
 * `<ele>` se scrie **întotdeauna**, inclusiv cînd altitudinea e `0` (un traseu planificat fără DEM):
 * omiterea elementului ar face ca altitudinea să pară necunoscută, iar `0` e o valoare cunoscută și
 * asumată. Cine importă fișierul trebuie să vadă exact ce avem, nu o presupunere.
 */
export function serializeGpx(route: GpxRoute): string {
  const points = route.points
    .map((p) => `      <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.alt}</ele></trkpt>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TTR" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(route.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Nume de fișier sigur, derivat din numele traseului (același tipar ca exportul FIT). */
export function gpxFileName(name: string): string {
  const safe = name.replace(/[^\w\u0080-\uFFFF\s-]/g, "").replace(/\s+/g, "_");
  return `${safe || "traseu"}.gpx`;
}

/** Descarcă traseul ca fișier `.gpx` în browser (în aplicația nativă, WebView-ul descarcă la fel). */
export function downloadGpx(route: GpxRoute): void {
  const blob = new Blob([serializeGpx(route)], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = gpxFileName(route.name);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
