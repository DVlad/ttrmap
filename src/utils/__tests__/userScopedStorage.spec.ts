import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_ID_STORAGE_KEY,
  beginAccountSession,
  clearUserScopedStorage,
  currentUserId,
  endUserSession,
  onAccountChange,
  userStorageKey,
} from "@/utils/userScopedStorage";

/**
 * Cheile de cont erau globale, iar logout-ul ștergea doar cheile de auth: pe același browser, contul
 * următor găsea cache-ul celui precedent și putea relua scrierile rămase în coadă. Testele de aici
 * apără contractul: namespace per cont, ștergere la logout, dar **fără** să atingă preferințele de
 * dispozitiv (limbă, temă, bannerul de instalare, ultimul dispozitiv BLE).
 */
describe("userScopedStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("namespace-uiește cheile după contul care deține datele", () => {
    beginAccountSession(7);

    expect(userStorageKey("workouts")).toBe("ttr_u7_workouts");
    localStorage.setItem(userStorageKey("sync_queue"), "[]");
    expect(localStorage.getItem("ttr_u7_sync_queue")).toBe("[]");

    beginAccountSession(9);
    expect(userStorageKey("sync_queue")).toBe("ttr_u9_sync_queue");
    // Contul nou nu vede cheia celui vechi (a fost și ștearsă, vezi testul următor).
    expect(localStorage.getItem("ttr_u9_sync_queue")).toBeNull();
  });

  it("alt cont la autentificare → datele contului precedent se șterg", () => {
    beginAccountSession(7);
    localStorage.setItem(userStorageKey("workouts", 7), "[{\"id\":1}]");
    localStorage.setItem(userStorageKey("sync_queue", 7), "[{\"id\":\"op\"}]");

    beginAccountSession(9);

    expect(localStorage.getItem("ttr_u7_workouts")).toBeNull();
    expect(localStorage.getItem("ttr_u7_sync_queue")).toBeNull();
    expect(localStorage.getItem(ACCOUNT_ID_STORAGE_KEY)).toBe("9");
  });

  it("același cont la reautentificare → datele rămân (scrierile offline se trimit mai târziu)", () => {
    beginAccountSession(7);
    localStorage.setItem(userStorageKey("sync_queue", 7), "[{\"id\":\"op\"}]");

    // Sesiune expirată: tokenul dispare, dar datele contului rămân ale lui.
    localStorage.removeItem("ttr_auth_token");
    localStorage.removeItem("ttr_auth_user");

    beginAccountSession(7);

    expect(localStorage.getItem("ttr_u7_sync_queue")).toBe("[{\"id\":\"op\"}]");
  });

  it("logout-ul șterge toate conturile trecute prin browser și cheile vechi, nenumite", () => {
    beginAccountSession(7);
    localStorage.setItem(userStorageKey("workouts", 7), "[]");
    localStorage.setItem(userStorageKey("training_plans", 3), "[]");
    localStorage.setItem("ttr_workouts", "[]"); // cheie dinainte de namespacing
    localStorage.setItem("ttr:workout:session", "{}");
    sessionStorage.setItem(userStorageKey("strava_last_search", 7), "{}");

    endUserSession();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(accountIdFromStorage()).toBe(0);
  });

  it("preferințele de dispozitiv nu sunt atinse de ștergere", () => {
    beginAccountSession(7);
    // Cheile reale de dispozitiv (temă, limbă, notificări, bannere, ultimul dispozitiv BLE): nu
    // aparțin unui cont, deci nu trebuie șterse nici la logout, nici la schimbarea contului.
    const deviceKeys: Record<string, string> = {
      "ttr-app-theme": "light",
      "user-locale": "ro",
      "ttr-notifications-enabled": "true",
      "ttr-install-banner-dismissed-at": "1",
      "ttr-app-update-dismissed-code": "5",
      "ttr:ble:lastDeviceId": "device-1",
    };
    for (const [key, value] of Object.entries(deviceKeys)) localStorage.setItem(key, value);
    localStorage.setItem(userStorageKey("workouts", 7), "[]");

    endUserSession();

    for (const [key, value] of Object.entries(deviceKeys)) {
      expect(localStorage.getItem(key)).toBe(value);
    }
    expect(localStorage.getItem("ttr_u7_workouts")).toBeNull();
  });

  it("ștergerea namespace-urilor nu uită proprietarul (abia logout-ul face asta)", () => {
    beginAccountSession(7);
    localStorage.setItem(userStorageKey("workouts", 7), "[]");

    clearUserScopedStorage();

    expect(localStorage.getItem("ttr_u7_workouts")).toBeNull();
    expect(accountIdFromStorage()).toBe(7);
  });

  it("currentUserId citește contul logat, iar accountId supraviețuiește expirării sesiunii", () => {
    localStorage.setItem("ttr_auth_user", JSON.stringify({ id: 12, name: "Atlet" }));
    expect(currentUserId()).toBe(12);

    beginAccountSession(12);
    localStorage.removeItem("ttr_auth_user");

    // Sesiunea a murit (fără token/user), dar datele știu încă cui aparțin.
    expect(currentUserId()).toBe(0);
    expect(userStorageKey("workouts")).toBe("ttr_u12_workouts");
  });

  it("anunță schimbarea contului doar când proprietarul se schimbă", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = onAccountChange(listener);

    beginAccountSession(7);
    expect(listener).toHaveBeenCalledTimes(1);

    // Același cont (reautentificare) → stările din memorie rămân valide, nu le reîncărcăm degeaba.
    beginAccountSession(7);
    expect(listener).toHaveBeenCalledTimes(1);

    beginAccountSession(9);
    expect(listener).toHaveBeenCalledTimes(2);

    endUserSession();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    beginAccountSession(11);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

function accountIdFromStorage(): number {
  const raw = localStorage.getItem(ACCOUNT_ID_STORAGE_KEY);
  return raw === null ? 0 : Number(raw);
}
