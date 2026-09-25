// Base URL for the backend API. Overridable via VITE_API_BASE (set at build time per
// environment); defaults to the local ASP.NET Core dev server port.
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:5177/api";

export const TOKEN_KEY = "ttr_auth_token";
/** Tokenul de refresh: opac, lung, rotit la fiecare folosire (#6). */
export const REFRESH_TOKEN_KEY = "ttr_auth_refresh_token";
export const USER_KEY = "ttr_auth_user";

/** Emis după o rotire reușită, ca store-ul să-și țină ref-ul de token la zi. */
export const TOKENS_REFRESHED_EVENT = "ttr:tokens-refreshed";
/** Emis cînd sesiunea s-a terminat definitiv (refresh refuzat de server). */
export const UNAUTHORIZED_EVENT = "ttr:unauthorized";

export function getAccessToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function getRefreshToken(): string | null {
	try {
		return localStorage.getItem(REFRESH_TOKEN_KEY);
	} catch {
		return null;
	}
}

/** Salvează perechea. `refreshToken` null șterge tokenul de refresh (nu-l lasă pe cel vechi). */
export function saveTokens(accessToken: string, refreshToken: string | null): void {
	try {
		localStorage.setItem(TOKEN_KEY, accessToken);
		if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
		else localStorage.removeItem(REFRESH_TOKEN_KEY);
	} catch {
		// localStorage indisponibil (mod privat): sesiunea trăiește cît pagina, ca înainte.
	}
}

export function clearTokens(): void {
	try {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(REFRESH_TOKEN_KEY);
	} catch {
		// nimic de făcut
	}
}

/** Rezultatul unei încercări de reînnoire — cele trei cazuri se tratează diferit de apelant. */
export type RefreshOutcome =
	| { status: "refreshed"; token: string }
	/** Serverul a refuzat tokenul: sesiunea s-a terminat, clientul iese la login. */
	| { status: "expired" }
	/** N-am putut întreba serverul (rețea, 5xx): sesiunea poate fi validă, deci NU deconectăm. */
	| { status: "unavailable" };

/** `fetch`-ul original, capturat înainte să-l înlocuim — refresh-ul nu trebuie să treacă prin wrapper. */
let nativeFetch: typeof window.fetch | null = null;

function plainFetch(): typeof window.fetch {
	return nativeFetch ?? window.fetch.bind(window);
}

/**
 * Reînnoiește tokenul de acces, **o singură dată** chiar dacă mai multe cereri primesc 401 în același
 * moment.
 *
 * De ce single-flight, nu „fiecare 401 își cere tokenul": refresh token-ul se **rotește**, deci două
 * cereri paralele ar folosi același token, iar a doua ar fi tratată ca reutilizare — adică exact
 * mecanismul care revocă lanțul întreg. Un singur zbor, restul cererilor așteaptă același rezultat.
 */
let inFlightRefresh: Promise<RefreshOutcome> | null = null;

export function refreshAccessToken(): Promise<RefreshOutcome> {
	if (inFlightRefresh) return inFlightRefresh;

	inFlightRefresh = runRefresh().finally(() => {
		inFlightRefresh = null;
	});
	return inFlightRefresh;
}

async function runRefresh(): Promise<RefreshOutcome> {
	const refreshToken = getRefreshToken();
	// Fără token de refresh nu e nimic de reînnoit: pentru un client care nu s-a autentificat niciodată
	// (sau după logout) asta nu e o sesiune expirată, dar nici o reușită.
	if (!refreshToken) return { status: "expired" };

	let response: Response;
	try {
		response = await plainFetch()(`${API_BASE}/auth/refresh`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refreshToken }),
			credentials: "include",
		});
	} catch {
		return { status: "unavailable" };
	}

	if (response.status === 401 || response.status === 400) {
		// Refuz explicit: token revocat, expirat sau reutilizat (lanțul a fost închis pe server).
		clearTokens();
		return { status: "expired" };
	}
	if (!response.ok) return { status: "unavailable" };

	let data: { token?: string; refreshToken?: string };
	try {
		data = (await response.json()) as { token?: string; refreshToken?: string };
	} catch {
		return { status: "unavailable" };
	}
	if (!data.token || !data.refreshToken) {
		clearTokens();
		return { status: "expired" };
	}

	saveTokens(data.token, data.refreshToken);
	window.dispatchEvent(new CustomEvent(TOKENS_REFRESHED_EVENT, { detail: { token: data.token } }));
	return { status: "refreshed", token: data.token };
}

/**
 * Anunță serverul că sesiunea se încheie (revocă lanțul de refresh token-uri al acestui dispozitiv).
 *
 * Best-effort și fără așteptare: un logout nu are voie să depindă de rețea. `keepalive` lasă cererea
 * să se termine chiar dacă utilizatorul pleacă imediat de pe pagină (sau se închide WebView-ul).
 */
export function revokeSessionOnServer(): void {
	const refreshToken = getRefreshToken();
	if (!refreshToken) return;

	try {
		void plainFetch()(`${API_BASE}/auth/logout`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refreshToken }),
			credentials: "include",
			keepalive: true,
		}).catch(() => {
			// Fără rețea rămîne tokenul valid pînă expiră; la următorul login se emite alt lanț.
		});
	} catch {
		// Idem.
	}
}

export function installAuthenticatedFetch() {
	nativeFetch = window.fetch.bind(window);

	window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const requestUrl = new URL(
			typeof input === "string" || input instanceof URL ? input.toString() : input.url,
			window.location.origin,
		);
		const apiUrl = new URL(API_BASE, window.location.origin);
		const isApiRequest = requestUrl.origin === apiUrl.origin && requestUrl.pathname.startsWith(apiUrl.pathname);

		// Citit o singură dată: e folosit și pentru antet, și ca să știm dacă un 401 are ce deconecta.
		const token = getAccessToken();

		const send = (bearer: string | null) => {
			const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
			if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
			// `credentials: "include"` **doar** pentru API-ul nostru. Trimis către un terț, rupe cererea:
			// un furnizor care răspunde cu `Access-Control-Allow-Origin: *` (cum face sursa de tile-uri
			// OpenFreeMap) este respins de browser dacă cererea poartă credențiale — iar harta rămîne
			// goală, cu o eroare de CORS care nu are nicio legătură aparentă cu noi.
			//
			// Defectul era latent: hărțile vechi (Leaflet) încărcau tile-urile prin `<img>`, care nu
			// trece prin `fetch`, deci nu se vedea. MapLibre cere stilul și tile-urile prin `fetch`.
			const credentials = init.credentials ?? (isApiRequest ? "include" : "same-origin");
			return plainFetch()(input, { ...init, headers, credentials });
		};

		let response = await send(isApiRequest ? token : null);

		// Doar un 401 pe un request autentificat înseamnă „sesiunea a murit". Un 401 de la
		// /auth/login (parolă greșită) nu are ce să deconecteze — înainte declanșa logout și redirect.
		if (response.status === 401 && token && isApiRequest && !isRefreshRequest(requestUrl)) {
			const outcome = await refreshAccessToken();
			if (outcome.status === "refreshed") {
				// Reîncercare **o singură dată**, cu tokenul nou. Corpul cererii se reia de la capăt:
				// clienții trimit JSON sau FormData, ambele re-citibile (un stream consumat ar arunca,
				// dar aplicația nu trimite așa ceva).
				response = await send(outcome.token);
			}

			// Serverul a refuzat reînnoirea: sesiunea s-a terminat. Dacă refresh-ul n-a putut fi
			// întrebat (rețea/5xx), nu deconectăm — 401-ul rămîne vizibil apelantului, dar sesiunea
			// se poate relua cînd revine serverul.
			if (response.status === 401 && outcome.status !== "unavailable") {
				clearTokens();
				localStorage.removeItem(USER_KEY);
				window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
			}
		}

		return response;
	};
}

function isRefreshRequest(url: URL): boolean {
	return url.pathname.endsWith("/auth/refresh");
}

/** `exp` din JWT, în secunde (0 dacă tokenul e ilizibil sau nu are claim-ul). Doar citire locală. */
function accessTokenExpiresAt(token: string): number {
	try {
		const payload = token.split(".")[1];
		if (!payload) return 0;
		// base64url fără padding (cum vine într-un JWT): `atob` cere lungime multiplu de 4.
		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
		const parsed = JSON.parse(atob(padded)) as { exp?: number };
		return typeof parsed.exp === "number" ? parsed.exp : 0;
	} catch {
		return 0;
	}
}

/**
 * Token de acces proaspăt pentru conexiunile care **nu** trec prin `fetch`-ul autentificat: hub-urile
 * SignalR își fac singure handshake-ul, deci nu beneficiază de reînnoirea automată pe 401.
 *
 * Contează de la tokenul de acces scurt (#6): înainte, un token de 72h acoperea orice sesiune, iar
 * acum o ieșire de grup de două ore ar pierde telemetria live după prima jumătate de oră. Fabricile
 * sînt chemate de SignalR la fiecare tentativă (inclusiv la reconectare), deci aici se reînnoiește
 * **înainte** de a preda un token expirat.
 */
export async function freshAccessToken(): Promise<string | null> {
	const token = getAccessToken();
	const now = Math.floor(Date.now() / 1000);
	if (token && accessTokenExpiresAt(token) > now + 60) return token;

	const outcome = await refreshAccessToken();
	if (outcome.status === "refreshed") return outcome.token;

	// „unavailable" (rețea/5xx): mergem cu ce avem — hub-ul va refuza, iar ecranul are deja o stare
	// pentru asta. „expired" fără token nou înseamnă sesiune încheiată, deci null.
	return outcome.status === "unavailable" ? token : null;
}
