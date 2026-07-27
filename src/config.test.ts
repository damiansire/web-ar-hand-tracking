import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TASKS_VISION_VERSION, MEDIAPIPE } from "./config";

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
