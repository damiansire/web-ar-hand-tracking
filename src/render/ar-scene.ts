/**
 * Escena de Three.js que dibuja las figuras 3D como overlay transparente sobre
 * el video. Usa una cámara ortográfica mapeada 1:1 a píxeles de pantalla
 * (origen arriba-izquierda, Y hacia abajo) para posicionar la figura
 * directamente con las coordenadas que devuelve `landmarkToScreen`.
 *
 * Renderer: `WebGPURenderer` (de `three/webgpu`) con materiales de nodos (TSL).
 * El mismo renderer corre sobre el backend WebGPU si el navegador lo soporta
 * (`navigator.gpu`) o cae automáticamente al backend **WebGL2** vía
 * `forceWebGL: true`. Los node-materials y el `InstancedMesh` funcionan igual en
 * ambos backends, así que hay un único camino de render.
 *
 * Las figuras se dibujan con `InstancedMesh`: una sola geometría/material para N
 * manos → 1 draw call para todas las figuras (+1 para sus sombras), en vez de un
 * `Mesh` por mano. Los bordes (opcionales, off por defecto) usan un pool chico
 * de `LineSegments` porque la topología de líneas no se instancia trivialmente.
 *
 * Hot loop near-zero-alloc: las escrituras de transform reusan un `Matrix4`/
 * `Quaternion`/`Euler`/`Vector3` y structs `target`/`corner` preasignados; no se
 * crean objetos por frame ni por figura.
 */
import {
  AmbientLight,
  DirectionalLight,
  OrthographicCamera,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import { BloomCompositor } from "./bloom-compositor";
import { FigureRenderer } from "./figure-renderer";
import { PerfGovernor, initialTierIndex } from "../domain/perf-governor";
import type { FigureKind } from "../domain/figures";
import type { NormalizedLandmark } from "../domain/hand-tracking";
import type { ExperienceKind } from "../domain/experiences";
import { createExperience, type Experience, type ExperienceContext } from "./experiences";
import type { ControlsState } from "../ui/ar-controls";

export class ARScene {
  private renderer: WebGPURenderer;
  private scene = new Scene();
  private camera: OrthographicCamera;
  /** Backend efectivo, para diagnóstico ("webgpu" o "webgl"). */
  readonly backend: "webgpu" | "webgl";

  // Post-proceso de bloom (glow): colaborador que encapsula el pipeline TSL y la
  // composición de alpha para el overlay transparente sobre el video (ver
  // `BloomCompositor`). ARScene sólo lo habilita por tier y le delega el present.
  private bloom = new BloomCompositor();

  // Calidad adaptativa: baja resolución/bloom/partículas si el FPS cae (y sube si
  // sobra), para ir fluido en cualquier equipo. `dprCap` es el tope de
  // devicePixelRatio del tier actual; lo aplica `resize()`.
  private governor: PerfGovernor;
  private dprCap = 2;

  /** Canvas efectivamente usado (puede diferir si hubo fallback de WebGPU a WebGL2). */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** FPS suavizado (EMA) que ya calcula el governor de calidad, para diagnóstico/perf. */
  get fps(): number {
    return this.governor.fps;
  }

  // Renderer de las figuras 3D (pool de InstancedMesh + sombras + bordes + oclusor
  // + hot-loop de colocación). ARScene le delega el modo "Figuras" y le reenvía los
  // setters de material; ver `FigureRenderer`.
  private figureRenderer: FigureRenderer;

  private figure: FigureKind = "cube";
  private hands: NormalizedLandmark[][] = [];
  private occlusionEnabled = true;

  // Controles ajustables por el usuario.
  private mirrored = true;
  private sizeScale = 1;
  private rotationSpeed = 1;
  private spin = 0; // ángulo acumulado (rad), para no saltar al cambiar la velocidad
  private lastTime = 0;
  private edgesEnabled = false;
  private shadowEnabled = false;
  private multiHand = false;
  private running = false;

  // Experiencia creativa activa (null = modo "figuras" clásico).
  private experienceKind: ExperienceKind = "figuras";
  private experience: Experience | null = null;
  private currentColor = "#f45e61";
  private timeAcc = 0; // tiempo acumulado (s) para animar las experiencias
  private onHud: ((text: string | null) => void) | null = null;
  private onContextLost: (() => void) | null = null;
  // Contexto reusado por frame (alloc-free) que se pasa a la experiencia.
  private expCtx: ExperienceContext = {
    hands: [],
    width: 0,
    height: 0,
    mirrored: true,
    dt: 0,
    time: 0,
    color: "#f45e61",
  };

  /**
   * Construcción: usar `await ARScene.create(canvas)` en vez del constructor.
   * `WebGPURenderer` requiere `await renderer.init()` antes de renderizar, lo que
   * no se puede hacer en un constructor síncrono.
   */
  private constructor(canvas: HTMLCanvasElement, preferWebGPU: boolean) {
    this.renderer = new WebGPURenderer({
      canvas,
      alpha: true,
      antialias: true,
      forceWebGL: !preferWebGPU, // sin WebGPU → backend WebGL2
    });
    this.backend = preferWebGPU ? "webgpu" : "webgl";
    this.renderer.setClearColor(0x000000, 0); // fondo transparente: se ve el video
    const { clientWidth: w, clientHeight: h } = canvas;
    this.camera = new OrthographicCamera(0, w, 0, h, -1000, 1000);

    this.scene.add(new AmbientLight(0xffffff, 0.85));
    const key = new DirectionalLight(0xffffff, 1.1);
    key.position.set(0.5, -1, 1);
    this.scene.add(key);

    this.figureRenderer = new FigureRenderer(this.scene);

    // Tier inicial conservador según el dispositivo; el governor lo ajusta en vivo.
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    this.governor = new PerfGovernor(
      initialTierIndex({
        mobile: /Mobi|Android|iPhone|iPad|iPod/i.test(ua),
        cores: (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4,
        hasWebGPU: typeof navigator !== "undefined" && "gpu" in navigator,
      }),
    );
    this.dprCap = this.governor.tier.pixelRatioCap;
    this.bloom.setEnabled(this.governor.tier.bloom);

    this.resize();
    this.registerContextLossHandling(canvas);
  }

  /**
   * Escucha `webglcontextlost` sobre el canvas real del renderer (backend WebGL2;
   * en WebGPU el evento simplemente nunca dispara, así que el listener es
   * inofensivo). Antes, una pérdida de contexto sólo se manifestaba como una
   * excepción silenciosa dentro del loop de `frame()` (canvas congelado, sin
   * aviso). Ahora frenamos el loop explícitamente y avisamos vía
   * `setContextLostListener` para que el shell degrade a un estado claro (mismo
   * patrón que el fallback de cámara denegada), en vez de dejar la escena en un
   * estado indefinido.
   */
  private registerContextLossHandling(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault(); // evita que el navegador descarte el contexto para siempre
      this.stop();
      this.onContextLost?.();
    });
  }

  /** Registra el callback que se dispara al perder el contexto WebGL del canvas. */
  setContextLostListener(cb: () => void): void {
    this.onContextLost = cb;
  }

  /**
   * Crea la escena eligiendo backend: intenta WebGPU (`navigator.gpu`); si no hay
   * adapter o la init de WebGPU falla, reintenta con backend WebGL2. Inicializa
   * el renderer (async) antes de devolver.
   */
  static async create(canvas: HTMLCanvasElement): Promise<ARScene> {
    const preferWebGPU = await ARScene.detectWebGPU();
    if (preferWebGPU) {
      try {
        const scene = new ARScene(canvas, true);
        await scene.renderer.init();
        scene.bloom.init(scene.renderer, scene.scene, scene.camera);
        return scene;
      } catch {
        // El adapter existía pero la init de WebGPU falló (driver, feature, etc.).
        // El canvas ya tomó un contexto WebGPU y no se puede reusar para WebGL2,
        // así que lo reemplazamos por uno fresco en el DOM antes de reintentar.
        canvas = replaceCanvas(canvas);
      }
    }
    const scene = new ARScene(canvas, false);
    await scene.renderer.init();
    scene.bloom.init(scene.renderer, scene.scene, scene.camera);
    return scene;
  }

  /** ¿El navegador puede entregar un adapter WebGPU? (no fuerza el backend solo). */
  private static async detectWebGPU(): Promise<boolean> {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) return false;
    try {
      const adapter = await gpu.requestAdapter();
      return adapter !== null;
    } catch {
      return false;
    }
  }

  /** Aplica el tier de calidad actual del governor (resolución, bloom, partículas). */
  private applyTier(): void {
    const t = this.governor.tier;
    this.dprCap = t.pixelRatioCap;
    this.bloom.setEnabled(t.bloom);
    this.resize();
    this.experience?.setQuality?.(t.particleScale);
  }

  /** Compone el frame (bloom en modos de "luz", directo en figuras). */
  private present(): void {
    this.bloom.present(this.renderer, this.scene, this.camera, this.experience !== null);
  }

  setFigure(kind: FigureKind): void {
    if (kind === this.figure) return;
    this.figure = kind;
    this.figureRenderer.setFigure(kind);
  }

  setHands(hands: NormalizedLandmark[][]): void {
    this.hands = hands;
  }

  /** Activa/desactiva la oclusión (figura por detrás al dar vuelta la mano). */
  setOcclusion(enabled: boolean): void {
    this.occlusionEnabled = enabled;
  }

  /** Vista espejada (selfie). Debe coincidir con el espejado CSS del video. */
  setMirrored(mirrored: boolean): void {
    this.mirrored = mirrored;
  }

  /** Multiplicador de tamaño de la figura (1 = tamaño base). */
  setSize(scale: number): void {
    this.sizeScale = scale;
  }

  /** Multiplicador de velocidad de giro (0 = quieta, 1 = normal). */
  setSpeed(speed: number): void {
    this.rotationSpeed = speed;
  }

  /** Color de la figura (acepta cualquier color CSS, ej. "#f45e61"). */
  setColor(color: string): void {
    this.figureRenderer.setColor(color);
    this.currentColor = color; // también tiñe la experiencia activa
  }

  /**
   * Cambia la experiencia activa. "figuras" vuelve al modo clásico (sin
   * Experience); el resto crea el efecto, lo agrega a la escena y dispone el
   * anterior. Idempotente si ya está en ese modo.
   */
  setExperience(kind: ExperienceKind): void {
    if (kind === this.experienceKind) return;
    this.experienceKind = kind;
    if (this.experience) {
      this.scene.remove(this.experience.object);
      this.experience.dispose();
      this.experience = null;
    }
    const exp = createExperience(kind);
    if (exp) {
      this.experience = exp;
      this.scene.add(exp.object);
      exp.setQuality?.(this.governor.tier.particleScale); // hereda el presupuesto actual
    }
    // Si volvemos a "figuras", el frame re-muestra el pipeline solo (figureRenderer).
    this.onHud?.(null);
  }

  /** Registra un callback para el HUD del modo (ej. el puntaje). */
  setHudListener(cb: (text: string | null) => void): void {
    this.onHud = cb;
  }

  /** Muestra/oculta el relleno de las caras (deja las aristas visibles). */
  setFaces(enabled: boolean): void {
    this.figureRenderer.setFaces(enabled);
  }

  /** Opacidad de la figura (0 = transparente, 1 = sólida). */
  setOpacity(opacity: number): void {
    this.figureRenderer.setOpacity(opacity);
  }

  /** Modo malla: dibuja sólo las aristas de los triángulos, sin caras. */
  setWireframe(enabled: boolean): void {
    this.figureRenderer.setWireframe(enabled);
  }

  /** Metalización del material (0 = mate, 1 = metálico). */
  setMetalness(value: number): void {
    this.figureRenderer.setMetalness(value);
  }

  /** Rugosidad del material (0 = espejado, 1 = difuso). */
  setRoughness(value: number): void {
    this.figureRenderer.setRoughness(value);
  }

  /** Muestra/oculta las aristas (bordes) de la figura. */
  setEdges(enabled: boolean): void {
    this.edgesEnabled = enabled;
    this.figureRenderer.setEdges(enabled);
  }

  /** Color de las aristas. */
  setEdgeColor(color: string): void {
    this.figureRenderer.setEdgeColor(color);
  }

  /** Sombra (blob) proyectada bajo la figura. */
  setShadow(enabled: boolean): void {
    this.shadowEnabled = enabled;
  }

  /** Dibujar figuras en todas las manos detectadas (hasta el tope). */
  setMultiHand(enabled: boolean): void {
    this.multiHand = enabled;
  }

  /**
   * Aplica de una sola vez todo el estado de los controles a la escena. Es el
   * único contrato UI→render: agregar un control nuevo es mapear su campo acá (no
   * cablear un setter suelto desde main.ts). Los campos de fondo (`bgEnabled`/
   * `bgColor`) NO son de la escena —los maneja el shell sobre el DOM del video— y
   * por eso no se tocan acá.
   */
  applyControls(c: ControlsState): void {
    this.setSize(c.size);
    this.setSpeed(c.speed);
    this.setColor(c.color);
    this.setFaces(c.faces);
    this.setOpacity(c.opacity);
    this.setMetalness(c.metalness);
    this.setRoughness(c.roughness);
    this.setWireframe(c.wireframe);
    this.setEdges(c.edges);
    this.setEdgeColor(c.edgeColor);
    this.setShadow(c.shadow);
    this.setMultiHand(c.multiHand);
    this.setOcclusion(c.occlusion);
    this.setMirrored(c.mirrored);
  }

  /** Ajusta el renderer y la cámara al tamaño real del canvas. */
  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 480;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.dprCap));
    this.renderer.setSize(w, h, false);
    this.camera.right = w;
    this.camera.bottom = h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /**
   * Fuerza un render sincrónico para que el contenido del canvas sea legible
   * justo a continuación (para "sacar la foto"). Evita depender de
   * `preserveDrawingBuffer` (que ya no existe en WebGPURenderer y costaba una
   * copia por frame en WebGL — P-1 resuelto): se renderiza explícitamente y se
   * lee el canvas en el mismo tick.
   */
  renderForCapture(): HTMLCanvasElement {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }

  private frame(time: number): void {
    const w = this.renderer.domElement.clientWidth || 640;
    const h = this.renderer.domElement.clientHeight || 480;
    const dt = this.lastTime ? (time - this.lastTime) / 1000 : 0;
    this.lastTime = time;
    this.timeAcc += dt;

    // Calidad adaptativa: si el FPS cambió de tier, reaplicamos calidad.
    if (this.governor.sample(dt)) this.applyTier();

    // Modo experiencia creativa: ocultamos el pipeline de figuras y delegamos el
    // frame en la experiencia activa (que maneja sus propios objetos en la escena).
    if (this.experience) {
      this.figureRenderer.hide();
      const ctx = this.expCtx;
      ctx.hands = this.hands;
      ctx.width = w;
      ctx.height = h;
      ctx.mirrored = this.mirrored;
      ctx.dt = dt;
      ctx.time = this.timeAcc;
      ctx.color = this.currentColor;
      this.experience.update(ctx);
      this.onHud?.(this.experience.hud());
      this.present();
      return;
    }

    // Acumulamos el ángulo (rad/s) en vez de derivarlo de `time`, así cambiar
    // la velocidad no produce un salto brusco en la rotación.
    this.spin += dt * this.rotationSpeed;
    this.figureRenderer.frame(
      {
        hands: this.hands,
        figure: this.figure,
        mirrored: this.mirrored,
        sizeScale: this.sizeScale,
        spin: this.spin,
        dt,
        time,
        multiHand: this.multiHand,
        edgesEnabled: this.edgesEnabled,
        shadowEnabled: this.shadowEnabled,
        occlusionEnabled: this.occlusionEnabled,
      },
      w,
      h,
    );

    this.present();
  }

  dispose(): void {
    this.stop();
    this.bloom.dispose();
    if (this.experience) {
      this.scene.remove(this.experience.object);
      this.experience.dispose();
      this.experience = null;
    }
    this.figureRenderer.dispose();
    this.renderer.dispose();
  }
}

/**
 * Reemplaza un canvas tainted (que ya tomó un contexto WebGPU) por un clon fresco
 * en su misma posición del DOM, copiando id/clases/atributos. Devuelve el nuevo
 * canvas para que el renderer WebGL2 pueda tomar su contexto sin conflicto.
 */
function replaceCanvas(old: HTMLCanvasElement): HTMLCanvasElement {
  const fresh = document.createElement("canvas");
  fresh.id = old.id;
  fresh.className = old.className;
  fresh.width = old.width;
  fresh.height = old.height;
  for (const { name, value } of Array.from(old.attributes)) {
    if (name !== "id" && name !== "class") fresh.setAttribute(name, value);
  }
  old.replaceWith(fresh);
  return fresh;
}
