/**
 * Experiencia "Cosmos": una nebulosa de miles de partículas de polvo estelar que
 * orbitan la mano en 3D. La mano es un atractor gravitatorio (ver
 * `domain/particle-field`): con la mano presente las partículas se arremolinan a
 * su alrededor; al pellizcar se condensan en un núcleo brillante (planeta) y, al
 * soltar, estalla en un destello que las dispersa.
 *
 * Render: el campo (lógica pura) se vuelca a 3 capas de `InstancedMesh` (una por
 * tinte de la paleta cósmica: índigo, cian y el color del usuario) para dar
 * variedad de color con materiales de tinte uniforme (sin instanceColor). Cada
 * partícula escala por profundidad (`depthFactor`) → las cercanas se ven más
 * grandes; el bloom de la escena hace el resto del glow.
 */
import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  CircleGeometry,
  SphereGeometry,
} from "three/webgpu";
import { uniform, uv, vec2, smoothstep, oneMinus } from "three/tsl";
import {
  landmarkToScreenInto,
  ANCHOR_LANDMARK_INDEX,
  type MutScreenPoint,
} from "../../domain/hand-tracking";
import { FINGERTIPS, PinchDetector } from "../../domain/hand-gestures";
import { ParticleField, depthFactor, type Attractor } from "../../domain/particle-field";
import type { Experience, ExperienceContext } from "./experience";

const COUNT = 2600;
const DEPTH = 420; // mitad de la profundidad de la caja (z ∈ [-DEPTH, DEPTH])
const PLANET_R = 70; // radio objetivo del núcleo al pellizcar (px)
const FLASH = 0.6; // s que dura el destello al soltar

// Atractor: tirón/remolino suaves con la mano presente; fuertes al pellizcar.
const AMBIENT: Pick<Attractor, "strength" | "swirl"> = { strength: 2.2e6, swirl: 0.85 };
const PINCH: Pick<Attractor, "strength" | "swirl"> = { strength: 5.2e6, swirl: 1.35 };

const WHITE = new Color(0xffffff);

/** Uniform de color (nodo TSL); tipo derivado de una factory no genérica. */
const colorUniform = (hex: number) => uniform(new Color(hex));
type ColorUniform = ReturnType<typeof colorUniform>;

interface Layer {
  mesh: InstancedMesh;
  start: number;
  end: number;
  sizeMul: number;
  /** true = capa de acento (se tiñe con el color del usuario). */
  accent: boolean;
  color: ColorUniform;
}

/** Material de glow radial (círculo opaco al centro, se desvanece al borde). */
function glowMaterial(c: ColorUniform): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    side: DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  mat.colorNode = c;
  const d = uv().sub(vec2(0.5, 0.5)).length(); // 0 centro → ~0.5 borde
  mat.opacityNode = oneMinus(smoothstep(0.08, 0.5, d));
  return mat;
}

export class CosmicExperience implements Experience {
  readonly object = new Group();

  private field = new ParticleField(COUNT);
  private seeded = false;
  private geo = new CircleGeometry(1, 12);
  private layers: Layer[] = [];

  // Núcleo (planeta) + halo que crecen al pellizcar.
  private coreColor = colorUniform(0xf45e61);
  private coreMat: MeshStandardNodeMaterial;
  private core: Mesh;
  private haloColor = colorUniform(0xf45e61);
  private haloMat: MeshBasicNodeMaterial;
  private halo: Mesh;
  private coreR = 0;
  private cx = 0;
  private cy = 0;

  private pinch = new PinchDetector();
  private flashT = 0;

  private m = new Matrix4();
  private hidden = new Matrix4().makeScale(0, 0, 0);
  private scratch = new Color(); // Color reusable por frame (evita GC en el loop)
  private sp: MutScreenPoint = { x: 0, y: 0, z: 0 }; // scratch alloc-free por frame
  private midLm = { x: 0, y: 0, z: 0 }; // punto medio del pellizco (reusado)
  private qScale = 1; // fracción de partículas a dibujar (calidad adaptativa)

  constructor() {
    // 3 capas: índigo (bulk), cian (medio) y acento (color del usuario, más grande).
    const defs: { n: number; hex: number; sizeMul: number; accent: boolean }[] = [
      { n: 1300, hex: 0x4455dd, sizeMul: 1.0, accent: false }, // índigo
      { n: 800, hex: 0x3fd0ff, sizeMul: 1.1, accent: false }, // cian
      { n: 500, hex: 0xf45e61, sizeMul: 1.5, accent: true }, // acento (usuario)
    ];
    let cursor = 0;
    for (const def of defs) {
      const color = colorUniform(def.hex);
      const mesh = new InstancedMesh(this.geo, glowMaterial(color), def.n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < def.n; i++) mesh.setMatrixAt(i, this.hidden);
      mesh.instanceMatrix.needsUpdate = true;
      this.object.add(mesh);
      this.layers.push({
        mesh,
        start: cursor,
        end: cursor + def.n,
        sizeMul: def.sizeMul,
        accent: def.accent,
        color,
      });
      cursor += def.n;
    }

    // Núcleo iluminado por las luces de la escena (lee como esfera 3D) + un
    // emisivo suave para que igual "brille" como un astro. NO es emissive puro
    // (eso lo aplanaría); el sombreado difuso de la luz direccional da el volumen.
    this.coreMat = new MeshStandardNodeMaterial({ metalness: 0.3, roughness: 0.45 });
    this.coreMat.colorNode = this.coreColor;
    this.coreMat.emissiveNode = this.coreColor.mul(0.4);
    this.core = new Mesh(new SphereGeometry(1, 36, 24), this.coreMat);
    this.core.frustumCulled = false;
    this.core.visible = false;

    this.haloMat = glowMaterial(this.haloColor);
    this.halo = new Mesh(new CircleGeometry(1, 48), this.haloMat);
    this.halo.frustumCulled = false;
    this.halo.visible = false;

    this.object.add(this.halo, this.core);
  }

  update(ctx: ExperienceContext): void {
    const { width: w, height: h } = ctx;
    if (!this.seeded) {
      this.field.seed(w, h, DEPTH);
      this.seeded = true;
    }
    const dt = Math.min(ctx.dt, 0.05);

    // Paleta: la capa de acento + el núcleo + el halo siguen el color del usuario.
    const user = this.scratch.set(ctx.color); // reusa el Color de scratch (sin alocar)
    for (const l of this.layers) if (l.accent) l.color.value.copy(user);
    this.coreColor.value.copy(user);

    const hand = ctx.hands[0];
    const anchor = hand?.[ANCHOR_LANDMARK_INDEX];
    const wasPinching = this.pinch.pinching;
    const pinching = this.pinch.update(hand);

    // Punto del pellizco = medio entre punta de pulgar e índice.
    if (pinching && hand) {
      const a = hand[FINGERTIPS.thumb];
      const b = hand[FINGERTIPS.index];
      let mid: { x: number; y: number; z: number } | null = anchor;
      if (a && b) {
        this.midLm.x = (a.x + b.x) / 2;
        this.midLm.y = (a.y + b.y) / 2;
        this.midLm.z = 0;
        mid = this.midLm;
      }
      if (mid) {
        const p = landmarkToScreenInto(this.sp, mid, w, h, ctx.mirrored);
        this.cx = p.x;
        this.cy = p.y;
      }
    } else if (anchor) {
      const p = landmarkToScreenInto(this.sp, anchor, w, h, ctx.mirrored);
      this.cx = p.x;
      this.cy = p.y;
    }

    // Atractor: nulo sin mano; suave con mano; intenso al pellizcar.
    let attractor: Attractor | null = null;
    if (anchor) {
      const cfg = pinching ? PINCH : AMBIENT;
      attractor = {
        x: this.cx,
        y: this.cy,
        z: 0,
        strength: cfg.strength,
        swirl: cfg.swirl,
      };
    }

    // Flanco de bajada (soltar): destello + dispersión.
    if (wasPinching && !pinching) {
      this.flashT = FLASH;
      this.field.burst(this.cx, this.cy, 320);
    }

    this.field.update(dt, attractor, w, h, DEPTH);

    // Volcar el campo a las capas (cada una su rango de índices del campo). Sólo
    // dibujamos el presupuesto del tier (qScale): menos matrices por frame y menos
    // fill GPU en equipos lentos. Las que sobran las oculta `setQuality`.
    const f = this.field;
    for (const l of this.layers) {
      const drawn = Math.floor((l.end - l.start) * this.qScale);
      for (let local = 0; local < drawn; local++) {
        const i = l.start + local;
        const tw = f.size[i] * l.sizeMul * depthFactor(f.z[i], DEPTH);
        // z para orden de dibujo (cerca delante); x/y en píxeles de pantalla.
        this.m.makeScale(tw, tw, 1).setPosition(f.x[i], f.y[i], f.z[i] * 0.01);
        l.mesh.setMatrixAt(local, this.m);
      }
      l.mesh.instanceMatrix.needsUpdate = true;
    }

    // Núcleo (planeta) + halo: crece al pellizcar, pulsa al soltar.
    if (pinching) {
      this.coreR += (PLANET_R - this.coreR) * Math.min(1, dt * 6);
    } else if (this.flashT > 0) {
      this.flashT -= dt;
      const k = this.flashT / FLASH;
      this.coreR = PLANET_R * (1 + 1.8 * k);
    } else {
      this.coreR += (0 - this.coreR) * Math.min(1, dt * 8);
    }
    const visible = this.coreR > 1.5;
    this.core.visible = visible;
    this.halo.visible = visible;
    if (visible) {
      this.core.scale.setScalar(this.coreR);
      this.core.position.set(this.cx, this.cy, 8);
      // Halo atmosférico sutil (no debe tapar la esfera): más chico y sólo se
      // agranda en el destello al soltar.
      this.halo.scale.setScalar(this.coreR * (this.flashT > 0 ? 3.2 : 1.7));
      this.halo.position.set(this.cx, this.cy, 4);
      this.haloColor.value.copy(user).lerp(WHITE, 0.25);
    }
  }

  hud(): string | null {
    return null;
  }

  /** Presupuesto de partículas (calidad adaptativa): oculta las que sobran del tier. */
  setQuality(scale: number): void {
    this.qScale = Math.max(0.05, Math.min(1, scale));
    for (const l of this.layers) {
      const total = l.end - l.start;
      const drawn = Math.floor(total * this.qScale);
      for (let local = drawn; local < total; local++)
        l.mesh.setMatrixAt(local, this.hidden);
      l.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const l of this.layers) {
      (l.mesh.material as MeshBasicNodeMaterial).dispose();
      l.mesh.dispose();
    }
    this.core.geometry.dispose();
    this.coreMat.dispose();
    this.halo.geometry.dispose();
    this.haloMat.dispose();
  }
}
