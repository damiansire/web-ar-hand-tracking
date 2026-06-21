/// <reference lib="webworker" />
/**
 * Web Worker de inferencia (worker CLÁSICO, autocontenido).
 *
 * Acá vive el trabajo pesado: cargar MediaPipe, el modelo de manos y correr la
 * detección cuadro a cuadro. Al estar en un worker, el hilo principal queda
 * libre para capturar la cámara y renderizar con Three.js sin jank (era el
 * "main thread blocking" del repo original).
 *
 * Decisiones clave (a propósito):
 *  - MediaPipe se carga con `importScripts` desde su bundle CJS. MediaPipe
 *    necesita `importScripts`, que NO existe en workers de tipo módulo (de ahí
 *    el clásico error "ModuleFactory not set").
 *  - El archivo NO tiene `import`/`export`: así esbuild lo trata como script
 *    clásico (sin envoltorio de módulo) y funciona igual en el dev server de
 *    Vite y en el build. Por eso los tipos van inline en vez de importados.
 */

// --- Contrato de mensajes (espejo de ./protocol.ts; ver nota arriba) ---
interface InitRequest {
  type: "init";
  bundleUrl: string;
  wasmBase: string;
  modelUrl: string;
  forceCpu: boolean;
  // El hilo principal ya resolvió el gate por navegador (WebKit<17 → CPU) con la
  // lógica testeada de ../domain/platform; acá sólo lo combinamos con el
  // `hasWebGl2()` local del worker.
  allowGpu: boolean;
}
interface FrameRequest {
  type: "frame";
  bitmap: ImageBitmap;
  timestamp: number;
}
type WorkerRequest = InitRequest | FrameRequest;

// --- Respuestas del worker (espejo de WorkerResponse en ./protocol.ts) ---
// Tipadas para que cada post() valide su forma en compilación. El test
// protocol.contract.test.ts asserta estructuralmente que este espejo y el de
// protocol.ts no se desincronicen.
interface NormalizedLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
type WorkerResponse =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | { type: "init-error"; message: string }
  | { type: "detect-error"; timestamp: number; message: string }
  | { type: "result"; timestamp: number; hands: NormalizedLandmark[][] };

// Interfaz mínima de lo que usamos de MediaPipe, en vez de `any`. El bundle CJS
// no trae tipos en este worker clásico, pero acotamos la superficie que tocamos.
interface HandLandmarkerLike {
  detectForVideo(
    bitmap: ImageBitmap,
    timestamp: number,
  ): { landmarks?: NormalizedLandmark[][] };
}
interface MediaPipeModule {
  FilesetResolver: { forVisionTasks(wasmBase: string): Promise<unknown> };
  HandLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<HandLandmarkerLike>;
  };
}

let landmarker: HandLandmarkerLike | null = null;

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer ?? []);
}

async function loadMediaPipe(bundleUrl: string): Promise<MediaPipeModule> {
  // El bundle .cjs del CDN se sirve con Content-Type `application/node`, que el
  // navegador rechaza en `importScripts` (exige un MIME de JavaScript). Lo
  // bajamos con fetch (CORS habilitado) y lo cargamos desde un Blob URL
  // mismo-origen con MIME correcto.
  const code = await fetch(bundleUrl).then((r) => {
    if (!r.ok) throw new Error(`No se pudo descargar MediaPipe (${r.status}).`);
    return r.text();
  });
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  // Shim de CommonJS: el bundle es CJS y asigna a `module.exports`. Acotamos el
  // cast al global del worker a esta forma mínima (CJS module shim), sin `any`.
  const g = self as unknown as { module: { exports: unknown }; exports: unknown };
  g.module = { exports: {} };
  g.exports = g.module.exports;
  try {
    importScripts(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  return g.module.exports as MediaPipeModule;
}

/** ¿Hay un contexto WebGL2 vía OffscreenCanvas en este worker? */
function hasWebGl2(): boolean {
  try {
    return !!new OffscreenCanvas(1, 1).getContext("webgl2");
  } catch {
    return false;
  }
}

async function init(
  bundleUrl: string,
  wasmBase: string,
  modelUrl: string,
  forceCpu: boolean,
  allowGpu: boolean,
): Promise<void> {
  const mp = await loadMediaPipe(bundleUrl);
  const fileset = await mp.FilesetResolver.forVisionTasks(wasmBase);
  // GPU es mucho más rápido, pero en algunos navegadores el delegate GPU dentro
  // de un worker cuelga el hilo. El hilo principal ya resolvió el gate por
  // navegador (`allowGpu`, lógica testeada en ../domain/platform); acá lo
  // combinamos con el `hasWebGl2()` real del worker y con `forceCpu` (un intento
  // previo de GPU que no respondió a tiempo).
  const delegate = !forceCpu && allowGpu && hasWebGl2() ? "GPU" : "CPU";
  landmarker = await mp.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: "VIDEO",
    numHands: 2,
  });
  post({ type: "ready", delegate });
}

function detect(bitmap: ImageBitmap, timestamp: number): void {
  if (!landmarker) {
    bitmap.close();
    return;
  }
  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    post({ type: "result", timestamp, hands: result.landmarks ?? [] });
  } catch (err: unknown) {
    // Si la detección falla (pérdida de contexto WebGL, OOM/WASM, bitmap
    // inválido) avisamos al cliente para que baje `busy`; si no, el
    // back-pressure se trabaría para siempre y la detección se congelaría.
    post({
      type: "detect-error",
      timestamp,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // Liberamos el bitmap siempre, haya o no detección, para no perder memoria.
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      init(msg.bundleUrl, msg.wasmBase, msg.modelUrl, msg.forceCpu, msg.allowGpu).catch(
        (err: unknown) => {
          post({
            type: "init-error",
            message: err instanceof Error ? err.message : String(err),
          });
        },
      );
      break;
    case "frame":
      detect(msg.bitmap, msg.timestamp);
      break;
    default: {
      // Guard de exhaustividad: un WorkerRequest nuevo sin manejar falla la
      // compilación en vez de ignorarse silenciosamente.
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
};
