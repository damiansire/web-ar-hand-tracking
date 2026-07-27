/**
 * Contrato de mensajes main <-> worker de inferencia, declarado UNA sola vez.
 *
 * Por qué acá y no en `protocol.ts`: `hand-landmarker.worker.ts` es un worker
 * CLÁSICO y no puede tener `import`/`export` (esbuild lo envolvería como módulo
 * y MediaPipe dejaría de cargar con `importScripts`). Antes eso se resolvía
 * transcribiendo el contrato a mano en tres archivos (worker, protocol.ts y el
 * test), con un test de contrato que en realidad comparaba dos de esas copias y
 * no al worker: el drift pasaba en verde.
 *
 * Un `.d.ts` sin imports es una declaración AMBIENTE global: el worker la ve sin
 * escribir un `import` (sigue siendo script clásico), `protocol.ts` la re-exporta
 * como tipos de módulo y ya no hay copias que sincronizar. Un cambio de esquema
 * acá rompe la compilación del emisor y del receptor a la vez.
 *
 * Los nombres llevan prefijo `Worker` a propósito: al ser globales, un
 * `NormalizedLandmark` suelto ensombrecería al del dominio en todo el proyecto.
 */

/** Landmark normalizado tal como viaja por el MessageChannel (0..1 por eje). */
interface WorkerLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Arranque del worker: URLs de los assets de MediaPipe y gate de delegate. */
interface WorkerInitRequest {
  type: "init";
  bundleUrl: string;
  /**
   * Hash SRI (`sha256-<base64>`) que el bundle debe cumplir para ejecutarse. El
   * worker aborta si no coincide: se ejecuta codigo de terceros en el mismo
   * contexto que los cuadros de la camara, asi que la rama por defecto DENIEGA.
   */
  bundleSha256: string;
  wasmBase: string;
  modelUrl: string;
  forceCpu: boolean;
  /**
   * El hilo principal ya resolvió la parte de la decisión que depende del
   * navegador (WebKit<17 fuerza CPU) con `supportsGpuDelegate` de
   * ../domain/platform; el worker sólo lo combina con su `hasWebGl2()` local.
   */
  allowGpu: boolean;
}

/** Un cuadro de cámara transferido (sin copia) para detectar. */
interface WorkerFrameRequest {
  type: "frame";
  bitmap: ImageBitmap;
  timestamp: number;
}

/** Mensajes que el hilo principal envía al worker. */
type WorkerRequestMessage = WorkerInitRequest | WorkerFrameRequest;

/** Mensajes que el worker devuelve al hilo principal. */
type WorkerResponseMessage =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | { type: "init-error"; message: string }
  | { type: "detect-error"; timestamp: number; message: string }
  | { type: "result"; timestamp: number; hands: WorkerLandmark[][] };
