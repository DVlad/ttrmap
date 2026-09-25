/**
 * Datele persistate **per cont** (localStorage / sessionStorage).
 *
 * Înainte, cheile erau globale (`ttr_workouts`, `ttr_training_plans`, `ttr_sync_queue`,
 * `ttr:workout:session`, `strava:lastSearch`), iar logout-ul ștergea doar cheile de auth și Strava.
 * Pe același browser, contul următor găsea acolo cache-ul celui precedent și — mai rău — putea
 * **rejuca scrierile rămase în coadă** în numele lui. Acum fiecare cheie de cont e namespace-uită
 * după `userId` (`ttr_u<id>_<nume>`), iar cine deține datele e ținut minte în `ttr_account_id`.
 *
 * Regulile de viață ale datelor:
 * - **logout explicit** (`endUserSession`): se șterg toate namespace-urile și se uită proprietarul —
 *   browserul poate ajunge la altcineva;
 * - **login** (`beginAccountSession`): dacă se autentifică *alt* cont decât cel care deține datele,
 *   acestea se șterg; dacă e același cont, rămân — un token expirat în timpul unui antrenament nu
 *   trebuie să piardă sesiunea și scrierile offline, care se trimit după reautentificare
 *   (vezi `main.ts`, handler-ul de 401);
 * - **sesiune expirată**: nu se șterge nimic (proprietarul rămâne cunoscut), deci datele se regăsesc
 *   la următoarea autentificare cu același cont.
 *
 * Cheile care țin **preferințe de dispozitiv** (limbă, temă, bannerul de instalare, ultimul
 * dispozitiv BLE) rămân intenționat globale: nu aparțin unui cont. Cache-ul OSM din `MapExplorer`
 * rămâne și el global — sunt date publice OpenStreetMap, partajate între utilizatori.
 */

/**
 * Cheia în care store-ul de auth scrie utilizatorul curent. E sursa pentru `currentUserId`, ca
 * helperele de storage să nu depindă de Pinia (coada de sync își încarcă starea la import, înainte
 * ca vreun store să fie activ).
 */
export const AUTH_USER_STORAGE_KEY = "ttr_auth_user";

/** Contul căruia îi aparțin datele persistate acum (supraviețuiește expirării sesiunii). */
export const ACCOUNT_ID_STORAGE_KEY = "ttr_account_id";

/**
 * Contul care și-a păstrat coada de sync la logout (#41), în timp ce restul datelor s-au șters.
 *
 * Fără el, `beginAccountSession` n-ar avea de unde să știe că namespace-ul rămas pe disc aparține
 * exact contului care se autentifică acum (proprietarul general a fost uitat intenționat la logout).
 */
export const PRESERVED_QUEUE_OWNER_KEY = "ttr_preserved_queue_owner";

/** Numele cheilor de cont. Prefixul `ttr_u<userId>_` se adaugă în `userStorageKey`. */
export type UserStorageName =
  | "workouts"
  | "training_plans"
  | "sync_queue"
  | "workout_session"
  | "workout_result"
  | "ride_session"
  | "run_session"
  | "rejected_sessions"
  | "acwr_red_threshold"
  | "strava_last_search";

/** Cheile dinainte de namespacing — șterse și ele, altfel rămân date orfane ale unui cont vechi. */
const LEGACY_KEYS: Record<UserStorageName, string> = {
  workouts: "ttr_workouts",
  training_plans: "ttr_training_plans",
  sync_queue: "ttr_sync_queue",
  workout_session: "ttr:workout:session",
  workout_result: "ttr:workout:lastResult",
  ride_session: "ttr:ride:session",
  run_session: "ttr:run:session",
  rejected_sessions: "ttr:sessions:rejected",
  acwr_red_threshold: "acwr-red-threshold",
  strava_last_search: "strava:lastSearch",
};

const NAMESPACE_PREFIX = "ttr_u";
/** `ttr_u<userId>_<nume>` — userId e numeric, deci nu se poate confunda cu alte chei `ttr_*`. */
const NAMESPACE_PATTERN = /^ttr_u\d+_/;
const LEGACY_KEY_SET = new Set<string>(Object.values(LEGACY_KEYS));

/** Utilizatorul logat acum, citit direct din storage (0 = niciunul / necunoscut). */
export function currentUserId(): number {
  return readUserId(AUTH_USER_STORAGE_KEY);
}

/** Contul care deține datele persistate acum (0 = niciunul cunoscut). */
export function accountStorageId(): number {
  return readUserId(ACCOUNT_ID_STORAGE_KEY);
}

/**
 * Cheia de storage a unui cont pentru un nume de mai sus.
 *
 * `name` acceptă și chei care nu sunt în `UserStorageName` (ex. starea per plan, ca corecturile de
 * aderență): prefixul de cont e ce contează, iar lista de mai sus rămâne doar catalogul cheilor
 * partajate cunoscute.
 */
export function userStorageKey(
  name: UserStorageName | (string & {}),
  userId: number = accountStorageId(),
): string {
  return `${NAMESPACE_PREFIX}${userId}_${name}`;
}

type AccountChangeListener = (context: AccountChangeContext) => void;
const listeners = new Set<AccountChangeListener>();

export interface AccountChangeContext {
  /**
   * Contul precedent și-a păstrat operațiile nesincronizate (logout cu „păstrează"): cine reacționează
   * la schimbarea de cont **nu** are voie să golească acea zonă de pe disc (vezi #41).
   */
  keepOperations: boolean;
}

/**
 * Înregistrează o reacție la schimbarea contului (store-urile și coada de sync își reiau starea din
 * memorie). Întoarce funcția de anulare, ca `onScopeDispose` să poată curăța listener-ul.
 */
export function onAccountChange(listener: AccountChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Leagă storage-ul de contul care tocmai s-a autentificat. Dacă e alt cont decât cel care deținea
 * datele, acestea se șterg (nu au ce căuta la utilizatorul nou) și stările din memorie se reiau.
 *
 * Excepție: contul care și-a păstrat coada de sync la logout (#41) o regăsește la reautentificare —
 * aceea e chiar promisiunea făcută în dialogul de logout. Orice alt cont o șterge.
 */
export function beginAccountSession(userId: number): void {
  if (accountStorageId() === userId) return;

  const preservedOwner = preservedQueueOwner();
  const keepPreservedQueue = preservedOwner === userId;
  // Alt cont (sau niciunul cunoscut): ce a rămas de la precedentul nu se moștenește.
  clearUserScopedStorage(keepPreservedQueue ? [userStorageKey("sync_queue", userId)] : []);
  clearPreservedQueueOwner();
  writeUserId(ACCOUNT_ID_STORAGE_KEY, userId);
  notifyAccountChange({ keepOperations: keepPreservedQueue });
}

/**
 * Încheie sesiunea la cererea utilizatorului (butonul de logout): șterge datele persistate ale
 * tuturor conturilor trecute prin browserul ăsta și anunță stările din memorie să le reia.
 * Expirarea sesiunii **nu** trece pe aici — vezi `beginAccountSession`.
 *
 * `keepUnsyncedOperations` (ales explicit de utilizator, #41): coada de sync a contului curent rămâne
 * pe disc, în namespace-ul lui, până la următoarea autentificare. Un alt cont care se autentifică
 * între timp o șterge oricum (`beginAccountSession`), deci pe un browser partajat nu rămâne nimic
 * vizibil pentru altcineva.
 */
export function endUserSession(options: { keepUnsyncedOperations?: boolean } = {}): void {
  const keepUnsyncedOperations = options.keepUnsyncedOperations === true;
  const queueOwner = accountStorageId();
  clearUserScopedStorage(
    keepUnsyncedOperations ? [userStorageKey("sync_queue")] : [],
  );
  try {
    localStorage.removeItem(ACCOUNT_ID_STORAGE_KEY);
    if (keepUnsyncedOperations && queueOwner > 0) {
      localStorage.setItem(PRESERVED_QUEUE_OWNER_KEY, String(queueOwner));
    } else {
      localStorage.removeItem(PRESERVED_QUEUE_OWNER_KEY);
    }
  } catch {
    // storage indisponibil — nu rămâne nimic de curățat
  }
  notifyAccountChange({ keepOperations: keepUnsyncedOperations });
}

/** Contul cu coadă de sync păstrată după logout, sau 0. Se consumă la prima autentificare. */
function preservedQueueOwner(): number {
  try {
    const raw = localStorage.getItem(PRESERVED_QUEUE_OWNER_KEY);
    if (!raw || !/^\d+$/.test(raw)) return 0;
    return Number(raw);
  } catch {
    return 0;
  }
}

function clearPreservedQueueOwner(): void {
  try {
    localStorage.removeItem(PRESERVED_QUEUE_OWNER_KEY);
  } catch {
    // storage indisponibil
  }
}

function notifyAccountChange(context: AccountChangeContext): void {
  for (const listener of listeners) listener(context);
}

/** Șterge toate cheile de cont: orice namespace `ttr_u<id>_*` și cheile vechi, nenumite. */
export function clearUserScopedStorage(keepKeys: string[] = []): void {
  const keep = new Set(keepKeys);
  for (const storage of storages()) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null) keys.push(key);
      }
      for (const key of keys) {
        if (keep.has(key)) continue;
        if (NAMESPACE_PATTERN.test(key) || LEGACY_KEY_SET.has(key)) {
          storage.removeItem(key);
        }
      }
    } catch {
      // storage indisponibil (mod privat, WebView restrictiv) — nimic de șters
    }
  }
}

function readUserId(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    // `ttr_account_id` e un număr simplu; `ttr_auth_user` e obiectul contului.
    if (/^\d+$/.test(raw)) return Number(raw);
    const id = (JSON.parse(raw) as { id?: unknown } | null)?.id;
    return typeof id === "number" && Number.isFinite(id) ? id : 0;
  } catch {
    return 0;
  }
}

function writeUserId(key: string, userId: number): void {
  try {
    localStorage.setItem(key, String(userId));
  } catch {
    // storage indisponibil — datele rămân în namespace-ul 0, adică neasociate unui cont
  }
}

function storages(): Storage[] {
  const found: Storage[] = [];
  try {
    if (typeof localStorage !== "undefined") found.push(localStorage);
  } catch {
    // accesul la localStorage poate arunca în browsere cu cookie-urile blocate
  }
  try {
    if (typeof sessionStorage !== "undefined") found.push(sessionStorage);
  } catch {
    // idem
  }
  return found;
}
