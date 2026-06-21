/**
 * Buffer circular de puntos de trazo (x, y, edad) sobre arrays tipados, puro y
 * alloc-free. Reemplaza el patrón `Array.push`/`shift` (que aloca un objeto por
 * punto y reindexa O(n) en cada `shift`) por escrituras O(1) sin asignaciones,
 * en línea con el estándar de hot-loop del resto del repo (ver `particle-field`).
 *
 * Los puntos se guardan en orden temporal: el índice lógico 0 es el más viejo y
 * `count-1` el más nuevo. Cuando el buffer se llena, `push` pisa el más viejo
 * (avanza la cabeza), igual que un trazo que se desvanece por el frente.
 *
 * Sin DOM ni Three.js: el render (draw-experience) lee `x`/`y`/`age` por índice.
 */
export class Trail {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly age: Float32Array;
  private head = 0; // índice físico del punto más viejo
  private _count = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity | 0);
    this.x = new Float32Array(this.capacity);
    this.y = new Float32Array(this.capacity);
    this.age = new Float32Array(this.capacity);
  }

  /** Cantidad de puntos vivos. */
  get count(): number {
    return this._count;
  }

  /** Índice físico del i-ésimo punto lógico (0 = más viejo). */
  index(i: number): number {
    return (this.head + i) % this.capacity;
  }

  /**
   * Agrega un punto (edad 0). Si el buffer está lleno, descarta el más viejo
   * (avanza la cabeza) para hacerle lugar. O(1), sin asignaciones.
   */
  push(x: number, y: number): void {
    const slot = (this.head + this._count) % this.capacity;
    this.x[slot] = x;
    this.y[slot] = y;
    this.age[slot] = 0;
    if (this._count < this.capacity) {
      this._count++;
    } else {
      this.head = (this.head + 1) % this.capacity; // lleno: pisamos el más viejo
    }
  }

  /**
   * Envejece todos los puntos `dt` segundos y descarta por el frente (los más
   * viejos) los que superan `lifetime`. Como los puntos van en orden temporal,
   * basta avanzar la cabeza mientras el más viejo esté vencido.
   */
  advance(dt: number, lifetime: number): void {
    for (let i = 0; i < this._count; i++) {
      this.age[this.index(i)] += dt;
    }
    while (this._count > 0 && this.age[this.head] > lifetime) {
      this.head = (this.head + 1) % this.capacity;
      this._count--;
    }
  }

  /** X del punto más nuevo (sólo válido si `count > 0`). */
  lastX(): number {
    return this.x[(this.head + this._count - 1) % this.capacity];
  }

  /** Y del punto más nuevo (sólo válido si `count > 0`). */
  lastY(): number {
    return this.y[(this.head + this._count - 1) % this.capacity];
  }

  /** Vacía el trazo (sin liberar los arrays). */
  clear(): void {
    this.head = 0;
    this._count = 0;
  }
}
