import { describe, it, expect } from "vitest";
import {
  ParticleField,
  gravitate,
  addSwirl,
  depthFactor,
  type Attractor,
  type MutVec3,
} from "./particle-field";

const attractorAt = (
  x: number,
  y: number,
  z = 0,
  strength = 1e6,
  swirl = 0,
): Attractor => ({
  x,
  y,
  z,
  strength,
  swirl,
});

/** Generador determinista (LCG) para sembrar sin Math.random en los tests. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe("gravitate", () => {
  it("apunta hacia el atractor (tira de la partícula en su dirección)", () => {
    const out: MutVec3 = { x: 0, y: 0, z: 0 };
    // Partícula a la derecha del atractor → la aceleración debe ir hacia la izquierda (-x).
    gravitate(out, 100, 0, 0, attractorAt(0, 0), 10);
    expect(out.x).toBeLessThan(0);
    expect(Math.abs(out.y)).toBeLessThan(1e-9);
  });

  it("es más fuerte cerca que lejos", () => {
    const near: MutVec3 = { x: 0, y: 0, z: 0 };
    const far: MutVec3 = { x: 0, y: 0, z: 0 };
    gravitate(near, 50, 0, 0, attractorAt(0, 0), 10);
    gravitate(far, 500, 0, 0, attractorAt(0, 0), 10);
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x));
  });

  it("no diverge en el centro gracias al softening (valores finitos)", () => {
    const out: MutVec3 = { x: 0, y: 0, z: 0 };
    gravitate(out, 0, 0, 0, attractorAt(0, 0), 50);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.z)).toBe(true);
  });
});

describe("addSwirl", () => {
  it("agrega una componente perpendicular al radio (momento angular)", () => {
    const out: MutVec3 = { x: 0, y: 0, z: 0 };
    // Partícula a la derecha del atractor en (0,0); radio = +x.
    addSwirl(out, 100, 0, attractorAt(0, 0, 0, 1e6, 1), 50);
    // El swirl debe ser perpendicular: sólo componente en Y.
    expect(Math.abs(out.x)).toBeLessThan(1e-9);
    expect(Math.abs(out.y)).toBeGreaterThan(0);
  });

  it("la componente tangencial es ortogonal al radio (producto punto ~0)", () => {
    const out: MutVec3 = { x: 0, y: 0, z: 0 };
    const px = 80;
    const py = 60;
    addSwirl(out, px, py, attractorAt(0, 0, 0, 1e6, 1), 100);
    const dot = out.x * px + out.y * py; // radio = (px,py) porque el atractor está en (0,0)
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });
});

describe("depthFactor", () => {
  it("cerca (z>0) es mayor que lejos (z<0)", () => {
    expect(depthFactor(300, 300)).toBeGreaterThan(depthFactor(-300, 300));
  });
  it("en z=0 vale ~1", () => {
    expect(depthFactor(0, 300)).toBeCloseTo(1, 5);
  });
  it("nunca es negativo ni cero (clamp)", () => {
    expect(depthFactor(-100000, 300)).toBeGreaterThan(0);
  });
});

describe("ParticleField.seed", () => {
  it("ubica las partículas dentro de la caja", () => {
    const f = new ParticleField(500);
    f.seed(640, 480, 300, seededRand(1));
    for (let i = 0; i < f.count; i++) {
      expect(f.x[i]).toBeGreaterThanOrEqual(0);
      expect(f.x[i]).toBeLessThanOrEqual(640);
      expect(f.y[i]).toBeGreaterThanOrEqual(0);
      expect(f.y[i]).toBeLessThanOrEqual(480);
      expect(Math.abs(f.z[i])).toBeLessThanOrEqual(300);
      expect(f.size[i]).toBeGreaterThan(0);
    }
  });
});

describe("ParticleField.update", () => {
  it("con atractor, acerca el campo (baja la distancia media a la mano)", () => {
    const f = new ParticleField(300);
    f.seed(640, 480, 300, seededRand(7));
    const a = attractorAt(320, 240, 0, 4e6, 0); // sin swirl: tirón directo
    const meanDist = () => {
      let s = 0;
      for (let i = 0; i < f.count; i++) s += Math.hypot(f.x[i] - a.x, f.y[i] - a.y);
      return s / f.count;
    };
    const before = meanDist();
    for (let k = 0; k < 60; k++) f.update(1 / 60, a, 640, 480, 300);
    expect(meanDist()).toBeLessThan(before);
  });

  it("con swirl, las partículas mantienen distancia orbitando (no colapsan a 0)", () => {
    const f = new ParticleField(300);
    f.seed(640, 480, 300, seededRand(3));
    const a = attractorAt(320, 240, 0, 3e6, 1.2);
    for (let k = 0; k < 180; k++) f.update(1 / 60, a, 640, 480, 300);
    let mean = 0;
    for (let i = 0; i < f.count; i++) mean += Math.hypot(f.x[i] - a.x, f.y[i] - a.y);
    mean /= f.count;
    // Orbitan a un radio > 0 (no se apilan exactamente en la mano).
    expect(mean).toBeGreaterThan(5);
  });

  it("mantiene todo dentro de la caja y con valores finitos", () => {
    const f = new ParticleField(300);
    f.seed(640, 480, 300, seededRand(9));
    const a = attractorAt(100, 100, 0, 8e6, 1.5);
    for (let k = 0; k < 240; k++) f.update(1 / 60, a, 640, 480, 300);
    for (let i = 0; i < f.count; i++) {
      expect(Number.isFinite(f.x[i])).toBe(true);
      expect(Number.isFinite(f.y[i])).toBe(true);
      expect(Number.isFinite(f.z[i])).toBe(true);
      expect(f.x[i]).toBeGreaterThanOrEqual(0);
      expect(f.x[i]).toBeLessThanOrEqual(640);
      expect(f.y[i]).toBeGreaterThanOrEqual(0);
      expect(f.y[i]).toBeLessThanOrEqual(480);
      expect(Math.abs(f.z[i])).toBeLessThanOrEqual(300 + 1e-3);
    }
  });

  it("sin atractor, la deriva pierde velocidad (damping)", () => {
    const f = new ParticleField(100);
    f.seed(640, 480, 300, seededRand(5));
    // Velocidad inicial conocida lejos de los bordes (sin rebotes que la alteren).
    for (let i = 0; i < f.count; i++) {
      f.x[i] = 320;
      f.y[i] = 240;
      f.z[i] = 0;
      f.vx[i] = 100;
      f.vy[i] = 0;
      f.vz[i] = 0;
    }
    const speed0 = Math.abs(f.vx[0]);
    for (let k = 0; k < 120; k++) f.update(1 / 60, null, 640, 480, 300);
    expect(Math.abs(f.vx[0])).toBeLessThan(speed0);
  });

  it("dt<=0 es no-op (no rompe ni mueve nada)", () => {
    const f = new ParticleField(10);
    f.seed(640, 480, 300, seededRand(2));
    const x0 = f.x[0];
    f.update(0, attractorAt(0, 0), 640, 480, 300);
    expect(f.x[0]).toBe(x0);
  });
});

describe("ParticleField.burst", () => {
  it("empuja las partículas alejándolas del centro", () => {
    const f = new ParticleField(50);
    f.seed(640, 480, 300, seededRand(4));
    // Partícula a la derecha del centro → su vx debe aumentar (alejarse).
    f.x[0] = 400;
    f.y[0] = 240;
    f.vx[0] = 0;
    f.burst(320, 240, 200);
    expect(f.vx[0]).toBeGreaterThan(0);
  });
});
