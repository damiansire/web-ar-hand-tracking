import { describe, it, expect, vi } from "vitest";
import { HandTracker } from "./hand-tracker";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/**
 * Worker fake inyectable: ejerce la orquestación REAL de HandTracker (ruteo de
 * mensajes, init→ready, timeouts, release del gate) sin browser ni MediaPipe.
 * Captura los mensajes posteados y permite emitir respuestas del "worker".
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: WorkerRequest[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(msg: WorkerRequest): void {
    this.posted.push(msg);
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Emite un mensaje del worker hacia el hilo principal. */
  emit(data: WorkerResponse): void {
    for (const cb of this.listeners.get("message") ?? []) cb({ data });
  }

  /** Emite un error del worker. */
  emitError(message: string): void {
    for (const cb of this.listeners.get("error") ?? []) cb({ message });
  }
}

function makeTracker(captureBitmap?: typeof createImageBitmap, now?: () => number) {
  FakeWorker.instances = [];
  const tracker = new HandTracker({
    createWorker: () => new FakeWorker() as unknown as Worker,
    createImageBitmap: captureBitmap ?? (vi.fn() as unknown as typeof createImageBitmap),
    ...(now ? { now } : {}),
  });
  return { tracker, worker: () => FakeWorker.instances.at(-1)! };
}

/** Tracker ya inicializado (init + ready), con el 'init' descartado de `posted`. */
async function readyTracker(
  captureBitmap?: typeof createImageBitmap,
  now?: () => number,
) {
  const { tracker, worker } = makeTracker(captureBitmap, now);
  const started = tracker.init();
  worker().emit({ type: "ready", delegate: "GPU" });
  await started;
  const w = worker();
  w.posted.length = 0;
  return { tracker, worker: w };
}

/** <video> mínimo con tamaño válido para que track() intente capturar. */
function fakeVideo(): HTMLVideoElement {
  return { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
}

/** Bitmap fake con close() espiable. */
function fakeBitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
  };
}

describe("HandTracker", () => {
  it("init: postea 'init' y resuelve al recibir 'ready'", async () => {
    const { tracker, worker } = makeTracker();
    const ready = tracker.init();
    const w = worker();
    expect(w.posted[0]?.type).toBe("init");
    w.emit({ type: "ready", delegate: "GPU" });
    await expect(ready).resolves.toBeUndefined();
    expect(tracker.delegate).toBe("GPU");
  });

  it("init: timeout de GPU → recrea worker y reintenta forzando CPU", async () => {
    vi.useFakeTimers();
    try {
      const { tracker } = makeTracker();
      const ready = tracker.init();
      const first = FakeWorker.instances[0]!;
      // No respondemos: dejamos vencer el timeout de GPU (15s).
      await vi.advanceTimersByTimeAsync(15000);
      expect(first.terminated).toBe(true);
      // Se recreó un worker nuevo para el reintento CPU.
      expect(FakeWorker.instances.length).toBe(2);
      const second = FakeWorker.instances[1]!;
      const initReq = second.posted[0];
      expect(initReq?.type).toBe("init");
      expect(initReq && "forceCpu" in initReq && initReq.forceCpu).toBe(true);
      second.emit({ type: "ready", delegate: "CPU" });
      await expect(ready).resolves.toBeUndefined();
      expect(tracker.delegate).toBe("CPU");
    } finally {
      vi.useRealTimers();
    }
  });

  it("init: 'init-error' en GPU reintenta CPU; 'init-error' también ahí → rechaza", async () => {
    const { tracker } = makeTracker();
    const ready = tracker.init();
    // Primer intento (GPU) falla: dispara el reintento forzando CPU.
    FakeWorker.instances[0]!.emit({ type: "init-error", message: "gpu boom" });
    await Promise.resolve(); // deja correr el .catch que recrea el worker
    expect(FakeWorker.instances.length).toBe(2);
    // Segundo intento (CPU) también falla: ahora sí rechaza.
    FakeWorker.instances[1]!.emit({ type: "init-error", message: "cpu boom" });
    await expect(ready).rejects.toThrow("cpu boom");
  });

  it("track(): dropea (no postea frame) si el gate está ocupado", async () => {
    const capture = vi.fn(async () =>
      fakeBitmap(),
    ) as unknown as typeof createImageBitmap;
    const { tracker, worker } = makeTracker(capture);
    const r = tracker.init();
    worker().emit({ type: "ready", delegate: "GPU" });
    await r;
    const w = worker();
    w.posted.length = 0; // descartamos el 'init'

    // Primer track toma el gate; el bitmap no se resolvió aún → sigue en vuelo.
    void tracker.track(fakeVideo(), 1);
    // Segundo track con el gate ocupado: debe dropear sin llamar a capture otra vez.
    await tracker.track(fakeVideo(), 2);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("track(): si createImageBitmap rechaza, libera el gate (el próximo track reintenta)", async () => {
    const capture = vi
      .fn()
      .mockRejectedValueOnce(new Error("captura falló"))
      .mockResolvedValueOnce(fakeBitmap()) as unknown as typeof createImageBitmap;
    const { tracker, worker } = makeTracker(capture);
    const r = tracker.init();
    worker().emit({ type: "ready", delegate: "GPU" });
    await r;

    await tracker.track(fakeVideo(), 1); // rechaza → catch libera el gate
    await tracker.track(fakeVideo(), 2); // gate libre → vuelve a capturar
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("dispose() durante el await del bitmap: lo cierra, libera el gate y NO lo postea", async () => {
    const bitmap = fakeBitmap();
    let resolveCapture!: (b: ImageBitmap) => void;
    const capture = vi.fn(
      () => new Promise<ImageBitmap>((res) => (resolveCapture = res)),
    ) as unknown as typeof createImageBitmap;
    const { tracker, worker } = makeTracker(capture);
    const r = tracker.init();
    worker().emit({ type: "ready", delegate: "GPU" });
    await r;
    const w = worker();
    w.posted.length = 0;

    const tracking = tracker.track(fakeVideo(), 1);
    tracker.dispose(); // carrera: se descarta el tracker mientras esperamos el bitmap
    resolveCapture(bitmap);
    await tracking;

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    // No se posteó ningún 'frame' a un worker muerto.
    expect(w.posted.some((m) => m.type === "frame")).toBe(false);
  });

  it("result: libera el gate y entrega los landmarks al listener", async () => {
    const capture = vi.fn(async () =>
      fakeBitmap(),
    ) as unknown as typeof createImageBitmap;
    const { tracker, worker } = makeTracker(capture);
    const r = tracker.init();
    worker().emit({ type: "ready", delegate: "GPU" });
    await r;
    const w = worker();
    w.posted.length = 0;

    const hands: number[] = [];
    tracker.onHands(() => hands.push(1));

    await tracker.track(fakeVideo(), 1); // postea frame, gate ocupado
    expect(w.posted.some((m) => m.type === "frame")).toBe(true);

    const landmarks = [[{ x: 0.1, y: 0.2, z: 0 }]];
    w.emit({ type: "result", timestamp: 1, hands: landmarks });
    expect(hands).toEqual([1]); // listener notificado

    // Gate liberado: el próximo track vuelve a postear.
    w.posted.length = 0;
    await tracker.track(fakeVideo(), 2);
    expect(w.posted.some((m) => m.type === "frame")).toBe(true);
  });

  it("detect-error: libera el gate sin notificar al listener", async () => {
    const capture = vi.fn(async () =>
      fakeBitmap(),
    ) as unknown as typeof createImageBitmap;
    const { tracker, worker } = makeTracker(capture);
    const r = tracker.init();
    worker().emit({ type: "ready", delegate: "GPU" });
    await r;
    const w = worker();
    w.posted.length = 0;

    let notified = false;
    tracker.onHands(() => (notified = true));

    await tracker.track(fakeVideo(), 1);
    w.emit({ type: "detect-error", timestamp: 1, message: "fallo" });
    expect(notified).toBe(false);

    // Gate liberado pese al error: el próximo track vuelve a postear.
    w.posted.length = 0;
    await tracker.track(fakeVideo(), 2);
    expect(w.posted.some((m) => m.type === "frame")).toBe(true);
  });
});

/**
 * El gate de back-pressure no expira por diseño: sólo lo libera la respuesta del
 * worker. Si el worker se muere DESPUÉS del `ready` (abort de WASM, cuelgue del
 * delegate GPU, pérdida del contexto WebGL dentro del worker) esa respuesta no
 * llega nunca y el gate queda tomado de por vida: la cámara sigue prendida, el
 * render sigue a 60fps y la figura queda clavada, sin ningún error. Ese es el
 * modo de falla que estos tests cubren.
 */
describe("HandTracker: watchdog y señalización de fallos", () => {
  const captureOk = () =>
    vi.fn(async () => fakeBitmap()) as unknown as typeof createImageBitmap;

  it("un worker que nunca responde no deja el gate tomado para siempre", async () => {
    let clock = 0;
    const capture = captureOk();
    const { tracker, worker } = await readyTracker(capture, () => clock);

    await tracker.track(fakeVideo(), 1); // toma el gate; el worker no contesta
    expect(worker.posted.filter((m) => m.type === "frame")).toHaveLength(1);

    // Dentro de la ventana del watchdog el cuadro se sigue considerando en vuelo.
    clock = 1500;
    await tracker.track(fakeVideo(), 2);
    expect(worker.posted.filter((m) => m.type === "frame")).toHaveLength(1);

    // Pasada la ventana, el cuadro se da por perdido y el pipeline sigue.
    clock = 3000;
    await tracker.track(fakeVideo(), 3);
    expect(worker.posted.filter((m) => m.type === "frame")).toHaveLength(2);
    expect(tracker.getHealth().stalls).toBe(1);
  });

  it("tras varios cuadros perdidos seguidos avisa al shell con un mensaje accionable", async () => {
    let clock = 0;
    const { tracker } = await readyTracker(captureOk(), () => clock);
    const failures: string[] = [];
    tracker.onInferenceFailure((m) => failures.push(m));

    for (let i = 0; i < 4; i++) {
      await tracker.track(fakeVideo(), i);
      clock += 3000; // cada cuadro vence el watchdog
    }

    expect(failures).toHaveLength(1); // avisa una sola vez, no floodea
    expect(failures[0]).toContain("Recargá");
  });

  it("un 'error' del worker después del ready libera el gate y avisa", async () => {
    const capture = captureOk();
    const { tracker, worker } = await readyTracker(capture);
    const failures: string[] = [];
    tracker.onInferenceFailure((m) => failures.push(m));

    await tracker.track(fakeVideo(), 1);
    worker.posted.length = 0;
    worker.emitError("wasm abort");

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("wasm abort");
    expect(tracker.getHealth().lastError).toBe("wasm abort");
    // Gate liberado: el pipeline no queda trabado por el worker muerto.
    await tracker.track(fakeVideo(), 2);
    expect(worker.posted.some((m) => m.type === "frame")).toBe(true);
  });

  it("detect-error: cuenta la racha, la expone y avisa recién si no corta", async () => {
    const capture = captureOk();
    const { tracker, worker } = await readyTracker(capture);
    const failures: string[] = [];
    tracker.onInferenceFailure((m) => failures.push(m));

    for (let i = 0; i < 29; i++) {
      await tracker.track(fakeVideo(), i);
      worker.emit({ type: "detect-error", timestamp: i, message: "detect boom" });
    }
    expect(tracker.getHealth().consecutiveDetectErrors).toBe(29);
    expect(tracker.getHealth().lastError).toBe("detect boom");
    expect(failures).toHaveLength(0); // todavía no es una avería

    await tracker.track(fakeVideo(), 29);
    worker.emit({ type: "detect-error", timestamp: 29, message: "detect boom" });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("detect boom");
  });

  it("un resultado bueno corta la racha de errores", async () => {
    const capture = captureOk();
    const { tracker, worker } = await readyTracker(capture);

    await tracker.track(fakeVideo(), 1);
    worker.emit({ type: "detect-error", timestamp: 1, message: "boom" });
    expect(tracker.getHealth().consecutiveDetectErrors).toBe(1);

    await tracker.track(fakeVideo(), 2);
    worker.emit({ type: "result", timestamp: 2, hands: [] });
    expect(tracker.getHealth().consecutiveDetectErrors).toBe(0);
  });
});
