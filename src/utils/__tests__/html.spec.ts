import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/utils/html";

/**
 * Escape-ul pentru popup-urile de hartă. Testele sînt pe atacuri, nu pe caractere: ce contează e că
 * un nume editat în OpenStreetMap nu poate ieși din atribut sau din text.
 */
describe("escapeHtml", () => {
  it("neutralizează un tag injectat printr-un nume", () => {
    const escaped = escapeHtml('<img src=x onerror="alert(1)">');

    expect(escaped).not.toContain("<img");
    expect(escaped).toContain("&lt;img");
    expect(escaped).not.toContain('"');
  });

  it("escapatorează și ghilimelele simple, dacă textul ajunge într-un atribut", () => {
    expect(escapeHtml("' onmouseover='alert(1)")).not.toContain("'");
  });

  it("nu dublează escape-ul unui ampersand deja scris corect", () => {
    // `&` se escapează primul, altfel un `&lt;` intrat în funcție ar ieși `&amp;lt;`.
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("lasă textul obișnuit neatins", () => {
    expect(escapeHtml("Cabana Bîlea — 1 234 m")).toBe("Cabana Bîlea — 1 234 m");
  });
});
