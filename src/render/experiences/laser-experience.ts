/**
 * Experiencia "Láseres": el esqueleto real de la mano se enciende en neón. Cada
 * rayo recorre un **hueso anatómico** (muñeca→nudillos→falanges→puntas), así los
 * dedos NUNCA se unen entre sí: el cableado sigue la estructura de la mano, no un
 * anillo entre puntas. Con las dos manos presentes, además se tienden rayos
 * punta-a-punta entre ambas (el efecto "láseres entre manos").
 *
 * Para que se vean como haces neón (y no líneas de 1px), cada rayo es un plano
 * delgado orientado a lo largo del segmento (InstancedMesh, blending aditivo), con
 * un nodo luminoso en cada punta. El color va por `colorNode` (uniform), no `.color`.
 */
import {
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three/webgpu";
import {
  instancedDynamicBufferAttribute,
  oneMinus,
  smoothstep,
  uniform,
  uv,
  vec2,
} from "three/tsl";
import {
  landmarkToScreenInto,
  type MutScreenPoint,
  type ScreenPoint,
} from "../../domain/hand-tracking";
import { FINGERTIPS } from "../../domain/hand-gestures";
import type { Experience, ExperienceContext } from "./experience";

const WRIST = 0;
const TIPS = [
  FINGERTIPS.thumb,
  FINGERTIPS.index,
  FINGERTIPS.middle,
  FINGERTIPS.ring,
  FINGERTIPS.pinky,
];
// Huesos del modelo de 21 puntos de MediaPipe: cada par es un segmento real de la
// mano (NO une puntas entre sí). Pulgar, índice, medio, anular, meñique y la base
// de la palma. Trazar estos da el esqueleto anatómico en vez de una silueta.
const BONES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4], // pulgar
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8], // índice
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12], // medio
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16], // anular
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20], // meñique
  [0, 17], // base de la palma (muñeca→nudillo del meñique)
];
// Color neón por dedo (paralelo a BONES): cada rayo que recorre un dedo va de su
// propio color, así la mano se ve como un arcoíris de neón en vez de un solo tono.
// El último (palma) cierra la gama. Los rayos ENTRE manos usan el color del usuario.
const FINGER_COLORS = {
  thumb: new Color(0xff2d6f), // rosa
  index: new Color(0xff8a2d), // naranja
  middle: new Color(0x7dff3b), // lima
  ring: new Color(0x2dd4ff), // cian
  pinky: new Color(0x9b6dff), // violeta
  palm: new Color(0xffd23b), // ámbar
} as const;
const BEAM_HUES: readonly Color[] = [
  FINGER_COLORS.thumb,
  FINGER_COLORS.thumb,
  FINGER_COLORS.thumb,
  FINGER_COLORS.thumb,
  FINGER_COLORS.index,
  FINGER_COLORS.index,
  FINGER_COLORS.index,
  FINGER_COLORS.index,
  FINGER_COLORS.middle,
  FINGER_COLORS.middle,
  FINGER_COLORS.middle,
  FINGER_COLORS.middle,
  FINGER_COLORS.ring,
  FINGER_COLORS.ring,
  FINGER_COLORS.ring,
  FINGER_COLORS.ring,
  FINGER_COLORS.pinky,
  FINGER_COLORS.pinky,
  FINGER_COLORS.pinky,
  FINGER_COLORS.pinky,
  FINGER_COLORS.palm,
];
const MAX_BEAMS = 64;
const MAX_NODES = 16;
const BEAM_WIDTH = 5; // grosor del rayo (px)
const WHITE = new Color(0xffffff); // reusado (evita alocar un Color por frame)

export class LaserExperience implements Experience {
  readonly object = new Group();

  private beamGeo = new PlaneGeometry(1, 1);
  // Color por rayo (RGB por instancia): se lee en el shader vía un nodo de buffer
  // instanciado, el mismo mecanismo que usa Three para `instanceColor`. Permite un
  // `colorNode`/`emissiveNode` distinto por rayo sin romper el draw call único.
  private beamColorAttr = new InstancedBufferAttribute(
    new Float32Array(MAX_BEAMS * 3),
    3,
  );
  private beamMat: MeshStandardNodeMaterial;
  private beams: InstancedMesh;
  private userCol = new Color(); // color del usuario para los rayos entre manos (reusado)

  private nodeGeo = new CircleGeometry(1, 16);
  private nodeColor = uniform(new Color(0xffffff));
  private nodeMat: MeshStandardNodeMaterial;
  private nodes: InstancedMesh;

  private mat = new Matrix4();
  private pos = new Vector3();
  private scl = new Vector3();
  private quat = new Quaternion();
  private euler = new Euler();
  private hidden = new Matrix4().makeScale(0, 0, 0);

  // Scratch alloc-free para proyectar landmarks por frame (ver invariante
  // near-zero-alloc del repo). `tipBuf` guarda las 5 puntas de cada mano (deben
  // sobrevivir para tender los rayos punta-a-punta entre ambas manos); `pa`/`pb`
  // son endpoints transitorios de cada hueso.
  private tipBuf: MutScreenPoint[][] = [
    Array.from({ length: 5 }, () => ({ x: 0, y: 0, z: 0 })),
    Array.from({ length: 5 }, () => ({ x: 0, y: 0, z: 0 })),
  ];
  private pa: MutScreenPoint = { x: 0, y: 0, z: 0 };
  private pb: MutScreenPoint = { x: 0, y: 0, z: 0 };
  private pn: MutScreenPoint = { x: 0, y: 0, z: 0 };

  constructor() {
    this.beamColorAttr.setUsage(DynamicDrawUsage);
    this.beamMat = new MeshStandardNodeMaterial({
      metalness: 0,
      roughness: 0.7,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    // Color por instancia (un tono por rayo): vec3 del buffer instanciado, indexado
    // automáticamente por instancia (igual que instanceMatrix).
    const beamColorNode = instancedDynamicBufferAttribute<"vec3">(
      this.beamColorAttr,
      "vec3",
      3,
      0,
    );
    this.beamMat.colorNode = beamColorNode;
    this.beamMat.emissiveNode = beamColorNode;
    // Núcleo neón: brillante en el eje del haz, se apaga hacia los bordes (uv.y).
    const ny = uv().y.sub(0.5).abs(); // 0 centro → 0.5 borde
    this.beamMat.opacityNode = oneMinus(smoothstep(0.1, 0.5, ny));
    this.beams = this.instanced(this.beamGeo, this.beamMat, MAX_BEAMS);

    this.nodeMat = new MeshStandardNodeMaterial({
      metalness: 0,
      roughness: 0.7,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    this.nodeMat.colorNode = this.nodeColor;
    this.nodeMat.emissiveNode = this.nodeColor;
    const dn = uv().sub(vec2(0.5, 0.5)).length();
    this.nodeMat.opacityNode = oneMinus(smoothstep(0.1, 0.5, dn));
    this.nodes = this.instanced(this.nodeGeo, this.nodeMat, MAX_NODES);

    this.object.add(this.beams, this.nodes);
  }

  private instanced(
    geo: PlaneGeometry | CircleGeometry,
    mat: MeshStandardNodeMaterial,
    n: number,
  ): InstancedMesh {
    const mesh = new InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, this.hidden);
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  update(ctx: ExperienceContext): void {
    const { width: w, height: h } = ctx;
    // Parpadeo sutil de brillo compartido por todos los rayos.
    const flicker = 0.75 + 0.25 * Math.sin(ctx.time * 8);
    // Los nodos (puntas/muñeca) siguen el color del usuario; los rayos van por dedo.
    this.nodeColor.value.set(ctx.color).lerp(WHITE, 0.6);
    this.userCol.set(ctx.color);

    const screen = (
      out: MutScreenPoint,
      hand: readonly { x: number; y: number; z: number }[],
      idx: number,
    ): MutScreenPoint => landmarkToScreenInto(out, hand[idx], w, h, ctx.mirrored);

    const cols = this.beamColorAttr.array as Float32Array;
    let beamCount = 0;
    let nodeCount = 0;
    // `col` define el tono del rayo; se escribe en el buffer por-instancia con el flicker.
    const beam = (a: ScreenPoint, b: ScreenPoint, col: Color) => {
      if (beamCount >= MAX_BEAMS) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 0.001;
      this.pos.set((a.x + b.x) / 2, (a.y + b.y) / 2, -1);
      this.euler.set(0, 0, Math.atan2(dy, dx));
      this.quat.setFromEuler(this.euler);
      this.scl.set(len, BEAM_WIDTH, 1);
      const o = beamCount * 3;
      cols[o] = col.r * flicker;
      cols[o + 1] = col.g * flicker;
      cols[o + 2] = col.b * flicker;
      this.beams.setMatrixAt(
        beamCount++,
        this.mat.compose(this.pos, this.quat, this.scl),
      );
    };
    const node = (p: ScreenPoint, r: number) => {
      if (nodeCount >= MAX_NODES) return;
      this.nodes.setMatrixAt(
        nodeCount++,
        this.mat.makeScale(r, r, 1).setPosition(p.x, p.y, 6),
      );
    };

    // ¿Qué manos están presentes este frame? (sus puntas quedan en `tipBuf[i]`).
    const present: [boolean, boolean] = [false, false];
    for (let i = 0; i < ctx.hands.length && i < 2; i++) {
      const hand = ctx.hands[i];
      if (!hand || hand.length < 21) continue;
      present[i] = true;
      // Puntas de esta mano en su buffer persistente (para los rayos entre manos).
      for (let k = 0; k < TIPS.length; k++) {
        landmarkToScreenInto(this.tipBuf[i][k], hand[TIPS[k]], w, h, ctx.mirrored);
      }
      // Rayos a lo largo de los huesos reales (sin unir puntas entre sí), un tono por dedo.
      for (let bi = 0; bi < BONES.length; bi++) {
        const [a, b] = BONES[bi];
        beam(screen(this.pa, hand, a), screen(this.pb, hand, b), BEAM_HUES[bi]);
      }
      node(screen(this.pn, hand, WRIST), 8);
      for (const t of TIPS) node(screen(this.pn, hand, t), 9);
    }

    // Rayos entre las dos manos (punta con punta), en el color del usuario.
    if (present[0] && present[1]) {
      for (let k = 0; k < TIPS.length; k++) {
        beam(this.tipBuf[0][k], this.tipBuf[1][k], this.userCol);
      }
    }

    for (let i = beamCount; i < MAX_BEAMS; i++) this.beams.setMatrixAt(i, this.hidden);
    for (let i = nodeCount; i < MAX_NODES; i++) this.nodes.setMatrixAt(i, this.hidden);
    this.beams.instanceMatrix.needsUpdate = true;
    this.beamColorAttr.needsUpdate = true;
    this.nodes.instanceMatrix.needsUpdate = true;
  }

  hud(): string | null {
    return null;
  }

  reset(): void {
    for (let i = 0; i < MAX_BEAMS; i++) this.beams.setMatrixAt(i, this.hidden);
    this.beams.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.beamGeo.dispose();
    this.beamMat.dispose();
    this.beams.dispose();
    this.nodeGeo.dispose();
    this.nodeMat.dispose();
    this.nodes.dispose();
  }
}
