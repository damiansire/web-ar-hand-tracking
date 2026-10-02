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
 *   A) "gate-abierto" — Chromium (headless nuevo) con WebGL2 sobre la GPU
 *      REAL de la máquina (`--use-angle=d3d11` en Windows; ver `launchArgs`).
 *      `supportsGpuDelegate()` (`src/domain/platform.ts`) AUTORIZA el delegate
 *      GPU, y la app elige sola: si el warmup del delegate GPU no entra en el
 *      presupuesto de `HandTracker.init` (en esta máquina la primera
 *      inferencia GPU compila shaders ~25-30s, medido tanto en Chromium como
 *      en Chrome real), la app reintenta con CPU por diseño. La columna
 *      "Delegate real" del reporte dice qué terminó corriendo; el renderer
 *      WebGL real queda registrado por condición. Forzar swiftshader acá
 *      (como hace el smoke de CI, que no tiene GPU) se probó y NO puede
 *      completar una medición: la inferencia sobre un rasterizador por
 *      software tarda >2s por cuadro y el watchdog de `HandTracker`
 *      (STALL_MS) corta la sesión a mitad de la ventana de muestreo.
 *   B) "cpu-forzado" — MISMO Chromium/WebGL2 (el render de Three.js sigue
 *      andando), pero con `navigator.userAgent` spoofeado a Safari 16
 *      (WebKit < 17) SOLO en el main thread, vía `addInitScript`. Es el
 *      fallback CPU REAL que ya implementa la app: `supportsGpuDelegate` corre
 *      en el main thread (`hand-tracker.ts`), lee ese UA, deniega el delegate
 *      GPU y el worker recibe `allowGpu:false` — el mismo camino que corre en
 *      un Safari/iPhone real. Dos alternativas se probaron y NO sirven:
 *      deshabilitar WebGL del lado del browser tumba TAMBIÉN el renderer 3D
 *      (`ARScene.create()` falla entero); y spoofear el UA a nivel de contexto
 *      de Playwright se lo cambia además al WORKER, donde el propio MediaPipe
 *      sniffea el UA y toma un camino "WebKit" que en Chromium muere con
 *      `document is not defined` en la init (era la causa de la condición
 *      FALLIDA que este harness versionó durante semanas). Lo que la condición
 *      quiere aislar es el gate PROPIO de la app, y ese vive en el main thread.
 *
 * Para cada condición: sirve dist/, mockea `getUserMedia` con un
 * `<canvas>.captureStream()` animado, hace clic en "Activar cámara", espera a
 * que aparezca la vista AR (modelo real descargado del CDN de MediaPipe),
 * deja un `WARMUP_MS` sin contar (el FPS EMA de `PerfGovernor` tarda unos
 * segundos en estabilizarse) y recién ahí muestrea `SAMPLE_MS`.
 *
 * Uso: npm run build && npm run perf:harness
 * Escribe docs/perf/results.md con los números reales medidos. Una corrida en la
 * que alguna condición no completó la medición NO es evidencia de rendimiento:
 * su reporte va a docs/perf/results-failed.md (ignorado por git) en vez de pisar
 * la última medición buena que el README linkea como prueba.
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

/**
 * Se serializa e inyecta vía addInitScript: spoofea `navigator.userAgent` SOLO
 * en el main thread. El worker conserva su UA real a propósito: MediaPipe
 * también sniffea el UA dentro del worker y con un UA WebKit toma un camino
 * que en Chromium muere con `document is not defined` (ver el bloque de
 * condiciones arriba). El único consumidor del UA que la condición quiere
 * gobernar es `supportsGpuDelegate`, que corre en el main thread.
 */
function spoofMainThreadUserAgent(ua) {
  Object.defineProperty(Navigator.prototype, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

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
      res.writeHead(200, {
        "Content-Type": MIME[extname(p)] ?? "application/octet-stream",
      });
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
 * siquiera considerar que algo está mal. Bajo contención de CPU (descarga del
 * modelo + compilación WASM + init del delegate compartiendo la máquina), ese
 * fallback interno puede tardar su presupuesto completo.
 */
async function runCondition(name, browser, base, spoofUserAgent = null) {
  console.log(
    `\n[condición ${name}] spoof de UA en main thread: ${spoofUserAgent ?? "(no)"}`,
  );
  const context = await browser.newContext();
  const consoleErrors = [];
  const result = {
    name,
    spoofUserAgent,
    webglRenderer: null,
    error: null,
    samples: [],
    final: null,
    consoleErrors,
  };
  // TODO el ciclo de vida va dentro del try: si el goto o el click fallan (botón
  // que no aparece, server caído) la condición debe registrar su error y cerrar
  // el contexto igual, no matar el proceso dejando Chromium y el server
  // huérfanos y el reporte sin escribir.
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`[console.error] ${m.text()}`);
    });

    await page.addInitScript(installFakeCamera);
    if (spoofUserAgent) {
      await page.addInitScript(spoofMainThreadUserAgent, spoofUserAgent);
    }
    await page.goto(base, { waitUntil: "load" });

    // Evidencia del entorno real de la condición: qué renderer WebGL tocó.
    result.webglRenderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "sin WebGL2";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return String(
        ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      );
    });
    console.log(`[condición ${name}] WebGL: ${result.webglRenderer}`);

    await page.getByRole("button", { name: "Activar cámara" }).click();

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
    // Una condición cuya app terminó en la pantalla de error (p. ej. el watchdog
    // de inferencia disparó a mitad de la ventana) no es una medición: el
    // snapshot devuelve delegate=null tras el cleanup. Se marca como error en
    // vez de dejar que una fila "—" pase por resultado.
    if (result.final && result.final.delegate === null) {
      result.error =
        "la app degradó a la pantalla de error durante la medición (snapshot con delegate=null)";
      result.final = null;
    }
  } catch (e) {
    result.error = String(e?.message || e);
    try {
      const page = context.pages().at(-1);
      const shot = join(
        __dirname,
        `perf-harness-fail-${name.replace(/[^\w-]+/g, "_")}.png`,
      );
      if (page) {
        await page.screenshot({ path: shot });
        console.error(`[condición ${name}] falló; captura en ${shot}`);
      }
    } catch {
      /* si ni la captura funciona, seguimos con el error original */
    }
  } finally {
    await context.close();
  }
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

  // GPU REAL de la máquina, no swiftshader: el headless "nuevo" de Chromium sí
  // puede usar la GPU física con ANGLE (en Windows, D3D11). Con swiftshader la
  // inferencia GPU de MediaPipe tarda >2s por cuadro y el watchdog de la app
  // aborta la sesión a mitad de la medición (ver el bloque de condiciones).
  // Lo que cambia entre condiciones es el user-agent del MAIN THREAD, que es
  // lo que gatea el delegate en `supportsGpuDelegate`. Un browser NUEVO por
  // condición (en vez de reusar uno) para que la contención de CPU de una
  // condición no se arrastre a la siguiente.
  const launchArgs = [
    "--headless=new",
    "--use-gl=angle",
    `--use-angle=${process.platform === "win32" ? "d3d11" : "default"}`,
    "--enable-unsafe-webgpu",
  ];

  const conditions = [
    {
      name: "gate-abierto (Chromium normal, la app elige delegate)",
      spoofUserAgent: null,
    },
    {
      name: "cpu-forzado (UA Safari 16, WebKit < 17)",
      spoofUserAgent: WEBKIT16_UA,
    },
  ];

  const results = [];
  try {
    for (const c of conditions) {
      const browser = await chromium.launch({ headless: true, args: launchArgs });
      try {
        results.push(await runCondition(c.name, browser, base, c.spoofUserAgent));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
  }

  console.log("\n================ RESULTADOS ================");
  console.log(JSON.stringify(results, null, 2));

  const anyFailed = results.some((r) => r.error || !r.final);
  const reportFile = await writeReport(results, anyFailed);
  if (anyFailed) {
    console.error(
      `\n[perf-harness] al menos una condición no completó la medición. El reporte quedó en ${reportFile}; docs/perf/results.md conserva la última medición completa.`,
    );
    process.exit(1);
  }
  console.log("\n[perf-harness] OK — ver docs/perf/results.md");
}

async function writeReport(results, failed = false) {
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
      const minFpsStr =
        r.minFps != null && Number.isFinite(r.minFps) ? r.minFps.toFixed(1) : "—";
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

Las dos condiciones corren en el **mismo** Chromium (headless nuevo) sobre la
GPU real de la máquina (ANGLE; el renderer exacto queda registrado por
condición más abajo); lo único que cambia es el \`navigator.userAgent\` del
main thread, spoofeado por \`addInitScript\`. La condición CPU spoofea un
Safari 16 real (WebKit < 17), que es el mismo gate que usa
\`supportsGpuDelegate()\` (\`src/domain/platform.ts\`) para negar el delegate
GPU en un iPhone/Mac real — no es un flag inventado para el harness. El spoof
es sólo del main thread a propósito: MediaPipe también sniffea el UA dentro
del worker y con un UA WebKit toma un camino que en Chromium no existe
(\`document is not defined\`); el gate de la app, que es lo que la condición
aísla, corre en el main thread.

### Entorno WebGL por condición

${results.map((r) => `- **${r.name}**: \`${r.webglRenderer ?? "no registrado"}\``).join("\n")}

## Resultados

| Condición | Delegate real | FPS (EMA final) | FPS mínimo | Latencia media (ms) | Latencia p95 (ms) | Muestras |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## Caveats

- Las condiciones corren sobre la GPU real de esta máquina (ver "Entorno WebGL
  por condición"): los números son representativos de un equipo de escritorio
  con GPU integrada, no de un móvil. Forzar \`swiftshader\` (rasterizador por
  software, como en el smoke de CI) se probó y no puede completar esta
  medición: la inferencia GPU tarda ahí >2s por cuadro y el watchdog de
  \`HandTracker\` corta la sesión por diseño.
- La condición CPU spoofea el \`userAgent\` del main thread a un Safari 16
  real; no deshabilita WebGL del lado del browser. Deshabilitarlo
  (\`--disable-webgl\`) se probó primero y tumbaba TAMBIÉN el renderer 3D
  (\`ARScene.create()\` falla entero sin WebGL2 disponible), no sólo el
  delegate de MediaPipe — no aislaba la variable que queríamos medir.
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
  const name = failed ? "results-failed.md" : "results.md";
  await writeFile(join(dir, name), md, "utf8");
  console.log(`\n[report] docs/perf/${name} escrito.`);
  return `docs/perf/${name}`;
}

await main();
