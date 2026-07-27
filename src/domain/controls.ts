/**
 * Estado de los controles del usuario: data pura, sin DOM ni Three.js.
 *
 * Vive en el dominio porque lo comparten las dos capas de los extremos: `ui`
 * (que lo produce, `<ar-controls>`) y `render` (que lo consume,
 * `ARScene.applyControls`). Tenerlo en `ui` invertía la flecha de dependencias
 * del repo: render terminaba importando su contrato público desde un custom
 * element con ~200 líneas de CSS y un `customElements.define` de efecto lateral.
 *
 * `DEFAULT_CONTROLS` es la ÚNICA fuente de verdad del estado inicial. Antes el
 * mismo juego de valores estaba escrito a mano en cinco lugares (el panel, los
 * campos de `ARScene`, el material de `FigureRenderer` y el CSS del video) y
 * coincidían por casualidad: cambiar un default en uno solo dejaba a la UI
 * mostrando un valor y a la escena renderizando otro, hasta que el usuario
 * tocara ese control.
 */
export interface ControlsState {
  size: number;
  speed: number;
  /** Opacidad de la figura (0 = transparente, 1 = sólida). */
  opacity: number;
  /** Metalización del material (0 = mate, 1 = metálico). */
  metalness: number;
  /** Rugosidad del material (0 = espejado, 1 = difuso). */
  roughness: number;
  color: string;
  /** Muestra el relleno de las caras (apagado = figura hueca, sólo contorno). */
  faces: boolean;
  /** Modo malla (sólo aristas de triángulos, sin caras). */
  wireframe: boolean;
  /** Muestra las aristas (bordes) de la figura. */
  edges: boolean;
  edgeColor: string;
  /** Sombra (blob) bajo la figura. */
  shadow: boolean;
  /** Dibujar figuras en ambas manos. */
  multiHand: boolean;
  /** Oclusión: la figura queda por detrás al dar vuelta la mano. */
  occlusion: boolean;
  /** Vista espejada (selfie). */
  mirrored: boolean;
  /** Si está activo, reemplaza el video de la cámara por un color sólido. */
  bgEnabled: boolean;
  bgColor: string;
}

/** Estado inicial de los controles: fuente única para UI, escena y materiales. */
export const DEFAULT_CONTROLS: ControlsState = {
  size: 1,
  speed: 1,
  opacity: 1,
  metalness: 0.25,
  roughness: 0.35,
  color: "#f45e61",
  faces: true,
  wireframe: false,
  edges: false,
  edgeColor: "#0b1020",
  shadow: false,
  multiHand: false,
  occlusion: true,
  mirrored: true,
  bgEnabled: false,
  bgColor: "#101826",
};

/** Color hex CSS (`#rrggbb`) como número, para los materiales de Three.js. */
export function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}
