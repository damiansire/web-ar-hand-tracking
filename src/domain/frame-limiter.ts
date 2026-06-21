/**
 * Limitador de cadencia (Hz) puro y testeable: decide si ya pasó suficiente
 * tiempo desde el último cuadro aceptado para procesar uno nuevo a la tasa
 * objetivo. Desacopla la **inferencia** (cara: MediaPipe, el consumidor #1 de
 * CPU/GPU de la app) del **render** (60+ fps).
 *
 * Por qué: el detector de manos a 30 fps es perceptualmente idéntico a 60 fps
 * porque el suavizado predictivo One-Euro (ver `domain/smoothing`) interpola y
 * extrapola la posición entre updates. Correr la inferencia al doble de lo
 * necesario sólo calienta la GPU y le roba presupuesto al render. Capando la
 * inferencia a la tasa objetivo, en equipos capaces se libera ~la mitad del
 * trabajo de detección sin que se note en pantalla.
 *
 * Política "dropear, no encolar": al aceptar un cuadro se marca el tiempo real
 * (`last = now`), no `last += interval`. Así, tras una pausa (pestaña en
 * segundo plano, GC) NO se dispara una ráfaga de cuadros para "ponerse al día";
 * simplemente se retoma la cadencia desde el presente.
 *
 * Sin DOM ni Worker: el shell (`main`) lo consulta con el timestamp del cuadro.
 */

/**
 * Tolerancia: aceptamos un cuadro si pasó al menos `interval * (1 - SLACK)`. Sin
 * este margen, una fuente a la misma tasa que el objetivo (ej. cámara a 30 fps
 * con objetivo 30 fps) caería justo en el borde del intervalo y el jitter de
 * timestamps la dropearía un cuadro sí y otro no → la mitad de la tasa pedida.
 * Con un 10% de holgura la fuente a la tasa objetivo pasa siempre, y una al
 * doble (60→30) sigue cayendo limpia a la mitad.
 */
const SLACK = 0.1;

export class FrameRateLimiter {
  private threshold: number;
  private last = -Infinity;

  /** @param fps Tasa objetivo en cuadros/segundo. `<= 0` desactiva el límite. */
  constructor(fps: number) {
    this.threshold = thresholdFor(fps);
  }

  /**
   * ¿Procesar el cuadro con timestamp `now` (ms)? Devuelve `true` (y marca el
   * tiempo) si ya pasó el intervalo objetivo desde el último aceptado; `false`
   * para saltearlo. Sin límite (`fps <= 0`) siempre devuelve `true`.
   */
  shouldProcess(now: number): boolean {
    if (now - this.last >= this.threshold) {
      this.last = now;
      return true;
    }
    return false;
  }

  /** Cambia la tasa objetivo en caliente (ej. al ajustar calidad). */
  setFps(fps: number): void {
    this.threshold = thresholdFor(fps);
  }

  /** Reinicia: el próximo cuadro se acepta sí o sí. */
  reset(): void {
    this.last = -Infinity;
  }
}

function thresholdFor(fps: number): number {
  if (fps <= 0) return 0; // sin límite: cualquier `now - last >= 0` pasa
  return (1000 / fps) * (1 - SLACK);
}
