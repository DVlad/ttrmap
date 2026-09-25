import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

/**
 * Rutele aplicației de hartă.
 *
 * Ecranul de hartă se încarcă **leneș** (`import()`): are MapLibre în el, iar ecranul de autentificare
 * trebuie să apară instant, chiar pe o legătură proastă de munte — exact locul unde se folosește
 * aplicația asta.
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      redirect: "/map",
    },
    {
      path: "/map",
      name: "map",
      component: () => import("@/views/MapView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
    },
    {
      // Orice altă cale duce la hartă: aplicația are un singur ecran, iar un 404 ar fi o fundătură.
      path: "/:pathMatch(.*)*",
      redirect: "/map",
    },
  ],
});

router.beforeEach((to) => {
  if (!to.meta.requiresAuth) return true;

  const authStore = useAuthStore();
  if (authStore.isLoggedIn) return true;

  return { name: "login", query: { redirect: to.fullPath } };
});

export default router;
