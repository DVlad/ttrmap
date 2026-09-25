<template>
  <div class="flex h-full items-center justify-center overflow-y-auto bg-gray-950 px-4 py-8">
    <div class="w-full max-w-sm space-y-4">
      <div class="text-center">
        <img src="/pwa-512x512.png" alt="" class="mx-auto h-14 w-14 rounded-xl" >
        <h1 class="mt-3 text-lg font-semibold text-white">{{ t("app.title") }}</h1>
        <p class="mt-1 text-xs text-gray-500">
          {{ registering ? t("login.register") : t("login.title") }}
        </p>
      </div>

      <form class="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4" @submit.prevent="submit">
        <label v-if="registering" class="block space-y-1">
          <span class="text-xs text-gray-400">{{ t("login.name") }}</span>
          <input
            v-model="name"
            type="text"
            autocomplete="name"
            :placeholder="t('login.namePlaceholder')"
            class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
          >
        </label>

        <label class="block space-y-1">
          <span class="text-xs text-gray-400">{{ t("login.email") }}</span>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            :placeholder="t('login.emailPlaceholder')"
            class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
          >
        </label>

        <label class="block space-y-1">
          <span class="text-xs text-gray-400">{{ t("login.password") }}</span>
          <input
            v-model="password"
            type="password"
            required
            :autocomplete="registering ? 'new-password' : 'current-password'"
            class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
          >
        </label>

        <!-- Eșecul se spune. Un formular care nu face nimic la submit e mai rău decît un mesaj urît. -->
        <p
          v-if="errorMessage"
          class="rounded-lg bg-red-950/60 px-2 py-1.5 text-xs leading-snug text-red-300"
        >
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          :disabled="authStore.loading"
          class="w-full rounded-lg bg-orange-600 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-500 disabled:opacity-50"
        >
          {{
            authStore.loading
              ? t("login.processing")
              : registering
                ? t("login.registerSubmit")
                : t("login.submit")
          }}
        </button>
      </form>

      <div class="flex items-center justify-between text-xs">
        <button
          type="button"
          class="text-gray-400 underline-offset-2 transition-colors hover:text-gray-200 hover:underline"
          @click="toggleMode"
        >
          {{ registering ? t("login.loginButton") : t("login.registerButton") }}
        </button>
        <LanguageSelector />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import LanguageSelector from "@/components/LanguageSelector.vue";
import { useAuthStore } from "@/stores/auth";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const registering = ref(false);
const name = ref("");
const email = ref("");
const password = ref("");

/** Mesajul de eroare local sau cel venit de la server — un singur loc care spune ce n-a mers. */
const errorMessage = computed(() => authStore.error);

function toggleMode() {
  registering.value = !registering.value;
  authStore.error = null;
}

async function submit() {
  // Parola minimă e verificată și pe server; aici doar evităm un drum degeaba.
  if (registering.value && password.value.length < 8) {
    authStore.error = t("login.passwordTooShort");
    return;
  }

  const ok = registering.value
    ? await authStore.register(email.value, password.value, name.value)
    : await authStore.login(email.value, password.value);

  if (!ok) return;

  const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/map";
  await router.replace(redirect);
}
</script>
