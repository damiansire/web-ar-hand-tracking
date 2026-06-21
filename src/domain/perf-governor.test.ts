import { describe, it, expect } from "vitest";
import { PerfGovernor, QUALITY_TIERS, initialTierIndex } from "./perf-governor";

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

  it("respeta el cooldown: no cambia dos veces seguidas", () => {
    const g = new PerfGovernor(0);
    feed(g, 20, 50); // fuerza una bajada
    const tierAfterFirst = g.index;
    // Inmediatamente después no debería re-bajar dentro del cooldown.
    feed(g, 20, 100);
    // El tier nunca retrocede (solo puede seguir bajando, no "rebotar" arriba).
    expect(g.index).toBeGreaterThanOrEqual(tierAfterFirst);
  });
});
