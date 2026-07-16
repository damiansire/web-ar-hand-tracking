import { describe, it, expect } from "vitest";
import { RollingStats } from "./perf-metrics";

describe("RollingStats", () => {
  it("arranca vacío", () => {
    const s = new RollingStats(3);
    expect(s.count).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.p95()).toBe(0);
  });

  it("calcula la media de las muestras", () => {
    const s = new RollingStats(10);
    s.push(10);
    s.push(20);
    s.push(30);
    expect(s.count).toBe(3);
    expect(s.mean).toBe(20);
  });

  it("descarta las muestras más viejas al superar la capacidad", () => {
    const s = new RollingStats(2);
    s.push(1);
    s.push(2);
    s.push(3); // descarta el 1
    expect(s.count).toBe(2);
    expect(s.mean).toBe(2.5);
  });

  it("p95 aproxima el percentil 95 sobre las muestras ordenadas", () => {
    const s = new RollingStats(100);
    for (let i = 1; i <= 100; i++) s.push(i);
    expect(s.p95()).toBe(95);
  });

  it("reset vacía el buffer", () => {
    const s = new RollingStats(5);
    s.push(1);
    s.push(2);
    s.reset();
    expect(s.count).toBe(0);
    expect(s.mean).toBe(0);
  });

  it("rechaza capacidad no positiva", () => {
    expect(() => new RollingStats(0)).toThrow();
  });
});
