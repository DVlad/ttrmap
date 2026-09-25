<template>
  <label class="relative flex h-9 items-center rounded-lg bg-gray-800 border border-gray-700">
    <span class="sr-only">{{ t("common.selectLanguage") }}</span>
    <select
      :value="locale"
      :aria-label="t('common.selectLanguage')"
      class="h-full appearance-none cursor-pointer bg-transparent text-xs font-semibold uppercase text-gray-200 pl-3 pr-8 outline-none [color-scheme:dark] focus:ring-2 focus:ring-orange-500/60"
      @change="changeLocale"
    >
      <option
        v-for="localeOption in SUPPORTED_LOCALES"
        :key="localeOption"
        :value="localeOption"
        class="bg-gray-900 text-white"
      >
        {{ localeOption }}
      </option>
    </select>
    <span class="pointer-events-none absolute right-2 text-xs text-gray-400">▾</span>
  </label>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, setLocale, type SupportedLocale } from '@/i18n'

const { locale, t } = useI18n()

/**
 * Comută limba: întâi se descarcă chunk-ul limbii, apoi se schimbă `locale` — altfel, pentru o
 * clipă, ecranul ar arăta chei de traducere în loc de texte.
 */
const changeLocale = async (event: Event) => {
  const next = (event.target as HTMLSelectElement).value as SupportedLocale
  if (next === locale.value) return

  await setLocale(next)
  localStorage.setItem(LOCALE_STORAGE_KEY, next)
}
</script>
