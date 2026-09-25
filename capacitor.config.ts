import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Configurația aplicației native.
 *
 * `appId` e **altul** decît al TTR (`com.ttr.app`): sînt două aplicații distincte, care se instalează
 * amîndouă pe același telefon. Două aplicații cu același `appId` nu pot coexista — a doua instalare ar
 * suprascrie-o pe prima.
 *
 * Folderul `android/` **nu e generat aici**: se creează cu `npx cap add android` pe mașina care are
 * Android SDK, iar pînă atunci aplicația merge ca PWA. Pașii sînt în `README.md`.
 */
const config: CapacitorConfig = {
  appId: "com.ttr.map",
  appName: "TTR Hartă",
  webDir: "dist",
};

export default config;
