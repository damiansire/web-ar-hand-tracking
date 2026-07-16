/**
 * Harness de medición REAL de rendimiento (waht-3 de la auditoría): corre la
 * app completa (build de producción, cámara mockeada) en Chromium headless
 * bajo dos condiciones distintas y mide FPS de render + latencia de
 * inferencia con los números que la propia app instrumenta con
 * `performance.now()` (ver `src/inference/hand-tracker.ts` y el getter `fps`
 * de `src/render/ar-scene.ts`, expuestos vía el hook de diagnóstico
 * `window.__arPerfSnapshot` de `src/main.ts`).
 *
 * Condiciones:
 *   A) "webgl2-gpu-delegate" — Chromium normal con WebGL2 (swiftshader,
 *      mismos flags que scripts/webgpu-smoke.mjs). `hasWebGl2() === true` y
 *      el user-agent no es WebKit viejo, así que `supportsGpuDelegate()`
 *      (`src/domain/platform.ts`) autoriza el delegate GPU de MediaPipe (nota:
 *      en CI headless corre sobre un rasterizador de software, no una GPU
 *      física; documentado en el resultado — el código path es el mismo que
 *      corre en una GPU real).
 *   B) "cpu-fallback" — MISMO Chromium/WebGL2 (el render de Three.js sigue
 *      andando), pero con el user-agent spoofeado a Safari 16 (WebKit < 17).
 *      Es el fallback CPU REAL que ya implementa la app: `supportsGpuDelegate`
 *      deniega el delegate GPU en WebKit < 17 (ver el comentario de
 *      `platform.ts`), así que el worker recibe `allowGpu:false` y usa CPU —
 *      el mismo camino que corre en un Safari/iPhone real. (Deshabilitar
 *      WebGL del lado del browser, en cambio, tumba TAMBIÉN el renderer 3D —
 *      no aísla el delegate de MediaPipe; se probó y el `ARScene.create()`
 *      falla entero, así que no es la condición correcta para esto.)
 *
 * Para cada condición: sirve dist/, mockea `getUserMedia` con un
 * `<canvas>.captureStream()` animado, hace clic en "Activar cámara", espera a
 * que aparezca la vista AR (modelo real descargado del CDN de MediaPipe),
 * deja un `WARMUP_MS` sin contar (el FPS EMA de `PerfGovernor` tarda unos
 * segundos en estabilizarse) y recién ahí muestrea `SAMPLE_MS`.
 *
 * Uso: npm run build && npm run perf:harness
 * Escribe docs/perf/results.md con los números reales medidos.
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import os from "node:os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");
const SAMPLE_MS = Number(process.env.PERF_SAMPLE_MS ?? 10000);
const WARMUP_MS = Number(process.env.PERF_WARMUP_MS ?? 5000);
// User-agent de un Safari real (WebKit 16, < 17): dispara el mismo gate de
// `supportsGpuDelegate` (src/domain/platform.ts) que usa un iPhone/Mac real
// para forzar el delegate CPU, sin tocar la disponibilidad de WebGL2 del
// browser (que también usa el renderer 3D, no sólo MediaPipe).
const WEBKIT16_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15";

const require = createRequire(import.meta.url);
async function resolvePlaywright() {
  try {
    return require("playwright");
  } catch {
    /* no instalado localmente */
  }
  const npxCache = join(
    process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? "", "AppData/Local"),
    "npm-cache",
    "_npx",
  );
  if (existsSync(npxCache)) {
    const { readdirSync } = await import("node:fs");
    for (const dir of readdirSync(npxCache)) {
      const p = join(npxCache, dir, "node_modules", "playwright");
      if (existsSync(p)) {
        try {
          return require(p);
        } catch {
          /* siguiente candidato */
        }
      }
    }
  }
  throw new Error("No se pudo resolver playwright (ni local ni en el cache de npx).");
}
const { chromium } = await resolvePlaywright();

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".svg": "image/svg+xml",
};

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let p = normalize(join(DIST, decodeURIComponent(url.pathname)));
      if (!p.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      if (url.pathname === "/" || !existsSync(p)) p = join(DIST, "index.html");
      const body = await readFile(p);
      res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" });
      res.end(body);
    } catch (e) {
      res.writeHead(404).end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** Se serializa e inyecta en la página vía addInitScript: debe ser autocontenida. */
function installFakeCamera() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  let t = 0;
  function draw() {
    t += 0.05;
    ctx.fillStyle = "#202030";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e0a878";
    const x = 320 + Math.sin(t) * 120;
    const y = 240 + Math.cos(t * 0.7) * 90;
    ctx.beginPath();
    ctx.ellipse(x, y, 55, 85, 0, 0, Math.PI * 2);
    ctx.fill();
    requestAnimationFrame(draw);
  }
  draw();
  const stream = canvas.captureStream(30);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { ...navigator.mediaDevices, getUserMedia: async () => stream },
  });
}

/**
 * Corre una condición completa contra un `browser` ya lanzado: abre un
 * contexto nuevo (opcionalmente con `userAgent` spoofeado), navega a la app,
 * concede la cámara mockeada, espera a la vista AR, deja `WARMUP_MS` sin
 * contar y muestrea `window.__arPerfSnapshot()` durante `SAMPLE_MS`.
 *
 * Timeout de espera generoso (90s): `HandTracker.init()` intenta GPU primero
 * (timeout interno 15s) y si no responde reintenta forzando CPU (timeout
 * interno 30s) — hasta 45s de fallback interno de la propia app antes de
 * siquiera considerar que algo está mal. Bajo la contención de CPU de un
 * runner headless compartido (ver los FPS bajos en `results.md`), ese
 * fallback interno puede tardar su presupuesto completo.
 */
async function runCondition(name, browser, base, contextOptions = {}) {
  console.log(`\n[condición ${name}] contexto: ${JSON.stringify(contextOptions) || "(default)"}`);
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[console.error] ${m.text()}`);
  });

  await page.addInitScript(installFakeCamera);
  await page.goto(base, { waitUntil: "load" });

  await page.getByRole("button", { name: "Activar cámara" }).click();

  const result = { name, contextOptions, error: null, samples: [], final: null, consoleErrors };
  try {
    await page.locator("canvas.ar-canvas").waitFor({ state: "visible", timeout: 90_000 });

    // Warm-up sin contar: el FPS EMA de PerfGovernor (alpha=0.1) tarda unos
    // segundos en converger desde su valor inicial (60) al régimen real.
    await page.waitForTimeout(WARMUP_MS);

    // Deja correr el pipeline real; toma muestras periódicas del snapshot
    // (fps EMA + stats de latencia) durante la ventana de medición.
    const start = Date.now();
    while (Date.now() - start < SAMPLE_MS) {
      const snap = await page.evaluate(() => window.__arPerfSnapshot?.() ?? null);
      if (snap) result.samples.push({ tMs: Date.now() - start, ...snap });
      await page.waitForTimeout(500);
    }
    result.final = result.samples.at(-1) ?? null;
    result.minFps = result.samples.length
      ? Math.min(...result.samples.map((s) => s.fps ?? Infinity))
      : null;
  } catch (e) {
    result.error = String(e?.message || e);
    try {
      const shot = join(__dirname, `perf-harness-fail-${name.replace(/[^\w-]+/g, "_")}.png`);
      await page.screenshot({ path: shot });
      console.error(`[condición ${name}] falló; captura en ${shot}`);
    } catch {
      /* si ni la captura funciona, seguimos con el error original */
    }
  }

  await context.close();
  return result;
}

async function main() {
  if (!existsSync(DIST)) {
    console.error("No existe dist/. Corré `npm run build` antes de este harness.");
    process.exit(1);
  }
  const server = await startStaticServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[server] dist servido en ${base}`);

  // WebGL2 vía swiftshader; lo que cambia entre condiciones es el user-agent
  // del contexto, que es lo que gatea el delegate en `supportsGpuDelegate`
  // (ver el comentario grande al inicio del archivo). Un browser NUEVO por
  // condición (en vez de reusar uno) para que la contención de CPU de una
  // condición no se arrastre a la siguiente.
  const launchArgs = [
    "--enable-unsafe-webgpu",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
  ];

  const conditions = [
    { name: "webgl2-gpu-delegate (Chromium normal)", contextOptions: {} },
    { name: "cpu-fallback (UA Safari 16, WebKit < 17)", contextOptions: { userAgent: WEBKIT16_UA } },
  ];

  const results = [];
  for (const c of conditions) {
    const browser = await chromium.launch({ headless: true, args: launchArgs });
    results.push(await runCondition(c.name, browser, base, c.contextOptions));
    await browser.close();
  }
  server.close();

  console.log("\n================ RESULTADOS ================");
  console.log(JSON.stringify(results, null, 2));

  await writeReport(results);

  const anyFailed = results.some((r) => r.error || !r.final);
  if (anyFailed) {
    console.error("\n[perf-harness] al menos una condición no completó la medición.");
    process.exit(1);
  }
  console.log("\n[perf-harness] OK — ver docs/perf/results.md");
}

async function writeReport(results) {
  const dir = join(ROOT, "docs", "perf");
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const cpu = os.cpus();
  const machine = `${cpu[0]?.model ?? "desconocido"} (${cpu.length} núcleos lógicos), ${os.platform()} ${os.release()}, Node ${process.version}`;

  const rows = results
    .map((r) => {
      if (r.error || !r.final) {
        return `| ${r.name} | — | — | — | — | — | FALLÓ: ${r.error ?? "sin muestras"} |`;
      }
      const { fps, inference, delegate } = r.final;
      const fpsStr = fps != null ? fps.toFixed(1) : "—";
      const minFpsStr = r.minFps != null && Number.isFinite(r.minFps) ? r.minFps.toFixed(1) : "—";
      const meanStr = inference ? inference.meanMs.toFixed(1) : "—";
      const p95Str = inference ? inference.p95Ms.toFixed(1) : "—";
      const nStr = inference ? String(inference.count) : "0";
      return `| ${r.name} | ${delegate ?? "—"} | ${fpsStr} | ${minFpsStr} | ${meanStr} | ${p95Str} | ${nStr} muestras |`;
    })
    .join("\n");

  const md = `# Rendimiento medido — web-ar-hand-tracking

Medición real (no estimada) generada por \`scripts/perf-harness.mjs\` corriendo
la app real (\`dist/\` de producción) en Chromium headless, con \`getUserMedia\`
mockeado (no hay cámara física en el entorno de medición) pero el resto del
pipeline —worker de MediaPipe real descargado del CDN, inferencia real,
render real de \`ARScene\`— sin mockear.

- **Generado:** ${now}
- **Máquina:** ${machine}
- **Warm-up sin contar:** ${WARMUP_MS} ms · **Ventana de muestreo:** ${SAMPLE_MS} ms

## Metodología

FPS: EMA que ya mantiene \`PerfGovernor\` sobre el \`dt\` de cada frame de
render (\`src/domain/perf-governor.ts\`), leído vía el getter \`ARScene.fps\`.
Latencia de inferencia: ida-y-vuelta real al worker medida con
\`performance.now()\` en \`HandTracker\` (\`src/inference/hand-tracker.ts\`),
desde el \`postMessage\` del cuadro hasta el mensaje \`"result"\` de MediaPipe.
Ambas se leen mediante el hook de diagnóstico \`window.__arPerfSnapshot()\`
expuesto por \`src/main.ts\`. "FPS (EMA final)" es la última muestra de la
ventana de medición (tras el warm-up); "FPS mínimo" es el piso observado
dentro de esa misma ventana.

Las dos condiciones corren en el **mismo** Chromium/WebGL2 (swiftshader); lo
único que cambia es el \`userAgent\` del contexto de Playwright. La condición
CPU spoofea un Safari 16 real (WebKit < 17), que es el mismo gate que usa
\`supportsGpuDelegate()\` (\`src/domain/platform.ts\`) para negar el delegate
GPU en un iPhone/Mac real — no es un flag inventado para el harness.

## Resultados

| Condición | Delegate real | FPS (EMA final) | FPS mínimo | Latencia media (ms) | Latencia p95 (ms) | Muestras |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## Caveats

- Chromium headless en este entorno no tiene GPU física: **ambas** condiciones
  corren sobre \`swiftshader\` (rasterizador por software) para el render 3D y
  sobre CPU real para MediaPipe cuando el delegate cae a "CPU". El FPS
  absoluto es un piso respecto de un dispositivo con GPU física (donde el
  delegate GPU de MediaPipe es varias veces más rápido); el valor de esta
  medición es confirmar que ambos code paths se ejercitan sin errores y
  comparar su costo relativo en igualdad de hardware.
- La condición CPU spoofea el \`userAgent\` a un Safari 16 real; no deshabilita
  WebGL del lado del browser. Deshabilitarlo (\`--disable-webgl\`) se probó
  primero y tumbaba TAMBIÉN el renderer 3D (\`ARScene.create()\` falla entero
  sin WebGL2 disponible), no sólo el delegate de MediaPipe — no aislaba la
  variable que queríamos medir.
- No hay una mano real frente a la cámara (video sintético); la latencia de
  \`detectForVideo\` puede variar algo con contenido real, pero el costo de
  decodificación/preprocesado del cuadro es el mismo.

<details>
<summary>JSON crudo</summary>

\`\`\`json
${JSON.stringify(results, null, 2)}
\`\`\`

</details>
`;
  await writeFile(join(dir, "results.md"), md, "utf8");
  console.log(`\n[report] docs/perf/results.md escrito.`);
}

await main();
