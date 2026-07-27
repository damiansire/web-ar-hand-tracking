import { describe, it, expect } from "vitest";
import {
  PerfGovernor,
  QUALITY_TIERS,
  initialTierIndex,
  COOLDOWN,
  DOWN_FRAMES,
} from "./perf-governor";

/** Alimenta N frames a un FPS dado y devuelve cuántas veces cambió el tier. */
function feed(g: PerfGovernor, fps: number, frames: number): number {
  const dt = 1 / fps;
  let changes = 0;
  for (let i = 0; i < frames; i++) if (g.sample(dt)) changes++;
  return changes;
}

describe("initialTierIndex", () => {
  it("móvil arranca en calidad baja (índice 2)", () => {
    expect(initialTierIndex({ mobile: true, cores: 8, hasWebGPU: true })).toBe(2);
  });
  it("desktop con WebGPU arranca en alta (índice 0)", () => {
    expect(initialTierIndex({ mobile: false, cores: 12, hasWebGPU: true })).toBe(0);
  });
  it("sin WebGPU y pocos núcleos arranca en media (índice 1)", () => {
    expect(initialTierIndex({ mobile: false, cores: 4, hasWebGPU: false })).toBe(1);
  });
});

describe("QUALITY_TIERS", () => {
  it("están ordenados de mayor a menor costo (pixelRatio y partículas decrecen)", () => {
    for (let i = 1; i < QUALITY_TIERS.length; i++) {
      expect(QUALITY_TIERS[i].pixelRatioCap).toBeLessThanOrEqual(
        QUALITY_TIERS[i - 1].pixelRatioCap,
      );
      expect(QUALITY_TIERS[i].particleScale).toBeLessThanOrEqual(
        QUALITY_TIERS[i - 1].particleScale,
      );
    }
  });
});

describe("PerfGovernor", () => {
  it("baja de tier cuando el FPS se sostiene bajo", () => {
    const g = new PerfGovernor(0);
    expect(g.index).toBe(0);
    const changes = feed(g, 25, 200); // FPS pésimo sostenido
    expect(changes).toBeGreaterThan(0);
    expect(g.index).toBeGreaterThan(0);
  });

  it("NO baja si el FPS es bueno", () => {
    const g = new PerfGovernor(0);
    feed(g, 60, 600);
    expect(g.index).toBe(0);
  });

  it("no baja por debajo del peor tier", () => {
    const g = new PerfGovernor(QUALITY_TIERS.length - 1);
    feed(g, 10, 1000);
    expect(g.index).toBe(QUALITY_TIERS.length - 1);
  });

  it("vuelve a subir si hay holgura sostenida (con histéresis)", () => {
    const g = new PerfGovernor(2);
    // Primero estabiliza el EMA en alto y deja pasar el cooldown.
    feed(g, 60, 600);
    expect(g.index).toBeLessThan(2); // subió al menos un tier
  });

  it("ignora dt no plausibles (pausa de pestaña) sin contaminar el FPS", () => {
    const g = new PerfGovernor(0);
    g.fps = 60;
    g.sample(5); // 5s: pausa → se ignora
    expect(g.fps).toBe(60);
  });

  // El cooldown es el mecanismo anti-oscilación: sin él, una caída transitoria de
  // FPS desploma la calidad varios tiers seguidos y se ve como parpadeo de
  // resolución/bloom/partículas. La versión anterior de este test assertaba
  // `toBeGreaterThanOrEqual`, que es cierto por construcción (el índice sólo sube
  // al degradar): pasaba también con COOLDOWN = 0 y el tier bajando dos veces más.
  it("la ventana de cooldown es más larga que la de degradación", () => {
    // Invariante de diseño: un cooldown más corto que DOWN_FRAMES no frenaría
    // nada. Es además la precondición del test siguiente.
    expect(COOLDOWN).toBeGreaterThan(DOWN_FRAMES);
  });

  it("respeta el cooldown: NO vuelve a bajar dentro de la ventana", () => {
    const g = new PerfGovernor(0);
    expect(feed(g, 20, 50)).toBe(1); // fuerza exactamente una bajada
    const tierAfterFirst = g.index;
    // Frames de FPS pésimo suficientes para disparar OTRA degradación si el
    // cooldown no existiera, pero menos que la ventana: el tier tiene que quedar
    // EXACTAMENTE igual. El conteo es fijo a propósito; escalarlo con COOLDOWN
    // volvería el test vacuo justo cuando el cooldown se rompe.
    expect(feed(g, 20, DOWN_FRAMES + 5)).toBe(0);
    expect(g.index).toBe(tierAfterFirst);
  });

  it("pasado el cooldown vuelve a bajar si el FPS sigue pésimo", () => {
    const g = new PerfGovernor(0);
    feed(g, 20, 50);
    const tierAfterFirst = g.index;
    // Cooldown completo + los frames de FPS bajo que exige la degradación.
    expect(feed(g, 20, COOLDOWN + DOWN_FRAMES + 10)).toBe(1);
    expect(g.index).toBe(tierAfterFirst + 1);
  });
});
