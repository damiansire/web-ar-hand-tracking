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
 *    Vite y en el build.
 *
 * El contrato de mensajes NO se transcribe acá: vive una sola vez en
 * `worker-protocol.d.ts` como declaración ambiente global, que este script ve sin
 * `import` y que `protocol.ts` re-exporta para el hilo principal. Antes había tres
 * copias a mano y el "test de contrato" comparaba dos que no incluían a esta.
 *
 * Los tipos internos de MediaPipe llevan prefijo `Mp` porque, al ser un script
 * clásico, toda declaración de este archivo es global para el proyecto.
 */

// Interfaz mínima de lo que usamos de MediaPipe, en vez de `any`. El bundle CJS
// no trae tipos en este worker clásico, pero acotamos la superficie que tocamos.
interface MpHandLandmarker {
  detectForVideo(
    bitmap: ImageBitmap,
    timestamp: number,
  ): { landmarks?: WorkerLandmark[][] };
}
interface MpModule {
  FilesetResolver: { forVisionTasks(wasmBase: string): Promise<unknown> };
  HandLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<MpHandLandmarker>;
  };
}

let landmarker: MpHandLandmarker | null = null;

function post(message: WorkerResponseMessage, transfer?: Transferable[]): void {
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer ?? []);
}

/** Digest SHA-256 del texto, en formato SRI (`sha256-<base64>`). */
async function sha256Sri(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  // Se copia a un ArrayBuffer propio en vez de asertar el tipo del buffer que
  // devuelve TextEncoder (puede ser compartido): una sola copia, en la init.
  const data = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(data).set(encoded);
  const digest = await crypto.subtle.digest("SHA-256", data);
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

async function loadMediaPipe(
  bundleUrl: string,
  expectedSha256: string,
): Promise<MpModule> {
  // El bundle .cjs del CDN se sirve con Content-Type `application/node`, que el
  // navegador rechaza en `importScripts` (exige un MIME de JavaScript). Lo
  // bajamos con fetch (CORS habilitado) y lo cargamos desde un Blob URL
  // mismo-origen con MIME correcto.
  const code = await fetch(bundleUrl).then((r) => {
    if (!r.ok) throw new Error(`No se pudo descargar MediaPipe (${r.status}).`);
    return r.text();
  });
  // Integridad ANTES de ejecutar. Este es el unico punto de la app donde corre
  // codigo de terceros, y lo hace en el mismo contexto que los cuadros de la
  // camara: el pin de version fija QUE se pide, no QUE llega, y el atributo
  // `integrity` de <script> no aplica a este camino (fetch + Blob). Un CDN
  // comprometido, un TLS interceptado o un republish del paquete se ejecutaban
  // sin una sola comprobacion. La rama por defecto DENIEGA.
  const actual = await sha256Sri(code);
  if (actual !== expectedSha256) {
    throw new Error(
      `El bundle de MediaPipe no coincide con su hash esperado (${expectedSha256}; recibido ${actual}). No se ejecuta.`,
    );
  }
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
  return g.module.exports as MpModule;
}

/** ¿Hay un contexto WebGL2 vía OffscreenCanvas en este worker? */
function hasWebGl2(): boolean {
  try {
    return !!new OffscreenCanvas(1, 1).getContext("webgl2");
  } catch {
    return false;
  }
}

/**
 * Ejecuta UNA detección sintética para que el delegate compile sus kernels
 * ANTES de declarar el worker listo. La primera `detectForVideo` no es como
 * las demás: con delegate GPU compila los shaders del grafo completo (medido
 * en una Intel Iris Xe vía ANGLE/D3D11: 25-30 segundos, tanto en Chromium como
 * en Chrome real). Si ese costo cae DESPUÉS del `ready`, el watchdog del
 * cliente (STALL_MS en `hand-tracker.ts`) lo confunde con un worker muerto y
 * mata el pipeline con "Se detuvo la detección de manos": la app moría en esa
 * clase de hardware. Pagándolo acá, un delegate que no calienta dentro del
 * presupuesto de `HandTracker.init` dispara el timeout y el reintento
 * `forceCpu` — exactamente el fallback que ese timeout promete cubrir.
 *
 * El timestamp 1 es menor que cualquier `performance.now()` que manda el main
 * thread después, así que no rompe la monotonía que exige el running mode
 * VIDEO. Sin OffscreenCanvas no hay warmup (se degrada al comportamiento
 * previo); un fallo de la detección en sí SÍ se propaga, porque un delegate
 * que no puede inferir debe caer al camino de `init-error` → reintento CPU.
 */
function warmUp(lm: MpHandLandmarker): void {
  let bitmap: ImageBitmap;
  try {
    const canvas = new OffscreenCanvas(2, 2);
    if (!canvas.getContext("2d")) return;
    bitmap = canvas.transferToImageBitmap();
  } catch {
    return;
  }
  try {
    lm.detectForVideo(bitmap, 1);
  } finally {
    bitmap.close();
  }
}

async function init(
  bundleUrl: string,
  bundleSha256: string,
  wasmBase: string,
  modelUrl: string,
  forceCpu: boolean,
  allowGpu: boolean,
): Promise<void> {
  const mp = await loadMediaPipe(bundleUrl, bundleSha256);
  const fileset = await mp.FilesetResolver.forVisionTasks(wasmBase);
  // GPU es mucho más rápido, pero en algunos navegadores el delegate GPU dentro
  // de un worker cuelga el hilo. El hilo principal ya resolvió el gate por
  // navegador (`allowGpu`, lógica testeada en ../domain/platform); acá lo
  // combinamos con el `hasWebGl2()` real del worker y con `forceCpu` (un intento
  // previo de GPU que no respondió a tiempo).
  const delegate = !forceCpu && allowGpu && hasWebGl2() ? "GPU" : "CPU";
  const lm = await mp.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: "VIDEO",
    numHands: 2,
  });
  // El `ready` solo se emite con el pipeline CALIENTE: ver `warmUp`.
  warmUp(lm);
  landmarker = lm;
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

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      init(
        msg.bundleUrl,
        msg.bundleSha256,
        msg.wasmBase,
        msg.modelUrl,
        msg.forceCpu,
        msg.allowGpu,
      ).catch((err: unknown) => {
        post({
          type: "init-error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
      break;
    case "frame":
      detect(msg.bitmap, msg.timestamp);
      break;
    default: {
      // Guard de exhaustividad: un WorkerRequestMessage nuevo sin manejar falla la
      // compilación en vez de ignorarse silenciosamente.
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
};
