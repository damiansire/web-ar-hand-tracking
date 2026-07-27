/**
 * Máquina de estados de la aplicación (pura, sin DOM).
 *
 * Reemplaza el enrutado ad-hoc del código original, donde cada evento hacía
 * `app.innerHTML = ...` y recreaba componentes aunque la pantalla no cambiara.
 * Acá el estado es un valor inmutable y `transition` es una función pura, así
 * la UI sólo re-renderiza cuando el status realmente cambia.
 */
export type AppStatus =
  | "requesting-permission"
  | "permission-denied"
  | "loading-model"
  | "ready"
  | "error";

export interface AppState {
  readonly status: AppStatus;
  /** Mensaje de error para mostrar en la pantalla de error. */
  readonly error?: string;
}

export type AppEvent =
  | { type: "PERMISSION_GRANTED" }
  | { type: "PERMISSION_DENIED" }
  | { type: "MODEL_LOADED" }
  | { type: "MODEL_ERROR"; message: string }
  | { type: "CONTEXT_LOST"; message: string }
  /** La inferencia dejó de funcionar de forma persistente (worker mudo o caído). */
  | { type: "INFERENCE_FAILED"; message: string }
  | { type: "RETRY" };

export const INITIAL_STATE: AppState = { status: "requesting-permission" };

export function transition(state: AppState, event: AppEvent): AppState {
  switch (state.status) {
    case "requesting-permission":
      if (event.type === "PERMISSION_GRANTED") return { status: "loading-model" };
      if (event.type === "PERMISSION_DENIED") return { status: "permission-denied" };
      return state;

    case "permission-denied":
      if (event.type === "RETRY") return { status: "requesting-permission" };
      return state;

    case "loading-model":
      if (event.type === "MODEL_LOADED") return { status: "ready" };
      if (event.type === "MODEL_ERROR") return { status: "error", error: event.message };
      return state;

    case "error":
      if (event.type === "RETRY") return { status: "requesting-permission" };
      return state;

    case "ready":
      // Pérdida de contexto WebGL/WebGPU (driver reset, OOM de GPU, crash del
      // proceso de GPU): degradamos a un estado explícito con mensaje, igual
      // que el resto de los fallos fatales, en vez de dejar la escena colgada
      // en un estado indefinido.
      if (event.type === "CONTEXT_LOST") return { status: "error", error: event.message };
      // Mismo criterio para la inferencia: si el worker se murió o la detección
      // falla en bucle, la app está "viva pero ciega". Un estado de error con
      // mensaje es mejor que una figura clavada sin explicación.
      if (event.type === "INFERENCE_FAILED")
        return { status: "error", error: event.message };
      return state;

    default: {
      // Guard de exhaustividad: si se agrega un AppStatus nuevo sin manejarlo,
      // esto falla la compilación en vez de silenciarlo con `return state`.
      const _exhaustive: never = state.status;
      void _exhaustive;
      return state;
    }
  }
}
