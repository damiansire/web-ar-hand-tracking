/**
 * Vista de módulo del contrato de mensajes main <-> worker de inferencia.
 *
 * La declaración vive UNA sola vez en `worker-protocol.d.ts` (ambiente global,
 * porque el worker es un script clásico y no puede importar). Este archivo sólo
 * la re-expone con nombres de módulo para el hilo principal, así no existe una
 * segunda transcripción que pueda driftear.
 */

/** Mensajes que el hilo principal envía al worker. */
export type WorkerRequest = WorkerRequestMessage;

/** Mensajes que el worker devuelve al hilo principal. */
export type WorkerResponse = WorkerResponseMessage;

/** Landmark normalizado tal como viaja por el MessageChannel. */
export type WireLandmark = WorkerLandmark;
