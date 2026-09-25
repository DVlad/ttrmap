import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginOxlint from 'eslint-plugin-oxlint'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  // `android/` conține output-ul de build Capacitor (inclusiv JS generat, ex. native-bridge.js):
  // fără regula asta, lint-ul raporta probleme din fișiere pe care nu le scrie nimeni de mână.
  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', '**/android/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    // Fără extensie, pattern-ul nu se potrivea cu niciun fișier de test (nici măcar cu `*.spec.ts`),
    // deci regulile de vitest nu rulau deloc în eslint — `oxlint` le prinde, dar poarta din CI e dublă.
    files: ['src/**/__tests__/**/*.{ts,mts,tsx}'],
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),
)
