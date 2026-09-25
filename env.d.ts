/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** API-ul de cont și trasee (TTR). */
  readonly VITE_API_BASE?: string;
  /** API-ul de hartă (serviciul din repo-ul acesta). */
  readonly VITE_MAP_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}