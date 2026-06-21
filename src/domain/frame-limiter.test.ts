import { describe, it, expect } from "vitest";
import { FrameRateLimiter } from "./frame-limiter";

describe("FrameRateLimiter", () => {
  it("acepta el primer cuadro siempre", () => {
    const lim = new FrameRateLimiter(30);
    expect(lim.shouldProcess(0)).toBe(true);
  });

  it("halva una fuente a 60 fps hasta la tasa objetivo de 30", () => {
    const lim = new FrameRateLimiter(30);
    // Cuadros cada 16.67 ms (60 fps). A objetivo 30 fps debería pasar 1 de cada 2.
    let accepted = 0;
    for (let i = 0; i < 60; i++) {
      if (lim.shouldProcess(i * (1000 / 60))) accepted++;
    }
    // ~30 de 60 (medio segundo de fuente). Holgura por el SLACK/redondeo.
    expect(accepted).toBeGreaterThanOrEqual(29);
    expect(accepted).toBeLessThanOrEqual(31);
  });

  it("no dropea una fuente que ya viene a la tasa objetivo", () => {
    const lim = new FrameRateLimiter(30);
    // Fuente a 30 fps exactos (33.33 ms): NO debe caer a la mitad por estar en el borde.
    let accepted = 0;
    for (let i = 0; i < 30; i++) {
      if (lim.shouldProcess(i * (1000 / 30))) accepted++;
    }
    expect(accepted).toBe(30);
  });

  it("sin límite (fps <= 0) acepta todos los cuadros", () => {
    const lim = new FrameRateLimiter(0);
    let accepted = 0;
    for (let i = 0; i < 10; i++) if (lim.shouldProcess(i * (1000 / 120))) accepted++;
    expect(accepted).toBe(10);
  });

  it("no dispara una ráfaga para 'ponerse al día' tras una pausa larga", () => {
    const lim = new FrameRateLimiter(30);
    expect(lim.shouldProcess(0)).toBe(true);
    // Pausa larga (pestaña en background): un solo cuadro mucho después.
    expect(lim.shouldProcess(5000)).toBe(true);
    // El siguiente cuadro inmediato NO pasa (no se acumuló deuda de intervalos).
    expect(lim.shouldProcess(5010)).toBe(false);
  });

  it("setFps cambia la cadencia en caliente", () => {
    const lim = new FrameRateLimiter(30);
    expect(lim.shouldProcess(0)).toBe(true);
    expect(lim.shouldProcess(20)).toBe(false); // 20 ms < ~30 ms (30 fps)
    lim.setFps(60); // ahora ~15 ms de intervalo
    expect(lim.shouldProcess(20)).toBe(true); // 20 ms >= ~15 ms
  });

  it("reset vuelve a aceptar el próximo cuadro de inmediato", () => {
    const lim = new FrameRateLimiter(30);
    expect(lim.shouldProcess(0)).toBe(true);
    expect(lim.shouldProcess(5)).toBe(false);
    lim.reset();
    expect(lim.shouldProcess(5)).toBe(true);
  });
});
