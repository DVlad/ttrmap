<template>
  <div class="flex h-full flex-col bg-gray-950">
    <!-- Bara de sus apare doar cînd ești autentificat: pe ecranul de login n-are ce căuta, iar
         „Ieși din cont" acolo ar fi o buton de ieșire din nimic. -->
    <header
      v-if="authStore.isLoggedIn"
      class="flex shrink-0 items-center justify-between gap-3 border-b border-gray-800 bg-gray-900 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <div class="flex min-w-0 items-center gap-2">
        <img src="/pwa-192x192.png" alt="" class="h-7 w-7 rounded-md" >
        <span class="truncate text-sm font-semibold text-white">{{ t("app.title") }}</span>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <LanguageSelector />
        <span class="hidden text-xs text-gray-400 sm:inline">
          {{ t("app.signedInAs") }} {{ authStore.user?.email }}
        </span>
        <button
          type="button"
          class="rounded-lg border border-gray-700 px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-800"
          @click="signOut"
        >
          {{ t("app.signOut") }}
        </button>
      </div>
    </header>

    <main class="min-h-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import LanguageSelector from "@/components/LanguageSelector.vue";
import { useAuthStore } from "@/stores/auth";

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();

/**
 * Ieșirea din cont șterge și sesiunea, și datele ținute pentru contul respectiv (`endUserSession`),
 * apoi duce la ecranul de autentificare. Se șterg intenționat: pe un telefon folosit de altcineva,
 * traseele offline ale contului precedent n-au ce căuta.
 */
function signOut() {
  authStore.logout();
  void router.replace({ name: "login" });
}
</script>
