/**
 * Durata unei sesiuni, în format de ceas (`h:mm:ss`, respectiv `mm:ss`).
 *
 * Un singur loc, folosit de istoric și de rezultatele grupului: două formattere locale ar putea
 * diverge, iar aceeași sesiune ar apărea cu durate scrise diferit pe două ecrane.
 */
export function formatClockDuration(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Aceeași durată, pe scurt: „1h 25min", „42min".
 *
 * Varianta pentru cartele și sumar, unde secundele nu interesează. Stă tot aici, lângă cea de ceas,
 * ca cele două să nu se împrăștie prin ecrane — până acum funcția trăia în `useWorkoutBuilder`, iar
 * cine avea nevoie de ea de pe alt ecran importa un composable întreg.
 */
export function formatDurationShort(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}
