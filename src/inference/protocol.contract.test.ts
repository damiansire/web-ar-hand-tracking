import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { WorkerRequest, WorkerResponse, WireLandmark } from "./protocol";
import type { NormalizedLandmark } from "../domain/hand-tracking";

/**
 * El worker de inferencia es un script clásico (sin imports/exports) y antes eso
 * obligaba a transcribir el contrato de mensajes a mano en tres archivos. La
 * versión anterior de este test declaraba una CUARTA copia local y la comparaba
 * contra protocol.ts: vigilaba su propia copia, no al worker. Verificado en su
 * momento: agregar un campo requerido a `InitRequest` del worker dejaba `tsc` y
 * este test en verde.
 *
 * Hoy el contrato vive una sola vez en `worker-protocol.d.ts` (declaración
 * ambiente global) y tanto el worker como `protocol.ts` lo consumen, así que el
 * drift es imposible por construcción: un campo nuevo rompe la compilación del
 * emisor (hand-tracker.ts) y del receptor (el worker) a la vez.
 *
 * Este archivo gatea las dos cosas que eso NO garantiza solo:
 *  1. que `protocol.ts` siga siendo un alias del contrato ambiente y no vuelva a
 *     ser una transcripción, y
 *  2. que el tipo que viaja por el cable siga siendo estructuralmente el
 *     `NormalizedLandmark` del dominio (el consumidor final de `hands`).
 * Más un chequeo mecánico de que el worker no reintroduzca una copia propia.
 */

// Equivalencia estructural bidireccional (A extends B y B extends A). Si alguna
// dirección falla, el tipo evalúa a `never` y la línea de abajo no compila.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// `WorkerRequestMessage`/`WorkerResponseMessage`/`WorkerLandmark` son los globales
// ambiente que consume el worker; los de la izquierda, lo que exporta protocol.ts.
const _reqIsAmbient: Equal<WorkerRequest, WorkerRequestMessage> = true;
const _resIsAmbient: Equal<WorkerResponse, WorkerResponseMessage> = true;
const _landmarkIsAmbient: Equal<WireLandmark, WorkerLandmark> = true;
// El cable y el dominio tienen que hablar del mismo landmark: `hands` se entrega
// tal cual a `HandsListener`, tipado con el `NormalizedLandmark` del dominio.
const _landmarkMatchesDomain: Equal<WireLandmark, NormalizedLandmark> = true;

const WORKER_SOURCE = readFileSync(
  new URL("./hand-landmarker.worker.ts", import.meta.url),
  "utf8",
);

describe("contrato worker ↔ protocol", () => {
  it("protocol.ts y el dominio comparten el contrato ambiente, sin copias", () => {
    // El verdadero check es de compilación (arriba); el assert existe para que el
    // test corra en runtime y los `const` no queden como no usados.
    expect(
      _reqIsAmbient && _resIsAmbient && _landmarkIsAmbient && _landmarkMatchesDomain,
    ).toBe(true);
  });

  it("el worker no reintroduce su propia transcripción del contrato", () => {
    // Una copia local volvería a habilitar el drift silencioso que este test
    // existe para cerrar. Los tipos del contrato se declaran SÓLO en
    // worker-protocol.d.ts.
    const redeclarations = [
      /\binterface\s+WorkerInitRequest\b/,
      /\binterface\s+WorkerFrameRequest\b/,
      /\binterface\s+WorkerLandmark\b/,
      /\btype\s+WorkerRequestMessage\b/,
      /\btype\s+WorkerResponseMessage\b/,
    ].filter((re) => re.test(WORKER_SOURCE));
    expect(redeclarations).toEqual([]);
  });

  it("el worker sigue siendo un script clásico (sin import/export)", () => {
    // Si dejara de serlo, `importScripts` deja de existir y MediaPipe no carga;
    // además el contrato ambiente dejaría de estar visible sin import.
    expect(/^\s*(import|export)\s/m.test(WORKER_SOURCE)).toBe(false);
  });
});
