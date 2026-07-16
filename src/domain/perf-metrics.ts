/**
 * Estadística simple de una serie de muestras (ms), pura y sin dependencias de
 * DOM/Worker. La usa `HandTracker` para acumular la latencia real de cada
 * ida-y-vuelta al worker de inferencia (ver `hand-tracker.ts`), medida con
 * `performance.now()` en el punto de envío y de recepción del resultado.
 *
 * Buffer circular acotado (`capacity`): sólo importa la ventana reciente (la
 * app corre indefinidamente; acumular todo el historial sería una fuga).
 */
export class RollingStats {
  private samples: number[] = [];

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error("capacity debe ser > 0");
  }

  push(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get count(): number {
    return this.samples.length;
  }

  get mean(): number {
    if (this.samples.length === 0) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  /** Percentil 95 (interpolación simple sobre las muestras ordenadas). */
  p95(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  }

  reset(): void {
    this.samples = [];
  }
}
