# Rendimiento medido — web-ar-hand-tracking

Medición real (no estimada) generada por `scripts/perf-harness.mjs` corriendo
la app real (`dist/` de producción) en Chromium headless, con `getUserMedia`
mockeado (no hay cámara física en el entorno de medición) pero el resto del
pipeline —worker de MediaPipe real descargado del CDN, inferencia real,
render real de `ARScene`— sin mockear.

- **Generado:** 2026-07-27T23:40:06.508Z
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

Las dos condiciones corren en el **mismo** Chromium (headless nuevo) sobre la
GPU real de la máquina (ANGLE; el renderer exacto queda registrado por
condición más abajo); lo único que cambia es el `navigator.userAgent` del
main thread, spoofeado por `addInitScript`. La condición CPU spoofea un
Safari 16 real (WebKit < 17), que es el mismo gate que usa
`supportsGpuDelegate()` (`src/domain/platform.ts`) para negar el delegate
GPU en un iPhone/Mac real — no es un flag inventado para el harness. El spoof
es sólo del main thread a propósito: MediaPipe también sniffea el UA dentro
del worker y con un UA WebKit toma un camino que en Chromium no existe
(`document is not defined`); el gate de la app, que es lo que la condición
aísla, corre en el main thread.

### Entorno WebGL por condición

- **gate-abierto (Chromium normal, la app elige delegate)**: `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)`
- **cpu-forzado (UA Safari 16, WebKit < 17)**: `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)`

## Resultados

| Condición | Delegate real | FPS (EMA final) | FPS mínimo | Latencia media (ms) | Latencia p95 (ms) | Muestras |
| --- | --- | --- | --- | --- | --- | --- |
| gate-abierto (Chromium normal, la app elige delegate) | CPU | 31.1 | 23.0 | — | — | 0 muestras |
| cpu-forzado (UA Safari 16, WebKit < 17) | CPU | 27.4 | 24.3 | — | — | 0 muestras |

## Caveats

- Las condiciones corren sobre la GPU real de esta máquina (ver "Entorno WebGL
  por condición"): los números son representativos de un equipo de escritorio
  con GPU integrada, no de un móvil. Forzar `swiftshader` (rasterizador por
  software, como en el smoke de CI) se probó y no puede completar esta
  medición: la inferencia GPU tarda ahí >2s por cuadro y el watchdog de
  `HandTracker` corta la sesión por diseño.
- La condición CPU spoofea el `userAgent` del main thread a un Safari 16
  real; no deshabilita WebGL del lado del browser. Deshabilitarlo
  (`--disable-webgl`) se probó primero y tumbaba TAMBIÉN el renderer 3D
  (`ARScene.create()` falla entero sin WebGL2 disponible), no sólo el
  delegate de MediaPipe — no aislaba la variable que queríamos medir.
- No hay una mano real frente a la cámara (video sintético); la latencia de
  `detectForVideo` puede variar algo con contenido real, pero el costo de
  decodificación/preprocesado del cuadro es el mismo.

<details>
<summary>JSON crudo</summary>

```json
[
  {
    "name": "gate-abierto (Chromium normal, la app elige delegate)",
    "spoofUserAgent": null,
    "webglRenderer": "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "error": null,
    "samples": [
      {
        "tMs": 71,
        "delegate": "CPU",
        "fps": 28.433138691513285,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 764,
        "delegate": "CPU",
        "fps": 29.63428218663208,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 1384,
        "delegate": "CPU",
        "fps": 29.705426844230068,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 1980,
        "delegate": "CPU",
        "fps": 25.836136967580337,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 2560,
        "delegate": "CPU",
        "fps": 26.128244579985406,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 3126,
        "delegate": "CPU",
        "fps": 24.137538539105126,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 3887,
        "delegate": "CPU",
        "fps": 27.110596854006165,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 4482,
        "delegate": "CPU",
        "fps": 28.953895412088247,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 5041,
        "delegate": "CPU",
        "fps": 25.336047012451232,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 5630,
        "delegate": "CPU",
        "fps": 26.34132516235831,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 6173,
        "delegate": "CPU",
        "fps": 25.816903179939956,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 6840,
        "delegate": "CPU",
        "fps": 25.834559175246046,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 7410,
        "delegate": "CPU",
        "fps": 24.4864789508599,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 7977,
        "delegate": "CPU",
        "fps": 24.458604147730235,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 8622,
        "delegate": "CPU",
        "fps": 22.99974835029716,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 9198,
        "delegate": "CPU",
        "fps": 24.813652657227074,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 9809,
        "delegate": "CPU",
        "fps": 31.085570081052605,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      }
    ],
    "final": {
      "tMs": 9809,
      "delegate": "CPU",
      "fps": 31.085570081052605,
      "inference": null,
      "health": {
        "stalls": 0,
        "consecutiveDetectErrors": 0,
        "lastError": null
      }
    },
    "consoleErrors": [
      "[console.error] The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.",
      "[console.error] INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
    ],
    "minFps": 22.99974835029716
  },
  {
    "name": "cpu-forzado (UA Safari 16, WebKit < 17)",
    "spoofUserAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "webglRenderer": "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "error": null,
    "samples": [
      {
        "tMs": 36,
        "delegate": "CPU",
        "fps": 24.295371161360656,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 553,
        "delegate": "CPU",
        "fps": 25.848776227197398,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 1097,
        "delegate": "CPU",
        "fps": 24.311582471803092,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 1638,
        "delegate": "CPU",
        "fps": 24.393807075146576,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 2159,
        "delegate": "CPU",
        "fps": 27.44487951199428,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 2676,
        "delegate": "CPU",
        "fps": 26.347537584016294,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 3203,
        "delegate": "CPU",
        "fps": 24.546732116453075,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 3725,
        "delegate": "CPU",
        "fps": 25.748367913440497,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 4252,
        "delegate": "CPU",
        "fps": 30.310033066936214,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 4774,
        "delegate": "CPU",
        "fps": 27.973758194804066,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 5306,
        "delegate": "CPU",
        "fps": 27.714493445739503,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 5841,
        "delegate": "CPU",
        "fps": 24.424166691401,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 6358,
        "delegate": "CPU",
        "fps": 25.53836113257727,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 6879,
        "delegate": "CPU",
        "fps": 24.38993864734922,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 7401,
        "delegate": "CPU",
        "fps": 25.648837102052475,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 7924,
        "delegate": "CPU",
        "fps": 26.18959856074349,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 8447,
        "delegate": "CPU",
        "fps": 29.499690788517235,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 9187,
        "delegate": "CPU",
        "fps": 26.332164080255136,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      },
      {
        "tMs": 9724,
        "delegate": "CPU",
        "fps": 27.437354939344825,
        "inference": null,
        "health": {
          "stalls": 0,
          "consecutiveDetectErrors": 0,
          "lastError": null
        }
      }
    ],
    "final": {
      "tMs": 9724,
      "delegate": "CPU",
      "fps": 27.437354939344825,
      "inference": null,
      "health": {
        "stalls": 0,
        "consecutiveDetectErrors": 0,
        "lastError": null
      }
    },
    "consoleErrors": [
      "[console.error] The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.",
      "[console.error] INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
    ],
    "minFps": 24.295371161360656
  }
]
```

</details>
