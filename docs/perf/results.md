# Rendimiento medido — web-ar-hand-tracking

Medición real (no estimada) generada por `scripts/perf-harness.mjs` corriendo
la app real (`dist/` de producción) en Chromium headless, con `getUserMedia`
mockeado (no hay cámara física en el entorno de medición) pero el resto del
pipeline —worker de MediaPipe real descargado del CDN, inferencia real,
render real de `ARScene`— sin mockear.

- **Generado:** 2026-07-11T09:29:58.557Z
- **Máquina:** 12th Gen Intel(R) Core(TM) i5-1250P (16 núcleos lógicos), win32 10.0.26200, Node v26.2.0
- **Warm-up sin contar:** 5000 ms · **Ventana de muestreo:** 10000 ms

## Metodología

FPS: EMA que ya mantiene `PerfGovernor` sobre el `dt` de cada frame de
render (`src/domain/perf-governor.ts`), leído vía el getter `ARScene.fps`.
Latencia de inferencia: ida-y-vuelta real al worker medida con
`performance.now()` en `HandTracker` (`src/inference/hand-tracker.ts`),
desde el `postMessage` del cuadro hasta el mensaje `"result"` de MediaPipe.
Ambas se leen mediante el hook de diagnóstico `window.__arPerfSnapshot()`
expuesto por `src/main.ts`. "FPS (EMA final)" es la última muestra de la
ventana de medición (tras el warm-up); "FPS mínimo" es el piso observado
dentro de esa misma ventana.

Las dos condiciones corren en el **mismo** Chromium/WebGL2 (swiftshader); lo
único que cambia es el `userAgent` del contexto de Playwright. La condición
CPU spoofea un Safari 16 real (WebKit < 17), que es el mismo gate que usa
`supportsGpuDelegate()` (`src/domain/platform.ts`) para negar el delegate
GPU en un iPhone/Mac real — no es un flag inventado para el harness.

## Resultados

| Condición                                | Delegate real | FPS (EMA final) | FPS mínimo | Latencia media (ms) | Latencia p95 (ms) | Muestras                                          |
| ---------------------------------------- | ------------- | --------------- | ---------- | ------------------- | ----------------- | ------------------------------------------------- |
| webgl2-gpu-delegate (Chromium normal)    | GPU           | 4.2             | 4.2        | —                   | —                 | 0 muestras                                        |
| cpu-fallback (UA Safari 16, WebKit < 17) | —             | —               | —          | —                   | —                 | FALLÓ: locator.waitFor: Timeout 90000ms exceeded. |

Call log:
[2m - waiting for locator('canvas.ar-canvas') to be visible[22m
|

## Caveats

- Chromium headless en este entorno no tiene GPU física: **ambas** condiciones
  corren sobre `swiftshader` (rasterizador por software) para el render 3D y
  sobre CPU real para MediaPipe cuando el delegate cae a "CPU". El FPS
  absoluto es un piso respecto de un dispositivo con GPU física (donde el
  delegate GPU de MediaPipe es varias veces más rápido); el valor de esta
  medición es confirmar que ambos code paths se ejercitan sin errores y
  comparar su costo relativo en igualdad de hardware.
- La condición CPU spoofea el `userAgent` a un Safari 16 real; no deshabilita
  WebGL del lado del browser. Deshabilitarlo (`--disable-webgl`) se probó
  primero y tumbaba TAMBIÉN el renderer 3D (`ARScene.create()` falla entero
  sin WebGL2 disponible), no sólo el delegate de MediaPipe — no aislaba la
  variable que queríamos medir.
- No hay una mano real frente a la cámara (video sintético); la latencia de
  `detectForVideo` puede variar algo con contenido real, pero el costo de
  decodificación/preprocesado del cuadro es el mismo.

<details>
<summary>JSON crudo</summary>

```json
[
  {
    "name": "webgl2-gpu-delegate (Chromium normal)",
    "contextOptions": {},
    "error": null,
    "samples": [
      {
        "tMs": 33,
        "delegate": "GPU",
        "fps": 13.532826621198783,
        "inference": null
      },
      {
        "tMs": 568,
        "delegate": "GPU",
        "fps": 11.775807973366227,
        "inference": null
      },
      {
        "tMs": 1089,
        "delegate": "GPU",
        "fps": 10.353885242341502,
        "inference": null
      },
      {
        "tMs": 1607,
        "delegate": "GPU",
        "fps": 8.709409877930792,
        "inference": null
      },
      {
        "tMs": 2127,
        "delegate": "GPU",
        "fps": 7.898767128306733,
        "inference": null
      },
      {
        "tMs": 2656,
        "delegate": "GPU",
        "fps": 7.212054501606261,
        "inference": null
      },
      {
        "tMs": 3175,
        "delegate": "GPU",
        "fps": 6.445958455782019,
        "inference": null
      },
      {
        "tMs": 3697,
        "delegate": "GPU",
        "fps": 6.065179730881513,
        "inference": null
      },
      {
        "tMs": 4219,
        "delegate": "GPU",
        "fps": 5.727013992209237,
        "inference": null
      },
      {
        "tMs": 4753,
        "delegate": "GPU",
        "fps": 5.453283391126261,
        "inference": null
      },
      {
        "tMs": 5281,
        "delegate": "GPU",
        "fps": 5.166589429894275,
        "inference": null
      },
      {
        "tMs": 5803,
        "delegate": "GPU",
        "fps": 5.0288989181555905,
        "inference": null
      },
      {
        "tMs": 6347,
        "delegate": "GPU",
        "fps": 4.920692753898748,
        "inference": null
      },
      {
        "tMs": 6871,
        "delegate": "GPU",
        "fps": 4.748595883852554,
        "inference": null
      },
      {
        "tMs": 7386,
        "delegate": "GPU",
        "fps": 4.693552098363778,
        "inference": null
      },
      {
        "tMs": 7917,
        "delegate": "GPU",
        "fps": 4.616161034139007,
        "inference": null
      },
      {
        "tMs": 8439,
        "delegate": "GPU",
        "fps": 4.524859833280543,
        "inference": null
      },
      {
        "tMs": 8965,
        "delegate": "GPU",
        "fps": 4.396843984739685,
        "inference": null
      },
      {
        "tMs": 9494,
        "delegate": "GPU",
        "fps": 4.197047740749689,
        "inference": null
      }
    ],
    "final": {
      "tMs": 9494,
      "delegate": "GPU",
      "fps": 4.197047740749689,
      "inference": null
    },
    "consoleErrors": [
      "[console.error] The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element."
    ],
    "minFps": 4.197047740749689
  },
  {
    "name": "cpu-fallback (UA Safari 16, WebKit < 17)",
    "contextOptions": {
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15"
    },
    "error": "locator.waitFor: Timeout 90000ms exceeded.\nCall log:\n\u001b[2m  - waiting for locator('canvas.ar-canvas') to be visible\u001b[22m\n",
    "samples": [],
    "final": null,
    "consoleErrors": [
      "[console.error] The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element."
    ]
  }
]
```

</details>
