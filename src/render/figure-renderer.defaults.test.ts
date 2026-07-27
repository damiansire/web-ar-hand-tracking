import { describe, it, expect } from "vitest";
import {
  Color,
  LineBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Scene,
} from "three/webgpu";
import { FigureRenderer } from "./figure-renderer";
import { DEFAULT_CONTROLS, hexToNumber } from "../domain/controls";

/**
 * Los valores iniciales del material estaban escritos a mano en el renderer
 * (`metalness: 0.25`, `0x0b1020`, `0xf45e61`) y también en el panel de controles,
 * en los campos de ARScene y en el CSS del video: cinco copias que coincidían por
 * casualidad. Cambiar el default en un solo lugar dejaba a la UI mostrando un
 * valor y a la escena renderizando otro hasta que el usuario tocara ese control.
 *
 * Este test ata el material a `DEFAULT_CONTROLS`: si alguien vuelve a hardcodear
 * un valor en el renderer, o cambia el default sin que el material lo siga, falla.
 */
function materials(renderer: FigureRenderer): {
  figure: MeshStandardNodeMaterial;
  edge: LineBasicNodeMaterial;
} {
  const internals = renderer as unknown as {
    material: MeshStandardNodeMaterial;
    edgeMaterial: LineBasicNodeMaterial;
  };
  return { figure: internals.material, edge: internals.edgeMaterial };
}

describe("FigureRenderer: estado inicial", () => {
  it("deriva el material inicial de DEFAULT_CONTROLS, sin valores propios", () => {
    const renderer = new FigureRenderer(new Scene());
    const { figure, edge } = materials(renderer);

    expect(figure.metalness).toBe(DEFAULT_CONTROLS.metalness);
    expect(figure.roughness).toBe(DEFAULT_CONTROLS.roughness);
    expect(edge.color.getHex()).toBe(
      new Color(hexToNumber(DEFAULT_CONTROLS.edgeColor)).getHex(),
    );

    renderer.dispose();
  });
});
