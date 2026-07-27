import { describe, it, expect, vi } from "vitest";
import type { OrthographicCamera, Scene, WebGPURenderer } from "three/webgpu";
import { BloomCompositor } from "./bloom-compositor";

/**
 * El guard anti pile-up del bloom es un flag "in flight" que sólo se libera en el
 * `.finally` de la promesa del pipeline. Si `render()` lanzaba de forma
 * sincrónica, esa promesa nunca se construía: `inFlight` quedaba tomado para
 * siempre y TODOS los frames siguientes salían por el `return` del guard, con el
 * canvas congelado y sin ningún camino de recuperación.
 *
 * No se puede instanciar un `RenderPipeline` real sin GPU, así que inyectamos el
 * pipeline por la puerta de atrás (es privado a propósito: sólo `init()` lo crea)
 * y ejercitamos la política del guard, que es lo que este test custodia.
 */
type PipelineStub = { render: () => unknown; dispose: () => void };

function withPipeline(pipeline: PipelineStub): BloomCompositor {
  const compositor = new BloomCompositor();
  (compositor as unknown as { post: PipelineStub }).post = pipeline;
  return compositor;
}

const scene = {} as Scene;
const camera = {} as OrthographicCamera;

function fakeRenderer(): WebGPURenderer & { render: ReturnType<typeof vi.fn> } {
  return { render: vi.fn() } as unknown as WebGPURenderer & {
    render: ReturnType<typeof vi.fn>;
  };
}

describe("BloomCompositor.present", () => {
  it("un throw sincrónico de render() no deja el guard tomado: degrada a render directo", () => {
    const renderer = fakeRenderer();
    const compositor = withPipeline({
      render: () => {
        throw new Error("compilación de nodos TSL falló");
      },
      dispose: () => {},
    });

    compositor.present(renderer, scene, camera, true);
    expect(renderer.render).toHaveBeenCalledTimes(1); // degradó en el mismo frame

    // El frame siguiente TIENE que renderizar; antes salía por `if (inFlight) return`.
    compositor.present(renderer, scene, camera, true);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it("descarta el frame mientras hay un render de bloom en vuelo (anti pile-up)", () => {
    const renderer = fakeRenderer();
    let resolvePending: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    const render = vi.fn(() => pending);
    const compositor = withPipeline({ render, dispose: () => {} });

    compositor.present(renderer, scene, camera, true);
    compositor.present(renderer, scene, camera, true);
    expect(render).toHaveBeenCalledTimes(1); // el segundo frame se descartó
    expect(renderer.render).not.toHaveBeenCalled(); // y no cayó a render directo

    resolvePending();
  });

  it("sin experiencia activa renderiza directo, sin tocar el pipeline de bloom", () => {
    const renderer = fakeRenderer();
    const render = vi.fn(() => Promise.resolve());
    const compositor = withPipeline({ render, dispose: () => {} });

    compositor.present(renderer, scene, camera, false);

    expect(render).not.toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });
});
