/**
 * Detección de pérdida de dispositivo GPU, para el backend WebGPU.
 *
 * El repo ya frenaba el loop ante `webglcontextlost`, pero ese evento SÓLO existe
 * en WebGL: en WebGPU nunca dispara. Y WebGPU es el backend por defecto en
 * Chrome/Edge modernos, o sea que el camino más usado no tenía ninguna detección:
 * una suspensión del equipo, una actualización de driver o un TDR de Windows
 * dejaban el canvas congelado con la cámara prendida y sin aviso, mientras el
 * loop seguía llamando a `render()` sobre un device muerto.
 *
 * WebGPU expone esto como `device.lost`, una promesa que se resuelve (no rechaza)
 * cuando el dispositivo se pierde. Acá se lee del backend del renderer con
 * validación en runtime en vez de asumir la forma: `renderer.backend` es interno
 * de Three y puede no existir (backend WebGL2, versión distinta), así que la
 * ausencia se reporta como `false` y el caller sigue con lo que ya tenía.
 */

/** Info que WebGPU entrega al perder el dispositivo (sólo lo que se usa acá). */
interface DeviceLostInfo {
  readonly reason?: string;
  readonly message?: string;
}

function asPromiseLike(value: unknown): PromiseLike<unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const then: unknown = (value as { then?: unknown }).then;
  return typeof then === "function" ? (value as PromiseLike<unknown>) : null;
}

/**
 * Engancha `onLost` a la promesa `device.lost` del backend, si existe.
 * Devuelve `true` si quedó vigilado (backend WebGPU con device), `false` si no
 * hay nada que vigilar, para que el caller pueda distinguir "no aplica" de
 * "aplicaba y falló".
 */
export function watchDeviceLost(
  backend: unknown,
  onLost: (message: string) => void,
): boolean {
  if (typeof backend !== "object" || backend === null) return false;
  const device: unknown = (backend as { device?: unknown }).device;
  if (typeof device !== "object" || device === null) return false;
  const lost = asPromiseLike((device as { lost?: unknown }).lost);
  if (!lost) return false;

  void lost.then(
    (info: unknown) => onLost(describeLoss(info)),
    // `device.lost` se resuelve, no rechaza; el rechazo se cubre igual para no
    // dejar una promesa sin manejar si algún backend se aparta de la spec.
    () => onLost("Se perdió el dispositivo GPU."),
  );
  return true;
}

function describeLoss(info: unknown): string {
  if (typeof info !== "object" || info === null) return "Se perdió el dispositivo GPU.";
  const { reason, message } = info as DeviceLostInfo;
  const detail = typeof message === "string" && message !== "" ? message : reason;
  return typeof detail === "string" && detail !== ""
    ? `Se perdió el dispositivo GPU (${detail}).`
    : "Se perdió el dispositivo GPU.";
}
