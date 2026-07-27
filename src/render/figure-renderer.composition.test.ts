import { describe, it, expect } from "vitest";
import { Matrix4, Scene, Vector3, type InstancedMesh } from "three/webgpu";
import { FigureRenderer, type FigureFrameParams } from "./figure-renderer";
import {
  ANCHOR_LANDMARK_INDEX,
  landmarkToScreen,
  type NormalizedLandmark,
} from "../domain/hand-tracking";

/**
 * Toda la lógica VISIBLE del producto vive en la rama `hands.length > 0`:
 * colocación, suavizado, perspectiva por tamaño de mano, gracia. Los primitivos
 * puros están testeados aislados, pero la composición entre ellos (la que produce
 * el bug que el usuario ve en el primer segundo: figura en la esquina, sin
 * escala, invisible) no se ejercitaba en ningún test: el único test de
 * integración es el e2e con cámara falsa, y esa cámara dibuja una elipse que
 * MediaPipe nunca detecta como mano, así que `hands` siempre llega vacío.
 *
 * Estos tests inyectan landmarks sintéticos directamente a `FigureRenderer.frame`
 * y asertan la matriz de instancia resultante. Son deterministas y no necesitan
 * browser ni modelo.
 */
const W = 1280;
const H = 720;

/** Mano sintética de 21 landmarks con la palma en (nx, ny) y un palmo dado. */
function hand(nx: number, ny: number, span = 0.18): NormalizedLandmark[] {
  const lm: NormalizedLandmark[] = [];
  for (let i = 0; i < 21; i++) lm.push({ x: nx, y: ny, z: 0 });
  // Muñeca (0) separada del MCP del dedo medio (9) por `span`: es lo que mide
  // `handPerspectiveScale` para deducir la distancia a cámara.
  lm[ANCHOR_LANDMARK_INDEX] = { x: nx, y: ny, z: 0 };
  lm[0] = { x: nx, y: ny + span, z: 0 };
  return lm;
}

function params(overrides: Partial<FigureFrameParams> = {}): FigureFrameParams {
  return {
    hands: [],
    figure: "cube",
    mirrored: false,
    sizeScale: 1,
    spin: 0,
    dt: 1 / 60,
    time: 0,
    multiHand: false,
    edgesEnabled: false,
    shadowEnabled: false,
    occlusionEnabled: false,
    ...overrides,
  };
}

/** Malla instanciada de las figuras (la primera que cuelga del grupo). */
function figuresMesh(renderer: FigureRenderer): InstancedMesh {
  return (renderer as unknown as { figures: InstancedMesh }).figures;
}

/** Posición y escala de la instancia `i` leídas de la matriz subida al buffer. */
function instanceTransform(mesh: InstancedMesh, i: number) {
  const m = new Matrix4();
  mesh.getMatrixAt(i, m);
  const position = new Vector3().setFromMatrixPosition(m);
  const scale = new Vector3().setFromMatrixScale(m);
  return { position, scale };
}

/** Corre `frames` cuadros con la misma mano, para que el suavizado converja. */
function settle(
  renderer: FigureRenderer,
  hands: NormalizedLandmark[][],
  frames = 240,
): void {
  for (let f = 0; f < frames; f++) {
    renderer.frame(params({ hands, time: f * 16.7 }), W, H);
  }
}

describe("FigureRenderer: composición con manos reales", () => {
  it("coloca la figura sobre el ancla de la mano, en píxeles de pantalla", () => {
    const renderer = new FigureRenderer(new Scene());
    const lm = hand(0.3, 0.6);
    settle(renderer, [lm]);

    const expected = landmarkToScreen(lm[ANCHOR_LANDMARK_INDEX]!, W, H, false);
    const { position, scale } = instanceTransform(figuresMesh(renderer), 0);

    expect(position.x).toBeCloseTo(expected.x, 0);
    expect(position.y).toBeCloseTo(expected.y, 0);
    expect(scale.x).toBeGreaterThan(0); // visible, no apagada con escala 0
    renderer.dispose();
  });

  it("con la vista espejada la figura acompaña el espejo del video", () => {
    const renderer = new FigureRenderer(new Scene());
    const lm = hand(0.3, 0.6);
    for (let f = 0; f < 240; f++) {
      renderer.frame(params({ hands: [lm], mirrored: true, time: f * 16.7 }), W, H);
    }

    const expected = landmarkToScreen(lm[ANCHOR_LANDMARK_INDEX]!, W, H, true);
    const { position } = instanceTransform(figuresMesh(renderer), 0);

    expect(position.x).toBeCloseTo(expected.x, 0);
    expect(position.x).toBeGreaterThan(W / 2); // el espejo la manda al otro lado
    renderer.dispose();
  });

  it("una mano más cerca (palmo más grande) dibuja la figura más grande", () => {
    const near = new FigureRenderer(new Scene());
    settle(near, [hand(0.5, 0.5, 0.3)]);
    const far = new FigureRenderer(new Scene());
    settle(far, [hand(0.5, 0.5, 0.1)]);

    const nearScale = instanceTransform(figuresMesh(near), 0).scale.x;
    const farScale = instanceTransform(figuresMesh(far), 0).scale.x;

    expect(nearScale).toBeGreaterThan(farScale);
    near.dispose();
    far.dispose();
  });

  it("multiHand off dibuja una sola figura; on dibuja una por mano", () => {
    const single = new FigureRenderer(new Scene());
    const two = [hand(0.3, 0.5), hand(0.7, 0.5)];
    settle(single, two);
    expect(instanceTransform(figuresMesh(single), 1).scale.x).toBe(0); // segunda apagada

    const multi = new FigureRenderer(new Scene());
    for (let f = 0; f < 240; f++) {
      multi.frame(params({ hands: two, multiHand: true, time: f * 16.7 }), W, H);
    }
    expect(instanceTransform(figuresMesh(multi), 1).scale.x).toBeGreaterThan(0);

    single.dispose();
    multi.dispose();
  });

  it("figure 'none' apaga la figura aunque haya mano", () => {
    const renderer = new FigureRenderer(new Scene());
    settle(renderer, [hand(0.5, 0.5)]);
    expect(instanceTransform(figuresMesh(renderer), 0).scale.x).toBeGreaterThan(0);

    renderer.frame(params({ hands: [hand(0.5, 0.5)], figure: "none", time: 5000 }), W, H);
    expect(instanceTransform(figuresMesh(renderer), 0).scale.x).toBe(0);
    renderer.dispose();
  });
});
