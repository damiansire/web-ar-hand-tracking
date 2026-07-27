import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { TASKS_VISION_VERSION, MEDIAPIPE, MEDIAPIPE_BUNDLE_SHA256 } from "./config";

/**
 * `@mediapipe/tasks-vision` está en `dependencies` pero ningún módulo lo importa:
 * el código que corre en el navegador se baja del CDN con la versión de
 * `TASKS_VISION_VERSION`. Es decir que `npm audit` audita el paquete instalado y
 * el usuario ejecuta el del CDN. Mientras las dos versiones sean la MISMA eso
 * sigue teniendo sentido; si driftean, el gate de supply-chain pasa a mirar un
 * artefacto que nadie ejecuta, sin que nada falle.
 *
 * Antes el drift era el caso esperado: `package.json` declaraba `^0.10.35`, así
 * que el primer bump de Dependabot movía lo auditado y dejaba clavado lo
 * ejecutado. Este test lo convierte en un fallo de CI.
 */
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };

describe("versión de MediaPipe", () => {
  it("la versión que se baja del CDN es la misma que se instala y se audita", () => {
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(TASKS_VISION_VERSION);
  });

  it("el rango del manifest es exacto (sin ^ ni ~): auditar otra versión no serviría", () => {
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("las URLs del CDN llevan esa versión, no una hardcodeada aparte", () => {
    expect(MEDIAPIPE.bundle).toContain(`@${TASKS_VISION_VERSION}/`);
    expect(MEDIAPIPE.wasmBase).toContain(`@${TASKS_VISION_VERSION}/`);
  });
});

/**
 * El worker sólo ejecuta el bundle si su SHA-256 coincide con el pineado. Si el
 * pin queda viejo (bump de versión sin regenerarlo) la app deja de arrancar, que
 * es el fallo correcto pero sólo si se descubre en CI y no en producción. Este
 * test lo recalcula desde el paquete instalado, que es exactamente el archivo que
 * jsDelivr sirve.
 */
describe("integridad del bundle de MediaPipe", () => {
  it("el hash pineado es el del bundle instalado (lo instalado = lo ejecutado)", () => {
    const bundle = readFileSync(
      new URL(
        "../node_modules/@mediapipe/tasks-vision/vision_bundle.cjs",
        import.meta.url,
      ),
    );
    const digest = `sha256-${createHash("sha256").update(bundle).digest("base64")}`;
    expect(MEDIAPIPE_BUNDLE_SHA256).toBe(digest);
  });

  it("el hash viaja al worker en el formato SRI que espera", () => {
    expect(MEDIAPIPE.bundleSha256).toBe(MEDIAPIPE_BUNDLE_SHA256);
    expect(MEDIAPIPE_BUNDLE_SHA256).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
  });
});
