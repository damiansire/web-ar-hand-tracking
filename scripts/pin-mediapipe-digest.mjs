/**
 * Regenera el hash de integridad del bundle de MediaPipe que el worker está
 * autorizado a ejecutar (`MEDIAPIPE_BUNDLE_SHA256` en src/config.ts).
 *
 * Se calcula sobre el archivo del paquete npm INSTALADO, no sobre lo que responda
 * el CDN: jsDelivr sirve ese mismo archivo byte a byte, y hashear la copia local
 * hace que lo instalado, lo auditado (`npm audit`) y lo ejecutado sean el mismo
 * artefacto. Hashear la respuesta del CDN pinearía justamente aquello de lo que
 * hay que desconfiar.
 *
 * Uso: node scripts/pin-mediapipe-digest.mjs   (imprime el valor a pegar)
 *      node scripts/pin-mediapipe-digest.mjs --write   (lo escribe en config.ts)
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BUNDLE = join(ROOT, "node_modules/@mediapipe/tasks-vision/vision_bundle.cjs");
const CONFIG = join(ROOT, "src/config.ts");

const bytes = await readFile(BUNDLE);
const digest = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
console.log(digest);

if (process.argv.includes("--write")) {
  const source = await readFile(CONFIG, "utf8");
  const updated = source.replace(
    /(export const MEDIAPIPE_BUNDLE_SHA256 = ")[^"]*(")/,
    `$1${digest}$2`,
  );
  if (updated === source) {
    console.error("No se encontró MEDIAPIPE_BUNDLE_SHA256 en src/config.ts");
    process.exit(1);
  }
  await writeFile(CONFIG, updated);
  console.log("src/config.ts actualizado");
}
