/**
 * Cliente del worker de inferencia para el hilo principal.
 *
 * Se encarga de: arrancar el worker, capturar cuadros del <video> como
 * `ImageBitmap` (transferibles, sin copia), aplicar back-pressure (un solo
 * cuadro en vuelo) y entregar los últimos landmarks vía callback.
 */
import type { NormalizedLandmark } from "../domain/hand-tracking";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { MEDIAPIPE } from "../config";
import { supportsGpuDelegate } from "../domain/platform";
import { BackPressure } from "./back-pressure";
import { RollingStats } from "../domain/perf-metrics";

/** Snapshot de latencia de inferencia (ida y vuelta al worker), en ms. */
export interface InferenceLatencyStats {
  readonly count: number;
  readonly meanMs: number;
  readonly p95Ms: number;
}

export type HandsListener = (hands: NormalizedLandmark[][]) => void;

/**
 * Inyectables para test: una fábrica de `Worker` fake y un `createImageBitmap`
 * stub. En producción se usan los reales (Worker clásico + global del browser),
 * así no cambia el comportamiento.
 */
export interface HandTrackerDeps {
  /** Fábrica del Worker (cada llamada debe devolver una instancia nueva). */
  createWorker?: () => Worker;
  /** Captura del cuadro como ImageBitmap (por defecto el global del browser). */
  createImageBitmap?: typeof createImageBitmap;
}

export class HandTracker {
  private worker!: Worker;
  // Back-pressure de un solo cuadro en vuelo (lógica pura testeada).
  private gate = new BackPressure();
  private ready = false;
  private disposed = false;
  private listener: HandsListener | null = null;
  private readonly workerFactory: () => Worker;
  private readonly captureBitmap: typeof createImageBitmap;
  /** Delegate efectivamente usado, para diagnóstico. */
  delegate: "GPU" | "CPU" | null = null;
  // Latencia real de inferencia (ida-y-vuelta al worker), medida con
  // `performance.now()`: se marca `inflightSentAt` justo antes del
  // `postMessage` del cuadro y se cierra la muestra al recibir el resultado
  // (o el error) correspondiente. El back-pressure de un solo cuadro en vuelo
  // (`BackPressure`) garantiza que no hay ambigüedad de a qué envío
  // corresponde cada respuesta. Ventana de 120 muestras (~4s a 30fps).
  private readonly latency = new RollingStats(120);
  private inflightSentAt: number | null = null;

  constructor(deps: HandTrackerDeps = {}) {
    // Worker clásico (sin `type: "module"`): el worker no tiene imports ESM y
    // carga MediaPipe con `importScripts`. Ver nota en el archivo del worker.
    this.workerFactory =
      deps.createWorker ??
      (() => new Worker(new URL("./hand-landmarker.worker.ts", import.meta.url)));
    this.captureBitmap = deps.createImageBitmap ?? createImageBitmap;
    this.createWorker();
  }

  private createWorker(): void {
    this.worker = this.workerFactory();
  }

  /**
   * Arranca el worker y resuelve cuando el modelo quedó cargado. Intenta GPU
   * primero; si no responde a tiempo (algunos navegadores cuelgan el worker con
   * el delegate GPU), recrea el worker y reintenta forzando CPU.
   */
  init(): Promise<void> {
    return this.attempt(false, 15000).catch(() => {
      this.worker.terminate(); // pudo quedar colgado en la init de GPU
      this.createWorker();
      this.gate.reset(); // worker nuevo: no hay nada en vuelo
      return this.attempt(true, 30000);
    });
  }

  private attempt(forceCpu: boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        clearTimeout(timer);
      };
      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Worker error: ${e.message || "no se pudo cargar el worker"}`));
      };
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.type === "ready") {
          if (settled) return;
          settled = true;
          cleanup();
          this.ready = true;
          this.delegate = msg.delegate;
          this.worker.addEventListener("message", this.onResult);
          resolve();
        } else if (msg.type === "init-error") {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(msg.message));
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("timeout"));
      }, timeoutMs);
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      const req: WorkerRequest = {
        type: "init",
        bundleUrl: MEDIAPIPE.bundle,
        wasmBase: MEDIAPIPE.wasmBase,
        modelUrl: MEDIAPIPE.handLandmarkerModel,
        forceCpu,
        // Gate por navegador (la lógica testeada): el worker confirma luego con
        // su `hasWebGl2()` real, por eso acá asumimos WebGL2 presente. `navigator`
        // es global del browser pero no existe en Node < 21 (donde corren los
        // tests): lo guardamos para no romper fuera del browser.
        allowGpu: supportsGpuDelegate(
          typeof navigator !== "undefined" ? navigator.userAgent : "",
          true,
        ),
      };
      this.worker.postMessage(req);
    });
  }

  onHands(listener: HandsListener): void {
    this.listener = listener;
  }

  /**
   * Envía un cuadro del video al worker. Si todavía hay uno procesándose,
   * lo descarta (mejor saltear cuadros que acumular latencia).
   */
  async track(source: HTMLVideoElement, timestamp: number): Promise<void> {
    if (!this.ready || !this.gate.tryAcquire()) return; // dropea si hay uno en vuelo
    const vw = source.videoWidth;
    const vh = source.videoHeight;
    if (!vw || !vh) {
      this.gate.release(); // todavía no hay cuadro de video: liberamos el gate
      return;
    }
    try {
      // Reducimos el cuadro a ~320px en el lado mayor (preservando aspecto)
      // antes de mandarlo al worker: el detector no necesita más resolución y
      // así abaratamos el createImageBitmap, la transferencia y el preprocesado.
      const scale = Math.min(1, 320 / Math.max(vw, vh));
      const bitmap = await this.captureBitmap(source, {
        resizeWidth: Math.round(vw * scale),
        resizeHeight: Math.round(vh * scale),
        resizeQuality: "low",
      });
      // Carrera con dispose(): si el tracker se descartó mientras esperábamos el
      // bitmap, NO lo posteamos a un worker muerto (se fugaría sin .close()).
      // Lo cerramos acá y soltamos el gate (K-2).
      if (this.disposed) {
        bitmap.close();
        this.gate.release();
        return;
      }
      const req: WorkerRequest = { type: "frame", bitmap, timestamp };
      this.inflightSentAt = performance.now();
      this.worker.postMessage(req, [bitmap]);
    } catch {
      this.inflightSentAt = null;
      this.gate.release();
    }
  }

  private onResult = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    if (msg.type === "result") {
      this.recordLatency();
      this.gate.release();
      this.listener?.(msg.hands);
    } else if (msg.type === "detect-error") {
      // El cuadro en vuelo falló en el worker: liberamos el back-pressure para
      // no quedar trabados, y dejamos que el próximo cuadro reintente. No
      // contabilizamos su latencia (no representa una detección real).
      this.inflightSentAt = null;
      this.gate.release();
    }
  };

  /** Cierra la muestra de latencia del cuadro en vuelo, si había uno. */
  private recordLatency(): void {
    if (this.inflightSentAt === null) return;
    this.latency.push(performance.now() - this.inflightSentAt);
    this.inflightSentAt = null;
  }

  /** Snapshot de la latencia de inferencia medida (ventana reciente), o `null` sin muestras. */
  getLatencyStats(): InferenceLatencyStats | null {
    if (this.latency.count === 0) return null;
    return { count: this.latency.count, meanMs: this.latency.mean, p95Ms: this.latency.p95() };
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
  }
}
