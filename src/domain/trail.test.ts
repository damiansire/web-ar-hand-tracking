import { describe, it, expect } from "vitest";
import { Trail } from "./trail";

describe("Trail (ring buffer)", () => {
  it("arranca vacío", () => {
    const t = new Trail(4);
    expect(t.count).toBe(0);
  });

  it("acumula puntos en orden temporal (0 = más viejo)", () => {
    const t = new Trail(4);
    t.push(1, 10);
    t.push(2, 20);
    t.push(3, 30);
    expect(t.count).toBe(3);
    expect(t.x[t.index(0)]).toBe(1);
    expect(t.x[t.index(2)]).toBe(3);
    expect(t.lastX()).toBe(3);
    expect(t.lastY()).toBe(30);
  });

  it("al llenarse pisa el más viejo (cabeza avanza, count satura)", () => {
    const t = new Trail(3);
    t.push(1, 1);
    t.push(2, 2);
    t.push(3, 3);
    t.push(4, 4); // pisa al (1,1)
    expect(t.count).toBe(3);
    expect(t.x[t.index(0)]).toBe(2); // el más viejo ahora es el 2
    expect(t.lastX()).toBe(4);
  });

  it("advance envejece todos los puntos", () => {
    const t = new Trail(4);
    t.push(0, 0);
    t.push(1, 1);
    t.advance(0.5, 10);
    expect(t.age[t.index(0)]).toBeCloseTo(0.5);
    expect(t.age[t.index(1)]).toBeCloseTo(0.5);
    expect(t.count).toBe(2);
  });

  it("advance descarta por el frente los que superan lifetime", () => {
    const t = new Trail(4);
    t.push(0, 0); // será el más viejo
    t.advance(1, 10); // age del primero = 1
    t.push(1, 1); // age 0
    t.advance(9.5, 10); // primero: 10.5 > 10 (vence), segundo: 9.5 (vive)
    expect(t.count).toBe(1);
    expect(t.lastX()).toBe(1);
    expect(t.x[t.index(0)]).toBe(1);
  });

  it("clear vacía el trazo", () => {
    const t = new Trail(4);
    t.push(1, 1);
    t.push(2, 2);
    t.clear();
    expect(t.count).toBe(0);
    t.push(9, 9);
    expect(t.count).toBe(1);
    expect(t.lastX()).toBe(9);
  });

  it("mantiene el orden temporal correcto tras envolver el buffer", () => {
    const t = new Trail(3);
    for (let i = 1; i <= 6; i++) t.push(i, i); // termina con 4,5,6
    expect(t.count).toBe(3);
    expect(t.x[t.index(0)]).toBe(4);
    expect(t.x[t.index(1)]).toBe(5);
    expect(t.x[t.index(2)]).toBe(6);
  });
});
