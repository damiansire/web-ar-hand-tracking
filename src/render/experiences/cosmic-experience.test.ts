import { describe, it, expect } from "vitest";
import type { InstancedMesh } from "three/webgpu";
import { CosmicExperience } from "./cosmic-experience";
import type { ExperienceContext } from "./experience";

/**
 * El presupuesto de partículas del governor de calidad (`setQuality`) antes se
 * aplicaba ocultando el tail con matrices de escala 0 y pidiendo un upload
 * completo. No funcionaba: `ARScene.frame()` llama a `setQuality` y a `update()`
 * en el MISMO frame, y `update()` volvía a fijar el rango parcial [0, drawn), que
 * es el único que Three sube. Las instancias sobrantes nunca llegaban a la GPU y
 * quedaban congeladas en su última posición: partículas fantasma justo al
 * degradar, o sea en el equipo lento que disparó la degradación.
 *
 * Este test reproduce esa secuencia exacta (setQuality → update) y asserta lo
 * observable: que las partículas fuera del presupuesto NO se dibujan.
 */
const CONTEXT: ExperienceContext = {
  hands: [],
  width: 1280,
  height: 720,
  mirrored: true,
  dt: 1 / 60,
  time: 0,
  color: "#f45e61",
};

/** Capas de partículas del efecto (los InstancedMesh colgados de `object`). */
function layers(exp: CosmicExperience): InstancedMesh[] {
  return exp.object.children.filter(
    (o): o is InstancedMesh => (o as InstancedMesh).isInstancedMesh === true,
  );
}

describe("CosmicExperience: presupuesto de calidad", () => {
  it("al bajar el tier deja de dibujar las partículas fuera del presupuesto", () => {
    const exp = new CosmicExperience();
    exp.update(CONTEXT);
    const full = layers(exp).map((m) => m.count);
    expect(full).toEqual([1300, 800, 500]);

    // La secuencia real de ARScene.frame(): applyTier() y después update().
    exp.setQuality(0.5);
    exp.update(CONTEXT);

    const drawn = layers(exp).map((m) => m.count);
    expect(drawn).toEqual([650, 400, 250]);
    exp.dispose();
  });

  it("el rango de upload cubre exactamente las instancias dibujadas", () => {
    const exp = new CosmicExperience();
    exp.setQuality(0.3);
    exp.update(CONTEXT);

    for (const mesh of layers(exp)) {
      const ranges = mesh.instanceMatrix.updateRanges;
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toEqual({ start: 0, count: mesh.count * 16 });
    }
    exp.dispose();
  });

  it("volver a subir el tier vuelve a dibujar todas las partículas", () => {
    const exp = new CosmicExperience();
    exp.setQuality(0.3);
    exp.update(CONTEXT);
    exp.setQuality(1);
    exp.update(CONTEXT);

    expect(layers(exp).map((m) => m.count)).toEqual([1300, 800, 500]);
    exp.dispose();
  });
});
