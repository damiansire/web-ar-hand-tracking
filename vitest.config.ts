import { defineConfig } from "vitest/config";

// Domain logic is pure (no DOM, no workers), so the fast Node environment is
// enough. The imperative shells (camera, worker, Three.js) are verified in a
// real browser instead.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // El umbral se mide sobre lo que ESTA suite puede cubrir de verdad: el
      // dominio puro y el cliente de inferencia. Los shells imperativos
      // (render/ui/camera/main) se verifican en un navegador real (smoke WebGPU
      // + Playwright), así que meterlos acá inflaría el denominador con código
      // que este runner no ejecuta y volvería el número decorativo.
      include: ["src/domain/**/*.ts", "src/inference/**/*.ts"],
      // El worker es un script clásico que sólo corre dentro de un Worker real
      // (importScripts + WASM de MediaPipe): no es importable desde Node.
      exclude: ["**/*.test.ts", "src/inference/hand-landmarker.worker.ts"],
      reporter: ["text", "json-summary"],
      // Umbral como gate real: `npm test` corre con --coverage y CI corre
      // `npm test`, así que una caída de cobertura rompe el build (no es un
      // reporte que nadie mira). Los números son el piso medido, no aspiracional.
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
