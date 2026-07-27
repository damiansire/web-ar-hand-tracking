import { describe, it, expect, vi } from "vitest";
import { watchDeviceLost } from "./device-lost";

/**
 * WebGPU es el backend por defecto en Chrome/Edge modernos y NO dispara
 * `webglcontextlost`, así que hasta ahora perder el device dejaba el canvas
 * congelado con la cámara prendida y sin ningún aviso. La única cobertura del
 * tema era el reducer puro de `app-state`, que sólo prueba la transición.
 */
describe("watchDeviceLost", () => {
  it("avisa cuando el device se pierde, con el motivo que informa el backend", async () => {
    let lose!: (info: unknown) => void;
    const lost = new Promise<unknown>((resolve) => {
      lose = resolve;
    });
    const onLost = vi.fn();

    expect(watchDeviceLost({ device: { lost } }, onLost)).toBe(true);
    expect(onLost).not.toHaveBeenCalled(); // todavía no pasó nada

    lose({ reason: "destroyed", message: "driver reset" });
    await lost;
    await Promise.resolve();

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost.mock.calls[0]?.[0]).toContain("driver reset");
  });

  it("sin motivo utilizable igual entrega un mensaje accionable", async () => {
    let lose!: (info: unknown) => void;
    const lost = new Promise<unknown>((resolve) => {
      lose = resolve;
    });
    const onLost = vi.fn();
    watchDeviceLost({ device: { lost } }, onLost);

    lose(undefined);
    await lost;
    await Promise.resolve();

    expect(onLost).toHaveBeenCalledWith("Se perdió el dispositivo GPU.");
  });

  it("backend sin device (WebGL2) no es un error: no hay nada que vigilar", () => {
    const onLost = vi.fn();
    expect(watchDeviceLost(undefined, onLost)).toBe(false);
    expect(watchDeviceLost({}, onLost)).toBe(false);
    expect(watchDeviceLost({ device: {} }, onLost)).toBe(false);
    expect(watchDeviceLost({ device: { lost: "no es una promesa" } }, onLost)).toBe(
      false,
    );
    expect(onLost).not.toHaveBeenCalled();
  });
});
