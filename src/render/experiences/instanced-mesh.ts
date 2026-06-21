/**
 * Helper compartido para crear los `InstancedMesh` de las experiencias con la
 * misma configuración (un solo lugar, sin divergencias): uso dinámico de la
 * matriz de instancias, sin frustum culling (las posiciones se calculan a mano
 * en píxeles de pantalla, no en el espacio de la cámara) y todas las instancias
 * arrancan "apagadas" (escala 0) hasta que el frame las posicione.
 *
 * `HIDDEN_MATRIX` es la matriz de escala 0 reusada para ocultar una instancia.
 * Es de sólo lectura por convención: nunca se muta, sólo se copia con
 * `setMatrixAt`, así que una única instancia compartida es segura.
 */
import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  type BufferGeometry,
  type Material,
} from "three/webgpu";

/** Matriz de escala 0 ("instancia apagada"), compartida y nunca mutada. */
export const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);

/**
 * Crea un `InstancedMesh` listo para el hot loop: `DynamicDrawUsage`,
 * `frustumCulled = false` y las `n` instancias ocultas (escala 0).
 */
export function makeInstanced(
  geo: BufferGeometry,
  mat: Material,
  n: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, HIDDEN_MATRIX);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
