/**
 * Governor de calidad adaptativa: mantiene el render fluido en cualquier equipo
 * eligiendo un "tier" de calidad y BAJÁNDOLO si el FPS cae (degradación dinámica),
 * subiéndolo de nuevo —con histéresis— si hay holgura sostenida. Es la palanca
 * recomendada para que la app vaya rápida en desktop con GPU, low-end y móvil sin
 * un único preset que no le sirve a nadie.
 *
 * Lógica pura y determinista (sin DOM ni Three.js): el shell de render (ARScene)
 * la alimenta con el `dt` de cada frame y aplica el tier resultante (pixelRatio,
 * bloom on/off, cantidad de partículas).
 */

export interface QualityTier {
  readonly name: string;
  /** Tope de devicePixelRatio (resolución de render). */
  readonly pixelRatioCap: number;
  /** Glow (bloom) activo en este tier. */
  readonly bloom: boolean;
  /** Fracción de partículas a dibujar (0..1). */
  readonly particleScale: number;
}

/** De mayor (0) a menor calidad. Índices más altos = más barato. */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: "alta", pixelRatioCap: 2, bloom: true, particleScale: 1 },
  { name: "media", pixelRatioCap: 1.5, bloom: true, particleScale: 0.65 },
  { name: "baja", pixelRatioCap: 1, bloom: false, particleScale: 0.45 },
  { name: "minima", pixelRatioCap: 0.75, bloom: false, particleScale: 0.3 },
];

export interface DeviceHints {
  mobile: boolean;
  /** navigator.hardwareConcurrency (núcleos lógicos). */
  cores: number;
  /** ¿El navegador expone WebGPU? (proxy de GPU moderna). */
  hasWebGPU: boolean;
}

/**
 * Tier inicial conservador según el dispositivo: móvil arranca en "baja", un
 * equipo sin WebGPU y con pocos núcleos en "media", y el resto en "alta". Si la
 * estimación quedó optimista, el governor baja solo al medir el FPS real.
 */
export function initialTierIndex(h: DeviceHints): number {
  if (h.mobile) return 2; // baja
  if (!h.hasWebGPU && h.cores <= 4) return 1; // media
  return 0; // alta
}

const DOWN_FPS = 45; // por debajo → candidato a bajar calidad
const UP_FPS = 57; // por encima sostenido → candidato a subir
const DOWN_FRAMES = 45; // ~0.75s en 60fps de FPS bajo antes de bajar
const UP_FRAMES = 200; // ~3.3s de holgura antes de subir (anti-oscilación)
const COOLDOWN = 120; // ~2s sin cambios tras un ajuste
const EMA = 0.1; // suavizado del FPS (0..1)

/**
 * Decide el tier según un EMA del FPS. Devuelve `true` desde `sample()` cuando el
 * tier cambió (para que el caller aplique la nueva calidad).
 */
export class PerfGovernor {
  /** FPS suavizado (EMA). */
  fps = 60;
  /** Índice de tier actual en QUALITY_TIERS. */
  index: number;
  private maxIndex: number;
  private below = 0;
  private above = 0;
  private cooldown = 0;

  constructor(startIndex: number, tierCount: number = QUALITY_TIERS.length) {
    this.maxIndex = tierCount - 1;
    this.index = Math.max(0, Math.min(this.maxIndex, startIndex));
  }

  /**
   * Alimenta un frame (dt en segundos). Ignora dt no plausibles (pausas, saltos
   * al volver de otra pestaña). Devuelve `true` si cambió el tier.
   */
  sample(dt: number): boolean {
    if (dt <= 0 || dt > 0.5) return false; // pausa/salto: no contamina el FPS
    const inst = 1 / dt;
    this.fps += (inst - this.fps) * EMA;

    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }

    if (this.fps < DOWN_FPS && this.index < this.maxIndex) {
      this.below++;
      this.above = 0;
    } else if (this.fps > UP_FPS && this.index > 0) {
      this.above++;
      this.below = 0;
    } else {
      this.below = 0;
      this.above = 0;
    }

    if (this.below >= DOWN_FRAMES) {
      this.index++;
      this.below = 0;
      this.cooldown = COOLDOWN;
      return true;
    }
    if (this.above >= UP_FRAMES) {
      this.index--;
      this.above = 0;
      this.cooldown = COOLDOWN;
      return true;
    }
    return false;
  }

  get tier(): QualityTier {
    return QUALITY_TIERS[this.index];
  }
}
