import { Capacitor } from "@capacitor/core";
import { Geolocation, type CallbackID, type Position } from "@capacitor/geolocation";
import type { GeoFix } from "./geoFix";

/**
 * Transportul de poziție: același flux (abonare → poziții), dar două implementări — exact tiparul de
 * la `heartRateTransport`, din aceleași motive: în browser GPS-ul vine din Web Geolocation, iar în
 * aplicația nativă din pluginul Capacitor, care în plus știe să țină sesiunea vie în fundal.
 *
 * Ecranul de hartă are nevoie doar de „unde ești acum": cere permisiunea, ia un fix și închide
 * abonarea. Urmărirea continuă (cea din TTR, cu filtrare și stare) se va construi peste același tipar.
 */

/** Cum a mers ultima cerere de permisiune. */
export type LocationPermission = "granted" | "denied" | "prompt" | "unsupported";

/** De ce n-a venit o poziție — ecranul spune utilizatorului ce poate face. */
export type LocationErrorKind = "denied" | "unavailable" | "timeout" | "unknown";

export interface LocationHandlers {
  onFix: (fix: GeoFix) => void;
  onError: (kind: LocationErrorKind) => void;
}

/** Opțiunile de urmărire, aceleași pe ambele platforme (unele au efect doar pe Android). */
export const LOCATION_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  // Sub 15 secunde un timeout prea scurt produce erori pe telefon în buzunar, la început de alergare.
  timeout: 15_000,
  maximumAge: 0,
  // Android: o poziție pe secundă, cadența la care se măsoară distanța la alergare.
  interval: 1000,
  minimumUpdateInterval: 1000,
} as const;

export interface LocationTransport {
  /** Mediul curent poate citi poziția? (browser fără geolocation → false) */
  isSupported(): boolean;
  /** Permisiunea curentă, fără a cere nimic utilizatorului. */
  checkPermission(): Promise<LocationPermission>;
  /** Cere permisiunea (în browser trebuie să fie în urma unui gest al utilizatorului). */
  requestPermission(): Promise<LocationPermission>;
  /** Pornește urmărirea; întoarce un id de abonament pentru `clearWatch`. */
  watch(handlers: LocationHandlers): Promise<number | string>;
  clearWatch(id: number | string): Promise<void>;
}

// ── Normalizarea pozițiilor ─────────────────────────────────────────────────

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Poziția pluginului Capacitor → fixul nostru normalizat. */
function fromCapacitorPosition(position: Position): GeoFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    altitudeM: finiteOrNull(position.coords.altitude),
    accuracyM: finiteOrNull(position.coords.accuracy),
    // Viteza negativă (raportată de unele platforme când nu se poate determina) nu e o viteză.
    speedMps: (() => {
      const speed = finiteOrNull(position.coords.speed);
      return speed !== null && speed >= 0 ? speed : null;
    })(),
    // Unele platforme dau secunde, altele milisecunde: sub anul 2001 în milisecunde, sigur e în secunde.
    timestampMs: position.timestamp < 1e12 ? position.timestamp * 1000 : position.timestamp,
  };
}

/** Poziția Web Geolocation → fixul nostru normalizat (aceeași formă, altă sursă). */
function fromWebPosition(position: GeolocationPosition): GeoFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    altitudeM: finiteOrNull(position.coords.altitude),
    accuracyM: finiteOrNull(position.coords.accuracy),
    speedMps: (() => {
      const speed = finiteOrNull(position.coords.speed);
      return speed !== null && speed >= 0 ? speed : null;
    })(),
    timestampMs: position.timestamp,
  };
}

/** Codul de eroare al browserului → motivul nostru. */
function webErrorKind(code: number): LocationErrorKind {
  switch (code) {
    case 1:
      return "denied";
    case 2:
      return "unavailable";
    case 3:
      return "timeout";
    default:
      return "unknown";
  }
}

// ── Web Geolocation (browser / PWA) ─────────────────────────────────────────

export function isWebGeolocationAvailable(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export class WebLocationTransport implements LocationTransport {
  isSupported(): boolean {
    return isWebGeolocationAvailable();
  }

  async checkPermission(): Promise<LocationPermission> {
    if (!this.isSupported()) return "unsupported";
    // `permissions.query` lipsește pe unele browsere (Safari vechi, WebView-uri): atunci nu putem
    // ști fără să cerem, deci raportăm „prompt" și lăsăm abonarea să declanșeze întrebarea.
    try {
      const status = await navigator.permissions?.query({ name: "geolocation" });
      if (!status) return "prompt";
      return status.state === "granted" ? "granted" : status.state === "denied" ? "denied" : "prompt";
    } catch {
      return "prompt";
    }
  }

  async requestPermission(): Promise<LocationPermission> {
    // Web-ul n-are o cerere separată: prima poziție cerută declanșează promptul browserului.
    return this.checkPermission();
  }

  async watch(handlers: LocationHandlers): Promise<number> {
    if (!this.isSupported()) {
      handlers.onError("unavailable");
      throw new Error("Geolocația nu este disponibilă în acest browser.");
    }
    return navigator.geolocation.watchPosition(
      (position) => handlers.onFix(fromWebPosition(position)),
      (error) => handlers.onError(webErrorKind(error.code)),
      { ...LOCATION_WATCH_OPTIONS },
    );
  }

  async clearWatch(id: number | string): Promise<void> {
    if (typeof id === "number") navigator.geolocation.clearWatch(id);
  }
}

// ── Capacitor (Android/iOS) ─────────────────────────────────────────────────

export class NativeLocationTransport implements LocationTransport {
  isSupported(): boolean {
    return true;
  }

  async checkPermission(): Promise<LocationPermission> {
    try {
      const status = await Geolocation.checkPermissions();
      return status.location === "granted"
        ? "granted"
        : status.location === "denied"
          ? "denied"
          : "prompt";
    } catch {
      // „Location services" oprite la nivel de sistem: nu e o permisiune refuzată, dar nici acordată.
      return "denied";
    }
  }

  async requestPermission(): Promise<LocationPermission> {
    try {
      const status = await Geolocation.requestPermissions({ permissions: ["location"] });
      return status.location === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  }

  async watch(handlers: LocationHandlers): Promise<CallbackID> {
    return Geolocation.watchPosition({ ...LOCATION_WATCH_OPTIONS }, (position, error) => {
      if (error) {
        handlers.onError("unavailable");
        return;
      }
      // Pluginul trimite `null` când nu are încă o poziție (ex. prima citire a eșuat): nu e o eroare
      // în sine, următoarea citire poate reuși.
      if (position) handlers.onFix(fromCapacitorPosition(position));
    });
  }

  async clearWatch(id: number | string): Promise<void> {
    await Geolocation.clearWatch({ id: String(id) }).catch(() => {});
  }
}

// ── Alegerea transportului ──────────────────────────────────────────────────

const nativeTransport = new NativeLocationTransport();
const webTransport = new WebLocationTransport();

/**
 * Aplicația nativă → pluginul Capacitor (care știe de permisiuni, de serviciul de fundal și de
 * economisirea bateriei). Browser cu geolocație → transportul web. Browser fără (foarte rar) →
 * rămâne cel nativ, care va raporta eroare, iar ecranul ascunde butonul după `isSupported()`.
 */
export function createLocationTransport(): LocationTransport {
  if (Capacitor.isNativePlatform()) return nativeTransport;
  if (isWebGeolocationAvailable()) return webTransport;
  return nativeTransport;
}

/** Poziția poate fi citită în mediul curent? */
export function isLocationSupported(): boolean {
  return Capacitor.isNativePlatform() || isWebGeolocationAvailable();
}
