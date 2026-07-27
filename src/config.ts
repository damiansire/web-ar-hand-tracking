/**
 * Configuración centralizada de los assets de MediaPipe.
 *
 * Se cargan desde el CDN oficial de jsDelivr, fijados a la versión exacta del
 * paquete `@mediapipe/tasks-vision` instalado. Si en el futuro se quieren
 * self-hostear, basta con copiar el directorio `wasm` y el `.task` a `public/`
 * y cambiar estas dos URLs por rutas locales.
 *
 * El paquete npm NO se importa desde ningún módulo: existe sólo para fijar y
 * auditar (`npm audit`) la versión que el worker baja del CDN en runtime. Por eso
 * `package.json` lo declara con versión EXACTA (sin caret) y `config.test.ts`
 * asserta que esta constante y la del manifest coincidan: con caret, un bump de
 * Dependabot movía lo auditado y dejaba intacto lo ejecutado, en silencio.
 */
export const TASKS_VISION_VERSION = "0.10.35";

/**
 * Hash del bundle que el worker está autorizado a ejecutar, en formato SRI.
 *
 * El bundle se baja con `fetch` y se ejecuta desde un Blob URL, camino en el que
 * el atributo `integrity` de `<script>` no aplica: el pin de versión fija QUÉ se
 * pide, no QUÉ llega. Sin esta comprobación, cualquier respuesta 200 del CDN se
 * ejecutaba en el mismo contexto que los cuadros de la cámara (fail-open), lo que
 * choca de frente con la promesa de privacidad del README.
 *
 * El valor es el SHA-256 del archivo del paquete npm instalado (jsDelivr sirve
 * ese archivo tal cual, byte a byte); `config.test.ts` lo recalcula desde
 * `node_modules` y falla si difiere, así que no puede quedar viejo en silencio.
 * Para regenerarlo tras un bump: `node scripts/pin-mediapipe-digest.mjs`.
 */
export const MEDIAPIPE_BUNDLE_SHA256 =
  "sha256-f7pPmAcpfiKTcTGN9Xfpb8nxs9k+eQdeN5it4vx5DJ4=";

export const MEDIAPIPE = {
  /**
   * Bundle CJS de MediaPipe que el worker carga con `importScripts`. Se usa un
   * worker clásico (no módulo) porque MediaPipe necesita `importScripts`, que no
   * existe en un worker de tipo módulo.
   */
  bundle: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/vision_bundle.cjs`,
  /** Hash esperado de `bundle` (ver `MEDIAPIPE_BUNDLE_SHA256`). */
  bundleSha256: MEDIAPIPE_BUNDLE_SHA256,
  /** Fileset WASM (SIMD / no-SIMD) que resuelve MediaPipe en runtime. */
  wasmBase: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`,
  /** Modelo de detección de manos (float16, 1 mano). */
  handLandmarkerModel:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
} as const;
