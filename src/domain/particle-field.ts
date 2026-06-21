/**
 * Motor de un campo de partículas 3D (polvo estelar) para la experiencia cósmica.
 * Lógica pura, sin Three.js ni DOM: sólo simula posiciones/velocidades en arrays
 * tipados y las avanza por frame. El render (cosmic-experience) lee estos arrays
 * y los vuelca a un InstancedMesh.
 *
 * El campo vive en una caja 3D de `width × height × 2·depth` (x,y en píxeles de
 * pantalla; z en [-depth, +depth], con z=0 en el plano de la mano). Sin atractor,
 * las partículas derivan suave y rebotan en los bordes (nebulosa a la deriva).
 * Con un atractor (la mano), cada partícula recibe una aceleración **radial**
 * hacia él más una **tangencial** (remolino), así orbitan en vez de colapsar.
 *
 * Las funciones de física se exportan sueltas y puras para poder testearlas sin
 * instanciar el campo entero.
 */

/** Atractor: punto 3D que tira de las partículas, con fuerza y remolino. */
export interface Attractor {
  x: number;
  y: number;
  z: number;
  /** Intensidad del tirón radial (px/s² a distancia de referencia). */
  strength: number;
  /** Componente tangencial (remolino) relativa al tirón radial. 0 = sin orbitar. */
  swirl: number;
}

/** Vector 3D mutable reusable (para evitar alocar en el hot loop). */
export interface MutVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Aceleración gravitatoria hacia un punto, con "softening" para no diverger cerca
 * del centro (evita el clásico tirón infinito a distancia 0). Escribe el resultado
 * en `out` (radial: apunta del punto hacia el atractor) y devuelve la distancia.
 */
export function gravitate(
  out: MutVec3,
  px: number,
  py: number,
  pz: number,
  a: Attractor,
  softening: number,
): number {
  const dx = a.x - px;
  const dy = a.y - py;
  const dz = a.z - pz;
  const distSq = dx * dx + dy * dy + dz * dz;
  const dist = Math.sqrt(distSq) || 1e-6;
  // a = strength / (d² + soft²) en la dirección del atractor (unitaria).
  const mag = a.strength / (distSq + softening * softening);
  out.x = (dx / dist) * mag;
  out.y = (dy / dist) * mag;
  out.z = (dz / dist) * mag;
  return dist;
}

/**
 * Componente tangencial en el plano XY (remolino): perpendicular al vector
 * radial mano→partícula, de magnitud proporcional al tirón. Da momento angular
 * para que las partículas orbiten formando un disco en vez de caer en línea recta.
 * Suma sobre `out` (que ya trae la parte radial).
 */
export function addSwirl(
  out: MutVec3,
  px: number,
  py: number,
  a: Attractor,
  radialMag: number,
): void {
  const dx = px - a.x;
  const dy = py - a.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  // Perpendicular a (dx,dy) en XY, normalizada, escalada por el tirón y el swirl.
  out.x += (-dy / len) * radialMag * a.swirl;
  out.y += (dx / len) * radialMag * a.swirl;
}

/**
 * Factor de profundidad para proyección/escala: las partículas más cercanas a la
 * cámara (z grande y positivo) se ven más grandes y brillantes; las lejanas, más
 * chicas. Devuelve un multiplicador en torno a 1 (clamp para no invertir).
 * Modelo simple de perspectiva fake sobre la cámara ortográfica de la escena.
 */
export function depthFactor(z: number, depth: number): number {
  // z=+depth → ~1.6 (cerca), z=0 → 1, z=-depth → ~0.4 (lejos).
  const t = z / (depth || 1); // -1..1
  return Math.max(0.25, 1 + t * 0.6);
}

const REF_SOFTENING = 90; // px: radio "blando" del atractor (no diverge en el centro)
const MAX_SPEED = 1400; // px/s: tope de velocidad (estabilidad)

/**
 * Campo de partículas: arrays planos (x,y,z,vx,vy,vz) + tamaño/fase por partícula.
 * `update` avanza un frame. Reusa un acumulador de aceleración (alloc-free).
 */
export class ParticleField {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Tamaño base por partícula (px), da variedad al campo. */
  readonly size: Float32Array;
  /** Fase aleatoria por partícula (para titileo desfasado). */
  readonly phase: Float32Array;

  private acc: MutVec3 = { x: 0, y: 0, z: 0 };

  constructor(count: number) {
    this.count = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.z = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.vz = new Float32Array(count);
    this.size = new Float32Array(count);
    this.phase = new Float32Array(count);
  }

  /**
   * Siembra el campo dentro de la caja. `rand` se inyecta (default Math.random)
   * para poder testear con una secuencia determinista.
   */
  seed(
    width: number,
    height: number,
    depth: number,
    rand: () => number = Math.random,
  ): void {
    for (let i = 0; i < this.count; i++) {
      this.x[i] = rand() * width;
      this.y[i] = rand() * height;
      this.z[i] = (rand() * 2 - 1) * depth;
      this.vx[i] = (rand() * 2 - 1) * 12;
      this.vy[i] = (rand() * 2 - 1) * 12;
      this.vz[i] = (rand() * 2 - 1) * 12;
      this.phase[i] = rand() * Math.PI * 2;
      // Mayoría chicas, pocas grandes → sensación de campo profundo.
      const r = rand();
      this.size[i] = r > 0.94 ? 4 + rand() * 3 : 1.2 + rand() * 2.2;
    }
  }

  /**
   * Avanza la simulación `dt` segundos. Si hay `attractor`, las partículas son
   * atraídas con remolino (orbitan); si es `null`, derivan con damping y rebotan
   * en los bordes de la caja. `drag` es la fricción por segundo (0 = sin fricción).
   */
  update(
    dt: number,
    attractor: Attractor | null,
    width: number,
    height: number,
    depth: number,
    drag = 0.55,
  ): void {
    if (dt <= 0) return;
    const damp = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.count; i++) {
      if (attractor) {
        const dist = gravitate(
          this.acc,
          this.x[i],
          this.y[i],
          this.z[i],
          attractor,
          REF_SOFTENING,
        );
        const radialMag = Math.hypot(this.acc.x, this.acc.y);
        addSwirl(this.acc, this.x[i], this.y[i], attractor, radialMag);
        // z tiende suave a 0 cuando hay atractor (el disco se aplana hacia la mano).
        this.acc.z += -this.z[i] * 0.6;
        void dist;
        this.vx[i] = (this.vx[i] + this.acc.x * dt) * damp;
        this.vy[i] = (this.vy[i] + this.acc.y * dt) * damp;
        this.vz[i] = (this.vz[i] + this.acc.z * dt) * damp;
      } else {
        // Deriva libre con damping muy suave.
        const d2 = Math.max(0, 1 - drag * 0.25 * dt);
        this.vx[i] *= d2;
        this.vy[i] *= d2;
        this.vz[i] *= d2;
      }

      // Tope de velocidad (estabilidad numérica). Comparamos al cuadrado y sólo
      // sacamos la raíz si hace falta capar → un sqrt menos por partícula/frame.
      const spSq =
        this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i] + this.vz[i] * this.vz[i];
      if (spSq > MAX_SPEED * MAX_SPEED) {
        const k = MAX_SPEED / Math.sqrt(spSq);
        this.vx[i] *= k;
        this.vy[i] *= k;
        this.vz[i] *= k;
      }

      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;

      // Rebote suave en los bordes de la caja (mantiene el campo encuadrado).
      if (this.x[i] < 0) {
        this.x[i] = 0;
        this.vx[i] = Math.abs(this.vx[i]) * 0.6;
      } else if (this.x[i] > width) {
        this.x[i] = width;
        this.vx[i] = -Math.abs(this.vx[i]) * 0.6;
      }
      if (this.y[i] < 0) {
        this.y[i] = 0;
        this.vy[i] = Math.abs(this.vy[i]) * 0.6;
      } else if (this.y[i] > height) {
        this.y[i] = height;
        this.vy[i] = -Math.abs(this.vy[i]) * 0.6;
      }
      if (this.z[i] < -depth) {
        this.z[i] = -depth;
        this.vz[i] = Math.abs(this.vz[i]) * 0.6;
      } else if (this.z[i] > depth) {
        this.z[i] = depth;
        this.vz[i] = -Math.abs(this.vz[i]) * 0.6;
      }
    }
  }

  /** Empuja todas las partículas radialmente desde un punto (burst al soltar). */
  burst(cx: number, cy: number, speed: number): void {
    for (let i = 0; i < this.count; i++) {
      const dx = this.x[i] - cx;
      const dy = this.y[i] - cy;
      const d = Math.hypot(dx, dy) || 1;
      this.vx[i] += (dx / d) * speed;
      this.vy[i] += (dy / d) * speed;
      this.vz[i] += (Math.random() * 2 - 1) * speed * 0.4;
    }
  }
}
