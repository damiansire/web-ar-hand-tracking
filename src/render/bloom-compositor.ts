/**
 * Compositor de bloom (glow) para el overlay transparente sobre el video.
 *
 * Encapsula el pipeline de post-proceso TSL (NO `UnrealBloomPass`, que no soporta
 * fondo transparente): compone el glow sumándolo al color de la escena y reusando
 * el alpha de la escena, así el canvas sigue siendo overlay del video. Si la init
 * falla (backend/versión), queda `post = null` y se renderiza directo (nunca
 * negro).
 *
 * Vive separado de `ARScene` para que la complejidad de la composición de alpha y
 * el anti pile-up de renders async (backend WebGPU) sea testeable/legible en un
 * solo lugar, y `ARScene` quede como orquestador delgado.
 */
import {
  RenderPipeline,
  type OrthographicCamera,
  type Scene,
  type WebGPURenderer,
} from "three/webgpu";
import { pass, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

export class BloomCompositor {
  // Pipeline de bloom. `null` si falló la init → render directo.
  private post: RenderPipeline | null = null;
  private enabled = true;
  private inFlight = false; // evita encolar renders de bloom (anti pile-up)

  /**
   * Arma el pipeline de bloom (TSL): glow del color de la escena sumado de vuelta
   * al color. Si algo falla, deja `post = null` y se renderiza directo (sin glow,
   * pero nunca negro). Se llama tras `renderer.init()`.
   */
  init(renderer: WebGPURenderer, scene: Scene, camera: OrthographicCamera): void {
    try {
      const scenePass = pass(scene, camera);
      const bloomPass = bloom(scenePass, 0.9, 0.5, 0.0);
      // CLAVE para el overlay sobre video: por defecto el post-proceso saca alpha=1
      // (canvas opaco → tapa el video de negro). Componemos a mano: glow sumado al
      // color, y alpha = max(alpha de la escena, brillo del glow). Así las zonas sin
      // partículas ni glow quedan transparentes (se ve el video) y el glow se
      // compone como luz translúcida encima.
      const rgb = scenePass.add(bloomPass);
      const glowLum = bloomPass.r.max(bloomPass.g).max(bloomPass.b);
      const alpha = scenePass.a.max(glowLum).clamp(0, 1);
      const post = new RenderPipeline(renderer);
      post.outputNode = vec4(rgb.rgb, alpha);
      this.post = post;
    } catch {
      this.post = null; // sin bloom: render directo
    }
  }

  /** Habilita/inhabilita el glow (lo decide el tier del governor de calidad). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Render del frame. El bloom se aplica SOLO en modos de "luz" (`hasExperience`):
   * ahí el glow es el efecto buscado y todo lo que se dibuja es emisivo. En el modo
   * "Figuras" (geometría sólida con oclusión) se rendea directo, porque la
   * composición de alpha del bloom volvería el sólido semi-transparente.
   * `post.render()` puede ser async (backend WebGPU): lo envolvemos con un guard
   * que descarta el frame si hay uno en vuelo (no bloquea ni encola en backends
   * lentos como SwiftShader).
   */
  present(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: OrthographicCamera,
    hasExperience: boolean,
  ): void {
    const useBloom = this.post !== null && this.enabled && hasExperience;
    if (useBloom) {
      if (this.inFlight) return;
      this.inFlight = true;
      void Promise.resolve(this.post!.render()).finally(() => {
        this.inFlight = false;
      });
    } else {
      renderer.render(scene, camera);
    }
  }

  dispose(): void {
    this.post?.dispose();
    this.post = null;
  }
}
