import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE,
  REFRESH_TOKEN_KEY,
  TOKEN_KEY,
  TOKENS_REFRESHED_EVENT,
  UNAUTHORIZED_EVENT,
  freshAccessToken,
  installAuthenticatedFetch,
  refreshAccessToken,
  revokeSessionOnServer,
} from "@/utils/apiBase";

/**
 * Perechea de token-uri pe client (#6): tokenul de acces e scurt, iar un 401 nu mai înseamnă direct
 * „sesiune încheiată" — întîi se încearcă o **rotire silențioasă**, apoi cererea se reia o singură dată.
 *
 * Ce apără testele, în ordinea în care contează:
 * <list type="number">
 * <item>**single-flight**: mai multe cereri care primesc 401 în același moment folosesc **o singură**
 * rotire. Fără asta, a doua ar folosi un refresh token deja rotit, iar serverul ar citi-o ca
 * reutilizare și ar revoca lanțul întreg — adică exact opusul a ce voiam;</item>
 * <item>eșecul rotirii (401/400) încheie sesiunea o singură dată: tokenurile se șterg și se anunță
 * `ttr:unauthorized`, ca `main.ts` să ducă utilizatorul la login (fără să-l scoată dintr-un
 * antrenament în curs — vezi handler-ul de acolo);</item>
 * <item>un eșec **de rețea** la rotire NU deconectează: serverul poate fi doar temporar indisponibil,
 * iar sesiunea e încă validă;</item>
 * <item>un 401 fără token (parolă greșită la login) nu atinge nimic.</item>
 * </list>
 */
interface FetchCall {
  url: string;
  method: string;
  authorization: string | null;
  body: string | null;
}

type Handler = (url: string, init: RequestInit) => Promise<Response>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Un JWT fals: doar payload-ul contează (`exp`), restul e umplutură. */
function fakeJwt(expSecondsFromNow: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];
let handler: Handler;

/**
 * Instalează wrapper-ul peste un `fetch` curat. `installAuthenticatedFetch` capturează ce găsește în
 * `window.fetch`, deci al doilea apel peste propriul wrapper ar face recursie.
 */
function install(installHandler: Handler) {
  handler = installHandler;
  // Nu `vi.fn`: aici nu verificăm apeluri pe `fetch` (le înregistrăm noi, mai jos), iar wrapper-ul
  // oricum îl înlocuiește imediat.
  window.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) =>
    handler(String(input), init)) as typeof window.fetch;
  installAuthenticatedFetch();
}

function record(url: string, init: RequestInit): FetchCall {
  const call: FetchCall = {
    url,
    method: init.method ?? "GET",
    authorization: new Headers(init.headers).get("Authorization"),
    body: typeof init.body === "string" ? init.body : null,
  };
  calls.push(call);
  return call;
}

const refreshCalls = () => calls.filter((call) => call.url.endsWith("/auth/refresh"));

beforeEach(() => {
  calls = [];
  localStorage.clear();
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("reînnoirea silențioasă a tokenului (#6)", () => {
  it("un 401 pe un request autentificat se reia o dată, cu tokenul nou", async () => {
    install(async (url, init) => {
      const call = record(url, init);
      if (url.endsWith("/auth/refresh")) return json({ token: "acces-nou", refreshToken: "refresh-2" });
      if (url.endsWith("/auth/me")) {
        return call.authorization === "Bearer acces-nou" ? json({ id: 1 }) : new Response("", { status: 401 });
      }
      return new Response("", { status: 404 });
    });
    localStorage.setItem(TOKEN_KEY, "acces-vechi");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");

    const response = await window.fetch(`${API_BASE}/auth/me`);

    expect(response.status).toBe(200);
    expect(refreshCalls()).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/auth/me")).map((call) => call.authorization)).toEqual([
      "Bearer acces-vechi",
      "Bearer acces-nou",
    ]);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("acces-nou");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-2");
  });

  it("două cereri care primesc 401 în același timp fac o singură rotire", async () => {
    install(async (url, init) => {
      const call = record(url, init);
      if (url.endsWith("/auth/refresh")) {
        // Rotirea e lentă, ca ambele cereri să apuce să ia 401 înainte de a fi salvat tokenul nou.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json({ token: "acces-nou", refreshToken: "refresh-2" });
      }
      return call.authorization === "Bearer acces-nou" ? json({ id: 1 }) : new Response("", { status: 401 });
    });
    localStorage.setItem(TOKEN_KEY, "acces-vechi");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");

    const [first, second] = await Promise.all([
      window.fetch(`${API_BASE}/activities`),
      window.fetch(`${API_BASE}/sessions`),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    // O singură rotire: a doua ar fi folosit un token deja rotit = reutilizare = lanț revocat.
    expect(refreshCalls()).toHaveLength(1);
  });

  it("rotirea refuzată încheie sesiunea: tokenurile se șterg și se anunță o singură dată", async () => {
    install(async (url, init) => {
      record(url, init);
      if (url.endsWith("/auth/refresh")) return new Response("", { status: 401 });
      return new Response("", { status: 401 });
    });
    localStorage.setItem(TOKEN_KEY, "acces-vechi");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
    const unauthorized = vi.fn<(event: Event) => void>();
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized);

    const response = await window.fetch(`${API_BASE}/activities`);

    expect(response.status).toBe(401);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    // Fără reîncercare: cu tokenul deja șters, a doua cerere ar fi plecat anonimă.
    expect(calls.filter((call) => call.url.endsWith("/activities"))).toHaveLength(1);
  });

  it("un eșec de rețea la rotire NU deconectează", async () => {
    install(async (url, init) => {
      record(url, init);
      if (url.endsWith("/auth/refresh")) return new Response("", { status: 503 });
      return new Response("", { status: 401 });
    });
    localStorage.setItem(TOKEN_KEY, "acces-vechi");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
    const unauthorized = vi.fn<(event: Event) => void>();
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized);

    const response = await window.fetch(`${API_BASE}/activities`);

    // Serverul e temporar indisponibil: sesiunea poate fi perfect validă, deci nu aruncăm omul afară.
    expect(response.status).toBe(401);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-1");
  });

  it("un 401 fără token (parolă greșită la login) nu atinge sesiunea", async () => {
    install(async (url, init) => {
      record(url, init);
      return new Response("", { status: 401 });
    });
    const unauthorized = vi.fn<(event: Event) => void>();
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized);

    const response = await window.fetch(`${API_BASE}/auth/login`, { method: "POST", body: "{}" });

    expect(response.status).toBe(401);
    expect(refreshCalls()).toHaveLength(0);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("un 401 chiar de la /auth/refresh nu pornește o a doua rotire", async () => {
    install(async (url, init) => {
      record(url, init);
      return new Response("", { status: 401 });
    });
    localStorage.setItem(TOKEN_KEY, "acces-vechi");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");

    const response = await window.fetch(`${API_BASE}/auth/refresh`, { method: "POST" });

    expect(response.status).toBe(401);
    expect(refreshCalls()).toHaveLength(1);
  });

  it("logout anunță serverul cu tokenul de refresh, fără să aștepte răspunsul", async () => {
    install(async (url, init) => {
      record(url, init);
      return json({ message: "ok" });
    });
    localStorage.setItem(TOKEN_KEY, "acces");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");

    revokeSessionOnServer();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const logout = calls.filter((call) => call.url.endsWith("/auth/logout"));
    expect(logout).toHaveLength(1);
    expect(logout[0]!.method).toBe("POST");
    expect(JSON.parse(logout[0]!.body!)).toEqual({ refreshToken: "refresh-1" });
  });

  it("freshAccessToken reînnoiește doar cînd tokenul e expirat sau aproape de expirare", async () => {
    install(async (url, init) => {
      record(url, init);
      if (url.endsWith("/auth/refresh")) return json({ token: "acces-nou", refreshToken: "refresh-2" });
      return json({});
    });

    // Încă valid (o oră): se folosește ca atare, fără nicio cerere.
    localStorage.setItem(TOKEN_KEY, fakeJwt(3600));
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
    expect(await freshAccessToken()).toBe(localStorage.getItem(TOKEN_KEY));
    expect(refreshCalls()).toHaveLength(0);

    // Expirat: hub-ul primește un token proaspăt, nu unul pe care serverul îl refuză.
    localStorage.setItem(TOKEN_KEY, fakeJwt(-60));
    expect(await freshAccessToken()).toBe("acces-nou");
    expect(refreshCalls()).toHaveLength(1);

    // Fără sesiune: nimic de predat.
    localStorage.clear();
    expect(await freshAccessToken()).toBeNull();
  });

  it("rotirea anunță store-ul prin eveniment, ca ref-ul de token să nu rămînă în urmă", async () => {
    install(async (url, init) => {
      record(url, init);
      if (url.endsWith("/auth/refresh")) return json({ token: "acces-nou", refreshToken: "refresh-2" });
      return json({});
    });
    localStorage.setItem(TOKEN_KEY, "acces-vechi");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
    const refreshed = vi.fn<(event: Event) => void>();
    window.addEventListener(TOKENS_REFRESHED_EVENT, refreshed);

    const outcome = await refreshAccessToken();

    expect(outcome).toEqual({ status: "refreshed", token: "acces-nou" });
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect((refreshed.mock.calls[0]![0] as CustomEvent).detail).toEqual({ token: "acces-nou" });
  });
});
