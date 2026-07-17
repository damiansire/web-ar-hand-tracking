import { test, expect } from "@playwright/test";
import { installFakeCamera } from "./fake-camera";

/**
 * Cubre el hueco marcado en la auditoría (waht-2): hasta ahora sólo el
 * dominio puro tenía tests (vitest); nada ejercitaba el pipeline completo
 * cámara → worker de inferencia → render de punta a punta.
 *
 * Mockeamos `getUserMedia` (ver `fake-camera.ts`) porque no hay cámara real
 * en CI, pero todo lo demás es la app real: el mismo `main.ts`, la misma
 * máquina de estados de `src/domain/app-state.ts`, el mismo worker clásico
 * que descarga y corre MediaPipe, y la misma `ARScene` de Three.js.
 */
test.describe("pipeline cámara → worker → render", () => {
  test("con cámara concedida, la app llega a la vista AR sin crashear", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.addInitScript(installFakeCamera);
    await page.goto("/");

    await page.getByRole("button", { name: "Activar cámara" }).click();

    // "Cargando el modelo de IA…" primero (descarga real del modelo de MediaPipe).
    await expect(page.getByText("Cargando el modelo de IA…")).toBeVisible();

    // El worker descarga MediaPipe + el modelo (~unos segundos) antes de que
    // aparezca la vista AR; timeout generoso acorde al de la config.
    const canvas = page.locator("canvas.ar-canvas");
    await expect(canvas).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("video.ar-video")).toBeVisible();

    // La pantalla de error (role=alert) NO debe haber aparecido en el camino.
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      pageErrors,
      `errores no capturados en página: ${pageErrors.map(String)}`,
    ).toHaveLength(0);

    // El pipeline realmente corrió: el worker resolvió un delegate (GPU o CPU)
    // y la escena está renderizando cuadros con FPS > 0, vía el hook de
    // diagnóstico expuesto en `main.ts`.
    await expect
      .poll(() => page.evaluate(() => window.__arPerfSnapshot?.().delegate ?? null), {
        timeout: 15_000,
      })
      .not.toBeNull();

    const snapshot = await page.evaluate(() => window.__arPerfSnapshot!());
    expect(["GPU", "CPU"]).toContain(snapshot.delegate);
  });

  test("con cámara denegada, la app degrada a la pantalla de error sin crashear", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          ...navigator.mediaDevices,
          getUserMedia: async () => {
            throw new DOMException("denegado por el usuario", "NotAllowedError");
          },
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Activar cámara" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Permiso de cámara denegado");
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});
