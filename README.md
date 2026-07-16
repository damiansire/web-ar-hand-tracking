# AR Hand Figures

[![CI](https://github.com/damiansire/web-ar-hand-tracking/actions/workflows/ci.yml/badge.svg)](https://github.com/damiansire/web-ar-hand-tracking/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Augmented reality in the browser: it detects your hand with the camera and draws
a 3D figure that follows it in real time. Detection runs in a **Web Worker**
(MediaPipe Hand Landmarker) so the main thread stays unblocked, and the 3D
rendering is done with **Three.js**.

**▶ Live demo:** https://damiansire.github.io/web-ar-hand-tracking/
_(requires a camera; the video never leaves your device)_

> Complete rewrite of the original version (p5.js + ml5.js on the main thread).
> The stack was modernized, the pure domain was separated from the imperative
> _shells_, and inference was moved to a worker.

## What you can do

The app ships **5 creative experiences** selectable from the bottom picker (the
differentiator from the original p5.js + ml5.js version, which only tracked the
hand with a single figure). Each mode decides internally how it uses the hands:

| Mode           | What it does                                                                        |
| -------------- | ----------------------------------------------------------------------------------- |
| **3D Figures** | Move your hand: the figure follows it.                                              |
| **Draw**       | Draw with your index finger · pinch your fingers to move · open your hand to erase. |
| **Catch**      | Catch the circles with your hand and score points.                                  |
| **Cosmos**     | Move your hand: the nebula orbits · pinch to form a planet · release for the burst. |
| **Lasers**     | Your hand lights up in neon · show both hands for beams between them.               |

> This table mirrors `EXPERIENCES` in
> [`src/domain/experiences.ts`](src/domain/experiences.ts) (labels + hints); if
> you add or change a mode, update both so they don't drift out of sync.

### 3D Figures mode — detail

Choose between 6 3D figures that follow the hand (with **perspective**: closer =
bigger), adjust size/speed/opacity/material/color, show edges or wireframe,
shadow, **two hands** at once, colored background, **occlusion** (the figure goes
behind when you flip your hand — _calibrated for the right hand_: with the left
hand, occlusion triggers on the palm instead of the back), and **take a photo**
(downloads a PNG). When there's no hand, the figure stays as a preview in the
corner.

## How it works

```
┌───────────────── main thread ────────────────────┐      ┌──── Web Worker ────┐
│  camera (getUserMedia) ──► <video>                │      │  MediaPipe         │
│        │ ImageBitmap (transferable)               │ ───► │  HandLandmarker    │
│        ▼                                          │      │  (WASM + GPU)      │
│  Three.js  ◄── landmarks ──────────────────────── │ ◄─── │  detectForVideo()  │
│  (3D figure over the hand)                        │      └────────────────────┘
└───────────────────────────────────────────────────┘
```

- **`src/domain/`** — pure, tested logic (state machine, landmark-to-screen
  mapping, figure catalog). No DOM, no dependencies.
- **`src/camera/`** — camera access with typed errors.
- **`src/inference/`** — the MediaPipe worker and its client with back-pressure
  (a single frame in flight; if another arrives before the previous finishes, it
  is dropped).
- **`src/render/`** — Three.js scene with an orthographic camera mapped to pixels.
- **`src/ui/`** — screens (permission / loading / error) and the `<figure-selector>`.

## Requirements

- Node.js ≥ 20
- A browser with WebGL and `getUserMedia` (HTTPS or `localhost`).

## Development

```bash
npm install
npm run dev        # development server (Vite)
npm test           # domain tests (Vitest)
npm run typecheck  # TypeScript in strict mode
npm run format     # format with Prettier
npm run build      # production build to dist/
```

> The camera only works on `localhost` or over HTTPS (a browser requirement).

### End-to-end tests

`npm test` (Vitest) only covers the pure domain logic. The full pipeline
(camera capture → inference worker → render) is covered by Playwright
integration tests in [`e2e/`](e2e), which mock `getUserMedia` (no real camera
in CI) with an animated `<canvas>.captureStream()` but exercise everything
else for real — the real worker, the real MediaPipe model download, the real
`ARScene` render:

```bash
npm run test:e2e   # Playwright, e2e/pipeline.spec.ts
```

Not wired into `ci.yml` yet (it downloads the real model from the MediaPipe
CDN and takes ~30-40s); run it locally or add it as a separate CI job when
that trade-off is worth it.

### Performance

`scripts/perf-harness.mjs` measures **real** FPS and inference latency by
running the production build in headless Chromium under two conditions (WebGL2
delegate vs. the CPU fallback), reading the numbers the app itself
instruments with `performance.now()` (`HandTracker` latency,
`PerfGovernor`/`ARScene.fps`):

```bash
npm run build
npm run perf:harness
```

Writes the measured numbers to [`docs/perf/results.md`](docs/perf/results.md).

## Deployment

A workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
publishes `dist/` to **GitHub Pages** on every push to `main`/`master`. To
enable it: Settings → Pages → Source: **GitHub Actions**. The `base` is relative
(`./`), so it works both at the root and under a project sub-path.

## Model configuration

The MediaPipe assets (JS bundle + WASM + the `.task` model) are loaded from the
official CDN, pinned by version in [`src/config.ts`](src/config.ts). To
self-host them, copy those files to `public/` and change the URLs.

The worker is **classic** (not a module worker) and loads MediaPipe with
`importScripts`: MediaPipe requires it, and this way the same code runs the same
in the dev server and in the build. Details in
[`hand-landmarker.worker.ts`](src/inference/hand-landmarker.worker.ts).

## Stack

Vite · TypeScript · Three.js · @mediapipe/tasks-vision · Vitest
