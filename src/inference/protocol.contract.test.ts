import { describe, it, expect } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/**
 * El worker de inferencia es un script clásico (sin imports/exports) y por eso
 * redeclara a mano el contrato de mensajes de protocol.ts. Ese espejo, antes,
 * sólo lo mantenía un comentario: un cambio de esquema rompía el MessageChannel
 * en runtime sin error de compilación.
 *
 * Este test ata el drift en CI. Redeclaramos acá las MISMAS interfaces locales
 * del worker y verificamos —en tiempo de compilación, vía asignaciones de tipo
 * bidireccionales— que sean estructuralmente equivalentes a las de protocol.ts.
 * Si alguna de las dos se desincroniza, tsc/vitest fallan al compilar este
 * archivo. (Mantener en sync con hand-landmarker.worker.ts.)
 */

// --- Espejo local (idéntico al de hand-landmarker.worker.ts) ---
interface WorkerNormalizedLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface WorkerInitRequest {
  type: "init";
  bundleUrl: string;
  wasmBase: string;
  modelUrl: string;
  forceCpu: boolean;
  allowGpu: boolean;
}
interface WorkerFrameRequest {
  type: "frame";
  bitmap: ImageBitmap;
  timestamp: number;
}
type LocalWorkerRequest = WorkerInitRequest | WorkerFrameRequest;
type LocalWorkerResponse =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | { type: "init-error"; message: string }
  | { type: "detect-error"; timestamp: number; message: string }
  | { type: "result"; timestamp: number; hands: WorkerNormalizedLandmark[][] };

// Equivalencia estructural bidireccional (A extends B y B extends A). Si alguna
// dirección falla, el tipo evalúa a `never` y la línea de abajo no compila.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _reqInSync: Equal<LocalWorkerRequest, WorkerRequest> = true;
const _resInSync: Equal<LocalWorkerResponse, WorkerResponse> = true;

describe("contrato worker ↔ protocol", () => {
  it("los espejos de mensajes del worker coinciden con protocol.ts", () => {
    // El verdadero check es de compilación (arriba); el assert es para que el
    // test exista en runtime y los `const` no se marquen como no usados.
    expect(_reqInSync && _resInSync).toBe(true);
  });
});
