/**
 * Escape pentru text străin pus în HTML construit manual.
 *
 * De ce e nevoie de un modul propriu: popup-urile Leaflet se compun ca șiruri de HTML, iar textul din
 * ele vine din **date externe** (nume de traseu și de punct din OpenStreetMap, pe care oricine le
 * poate edita). Interpolat direct, un nume de genul `<img src=x onerror=...>` devine cod care rulează
 * în aplicație — adică exact definiția unui XSS stocat, doar că sursa e un wiki public, nu un formular
 * al nostru.
 *
 * Vue escapează singur textul din template-uri; aici nu avem template, avem `innerHTML`, deci
 * escape-ul trebuie făcut de mînă — o singură dată, într-un singur loc, ca să nu depindă de memoria
 * fiecărui popup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
