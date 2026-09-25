import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  API_BASE,
  TOKENS_REFRESHED_EVENT,
  clearTokens,
  getAccessToken,
  saveTokens,
} from "@/utils/apiBase";
import { AUTH_USER_STORAGE_KEY, beginAccountSession, endUserSession } from "@/utils/userScopedStorage";

/**
 * Autentificarea în aplicația de hartă.
 *
 * <p>
 * **De ce o copie și nu store-ul din TTR.** Aici e aceeași autentificare (aceleași endpoint-uri, același
 * cont, același backend), dar store-ul din TTR are 26 KB pentru că ține Strava, Google, COROS, schimbare
 * de parolă, setări de puls, FTP, fus orar, briefing de dimineață — nimic din toate astea nu are ce
 * căuta într-o aplicație de hartă. Ce rămîne aici e exact ce trebuie ca să intri: login, înregistrare,
 * restaurarea sesiunii și ieșirea.
 * </p>
 *
 * <p>
 * Cheile de storage și mecanismul de refresh sînt **identice** cu cele din TTR (`ttr_auth_token`,
 * `ttr_auth_refresh_token`, `ttr_auth_user`) — deliberat, fiindcă `utils/apiBase.ts` le citește pe
 * aceleași. Nu se partajează sesiunea între cele două aplicații (sînt origini diferite), dar un om care
 * se autentifică în amîndouă folosește același cont.
 * </p>
 */

export interface AuthUser {
  id: number;
  email: string;
  name?: string;
  tier?: string;
  isAdmin?: boolean;
}

const STORAGE_KEY = AUTH_USER_STORAGE_KEY;

/** Serverul răspunde uneori cu ProblemDetails, alteori cu text simplu; scoatem ce se poate citi. */
function parseErrorMessage(raw: string, fallback: string): string {
  const text = raw.trim();
  if (text === "") return fallback;

  try {
    const parsed = JSON.parse(text) as { detail?: string; title?: string; message?: string };
    const message = parsed.detail ?? parsed.message ?? parsed.title;
    if (typeof message === "string" && message.trim() !== "") return message;
  } catch {
    // Nu e JSON: poate fi chiar mesajul, scris ca text.
  }

  return text.length > 200 ? fallback : text;
}

function loadUserFromStorage(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    return typeof parsed?.id === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>(null);
  const token = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isLoggedIn = computed(() => user.value !== null && token.value !== null);
  const userId = computed(() => user.value?.id ?? 0);

  function persist(nextUser: AuthUser | null) {
    if (nextUser) localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function applyAuthResponse(data: { token: string; refreshToken?: string; user: AuthUser }) {
    // Perechea se salvează împreună: tokenul de acces e scurt (minute), iar cel de refresh e singurul
    // care ține sesiunea în viață dincolo de el.
    saveTokens(data.token, data.refreshToken ?? null);
    token.value = data.token;
    user.value = data.user;
    persist(data.user);
    beginAccountSession(data.user.id);
  }

  function getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
    return headers;
  }

  async function register(email: string, password: string, name?: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          name: name ?? "",
        }),
      });
      if (!res.ok) {
        error.value = parseErrorMessage(await res.text(), "Eroare la înregistrare.");
        return false;
      }
      applyAuthResponse(await res.json());
      return true;
    } catch {
      error.value = "Server indisponibil.";
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function login(email: string, password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!res.ok) {
        error.value = parseErrorMessage(await res.text(), "Email sau parolă incorectă.");
        return false;
      }
      applyAuthResponse(await res.json());
      return true;
    } catch {
      error.value = "Server indisponibil.";
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** Încarcă sesiunea de pe disc și o validează la server. */
  async function restoreSession(): Promise<void> {
    const stored = loadUserFromStorage();
    const storedToken = getAccessToken();
    if (!stored || !storedToken) {
      clearSession();
      return;
    }

    token.value = storedToken;

    try {
      const res = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeaders() });
      if (res.ok) {
        const fresh = (await res.json()) as AuthUser;
        user.value = fresh;
        persist(fresh);
        beginAccountSession(fresh.id);
      } else {
        // Token expirat sau invalid: sesiunea se încheie, dar datele de cont rămîn pe disc — dacă
        // același utilizator se autentifică din nou, traseele lui sînt acolo.
        clearSession();
      }
    } catch {
      clearSession();
    }
  }

  /** Încheie sesiunea **fără** să atingă datele de cont. */
  function clearSession() {
    user.value = null;
    token.value = null;
    persist(null);
    clearTokens();
  }

  /** Ieșire cerută de utilizator: se încheie sesiunea și se scoate tot ce ține de contul lui. */
  function logout() {
    clearSession();
    // Fără `keepUnsyncedOperations`: aplicația de hartă nu are coadă de scrieri offline (traseele se
    // salvează direct), deci tot ce e pe disc pentru contul respectiv se șterge.
    endUserSession();
  }

  /** Reacția la un 401 venit din orice cerere: sesiunea moare, contul rămîne. */
  function handleUnauthorized() {
    clearSession();
  }

  // Tokenul de acces se poate reînnoi în fundal (`utils/apiBase.ts`); store-ul trebuie să afle, altfel
  // ar trimite tokenul vechi pînă la următoarea încărcare de pagină.
  window.addEventListener(TOKENS_REFRESHED_EVENT, (event) => {
    const detail = (event as CustomEvent<{ token?: string }>).detail;
    if (detail?.token) token.value = detail.token;
  });

  return {
    user,
    token,
    loading,
    error,
    isLoggedIn,
    userId,
    register,
    login,
    restoreSession,
    clearSession,
    logout,
    handleUnauthorized,
  };
});
