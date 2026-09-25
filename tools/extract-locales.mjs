// Genereaza cataloagele aplicatiei de harta: extras din cataloagele TTR, doar secțiunile care
// conteaza aici. Ruleaza o singura data, la mutare; dupa aceea cataloagele se editeaza de mana.
//
//   node tools/extract-locales.mjs <cale-catre-frontend/src/locales> <cale-catre-destinatie/src/locales>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , SOURCE_DIR, TARGET_DIR] = process.argv;
if (!SOURCE_DIR || !TARGET_DIR) {
  console.error("Folosire: node extract-locales.mjs <locales sursa> <locales destinatie>");
  process.exit(1);
}

const LANGS = ["ro", "en", "fr"];

function load(lang) {
  const source = readFileSync(join(SOURCE_DIR, `${lang}.ts`), "utf8").replace(
    /export default/,
    "module.exports =",
  );
  return eval(`(function(){var module={exports:{}};${source};return module.exports;})()`);
}

/** Doar subarborele `map`, plus cheile de shell pe care le foloseste aplicatia noua. */
function pick(catalog) {
  const login = { ...catalog.login };
  // Ecranele de login din aplicatia de harta nu ofera Strava, deci nu ducem si textele alea.
  for (const key of Object.keys(login)) {
    if (key.toLowerCase().includes("strava")) delete login[key];
  }

  return {
    app: {
      title: catalog.nav.map,
      signedInAs: catalog.map.title,
    },
    common: catalog.common,
    login,
    map: catalog.map,
  };
}

function serialize(value, indent = 2) {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  const lines = Object.entries(value).map(([key, item]) => {
    const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    if (item !== null && typeof item === "object") {
      return `${inner}${safeKey}: ${serialize(item, indent + 2)},`;
    }
    return `${inner}${safeKey}: ${JSON.stringify(item)},`;
  });
  return `{\n${lines.join("\n")}\n${pad}}`;
}

mkdirSync(TARGET_DIR, { recursive: true });

for (const lang of LANGS) {
  const body = serialize(pick(load(lang)), 0);
  const header =
    `// Mesajele pentru limba \`${lang}\` ale aplicației de hartă.\n` +
    "//\n" +
    "// Extrase din catalogul TTR la mutarea hărții (2026-09-24): se păstrează doar secțiunile pe care\n" +
    "// ecranele de aici le folosesc (`map`, `login`, `common`). Restul rămîne în TTR — nu are rost să\n" +
    "// cărăm 3700 de linii de texte de antrenament într-o aplicație care nu le afișează niciodată.\n" +
    "// De aici înainte fișierul se editează de mînă.\n\n";

  writeFileSync(join(TARGET_DIR, `${lang}.ts`), `${header}export default ${body};\n`, "utf8");
  console.log(`scris ${lang}.ts`);
}
