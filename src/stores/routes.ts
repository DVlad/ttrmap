import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { parseGpx, type GpxRoute } from "@/services/gpx/GpxParser";
import { deleteRouteApi, fetchRoutes, renameRouteApi, saveRoute } from "@/services/api/routesApi";

/**
 * Traseele salvate — „Rutele mele" din ecranul de hartă.
 *
 * <p>
 * **De ce o copie și nu store-ul din TTR.** Acolo store-ul de trasee e și motorul de simulare a unei
 * ture: punctul curent, `seekToDistance`, legătura cu trainerul antrenamentului, trasee împrumutate
 * de la o sesiune de grup. Aplicației de hartă nu-i trebuie niciuna dintre ele — îi trebuie lista,
 * salvarea unui traseu planificat, redenumirea și ștergerea.
 * </p>
 *
 * <p>
 * Regula de onestitate rămîne cea din TTR, fiindcă e cea care a costat: **eșecul se întoarce
 * apelantului**, nu se înghite într-un `catch` gol. Un traseu care pare salvat și dispare la
 * următoarea încărcare e mai rău decît un mesaj de eroare.
 * </p>
 */
export const useRoutesStore = defineStore("routes", () => {
  const routes = ref<GpxRoute[]>([]);
  const isLoading = ref(false);
  const isSyncing = ref(false);
  const loadError = ref<string | null>(null);

  const count = computed(() => routes.value.length);

  /** Încarcă traseele contului. Eșecul **nu** aruncă: ecranul trebuie să pornească și offline. */
  async function loadFromDb(): Promise<void> {
    isLoading.value = true;
    loadError.value = null;
    try {
      routes.value = await fetchRoutes();
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : "Server indisponibil";
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Pune traseul în listă imediat (ecranul nu așteaptă serverul) și îl salvează în fundal.
   * Întoarce `true` doar dacă serverul l-a primit — `false` înseamnă „salvat doar local".
   */
  async function addRouteObject(route: GpxRoute): Promise<boolean> {
    routes.value.push(route);
    const index = routes.value.length - 1;

    isSyncing.value = true;
    try {
      routes.value[index] = await saveRoute(route);
      return true;
    } catch {
      // Offline: traseul rămîne în memorie, fără id — cine l-a cerut decide ce afișează.
      return false;
    } finally {
      isSyncing.value = false;
    }
  }

  /** Adaugă dintr-un fișier GPX. Aceeași cale ca planificatorul, ca traseul să apară în listă. */
  async function addRoute(xmlString: string, fileName?: string): Promise<boolean> {
    const route = parseGpx(xmlString);
    if (fileName) route.name = fileName;
    return addRouteObject(route);
  }

  /** Redenumire; numele **revine** la cel vechi dacă serverul refuză. */
  async function renameRoute(index: number, newName: string): Promise<boolean> {
    const route = routes.value[index];
    if (!route) return false;

    const trimmed = newName.trim();
    if (!trimmed) return false;

    const previousName = route.name;
    route.name = trimmed;
    if (route.id === undefined) return true;

    try {
      await renameRouteApi(route.id, trimmed);
      return true;
    } catch {
      route.name = previousName;
      return false;
    }
  }

  /** Ștergere din listă **și** de pe server. `false` = rîndul rămîne pe loc, iar ecranul spune de ce. */
  async function removeRoute(index: number): Promise<boolean> {
    const route = routes.value[index];
    if (!route) return false;

    if (route.id !== undefined) {
      try {
        await deleteRouteApi(route.id);
      } catch {
        return false;
      }
    }

    routes.value.splice(index, 1);
    return true;
  }

  function clear() {
    routes.value = [];
  }

  return {
    routes,
    count,
    isLoading,
    isSyncing,
    loadError,
    loadFromDb,
    addRoute,
    addRouteObject,
    renameRoute,
    removeRoute,
    clear,
  };
});
