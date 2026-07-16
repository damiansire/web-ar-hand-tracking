/**
 * Mock de `getUserMedia` para los tests de integración (ver `pipeline.spec.ts`).
 *
 * No hay cámara real en CI/headless, así que reemplazamos
 * `navigator.mediaDevices.getUserMedia` por una función que devuelve el
 * `MediaStream` de un `<canvas>` animado (`captureStream`) ANTES de que
 * `main.ts` corra (se inyecta con `page.addInitScript`, que se ejecuta previo
 * a cualquier script de la página). Dibuja una silueta ovalada que se mueve en
 * el tiempo: no es una mano real, pero es una fuente de video con movimiento
 * real, así el pipeline completo (captura de cuadros → worker de MediaPipe →
 * inferencia → callback de manos → render) se ejercita de punta a punta tal
 * como en producción, sólo cambia el origen del `MediaStream`.
 */
export function installFakeCamera(): void {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d")!;
  let t = 0;

  function draw(): void {
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
    value: {
      ...navigator.mediaDevices,
      getUserMedia: async () => stream,
    },
  });
}
