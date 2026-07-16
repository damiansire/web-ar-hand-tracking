import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de integración de punta a punta (ver `e2e/pipeline.spec.ts`): mockean
 * `getUserMedia` (no hay cámara real en CI) y ejercitan el pipeline REAL
 * cámara→worker de inferencia→render contra la app servida por Vite. Cargan de
 * verdad el modelo de MediaPipe (CDN, ver `src/config.ts`) y el worker
 * clásico, así que el timeout es generoso.
 *
 * Corre por separado de `npm test` (vitest, sólo dominio puro): `npm run
 * test:e2e`. No forma parte del gate de CI actual (ver `.github/workflows/ci.yml`);
 * se puede sumar como job separado el día que se quiera correr en cada PR.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5183",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5183 --strictPort",
    url: "http://localhost:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Chromium empaquetado por Playwright no expone GPU real: swiftshader
          // le da un WebGL2 por software suficiente para que la app arranque
          // (mismo criterio que scripts/webgpu-smoke.mjs).
          args: [
            "--enable-unsafe-webgpu",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
});
