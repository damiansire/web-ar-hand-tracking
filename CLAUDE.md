# CLAUDE.md - web-ar-hand-tracking

Instrucciones de este repo para cualquier agente (o humano) que lo toque.
Contexto: app web de realidad aumentada client-side. Cámara (`getUserMedia`) ->
Web Worker con MediaPipe Hand Landmarker -> escena Three.js. TypeScript estricto +
Vite, sin backend, deploy estático a GitHub Pages.

Arquetipo: **app web creativa de AR client-side** (demo y showcase técnico).
Stacks contra los que se mide: `node-ts`, `creative` (Three.js, MediaPipe,
diseño), `web-mdn` (Web Workers), más las barras transversales de arquitectura y
TypeScript.

## Estándar nivel mundial

Esta sección es **build-time**: el código nace contra esta barra, no se audita
contra ella al final. Antes de escribir una feature, leé la regla que la toca.
Cada regla cita el saqueo del corpus del que sale (repo o spec real, no opinión).

### Piso de Craft (a-j)

Regla raíz, "intención clara / zero-guessing": el código tiene que ser tan
evidente que alguien senior entienda el **porqué** sin preguntar ni ejecutarlo.
_(corpus: `refs/architecture`, barra transversal destilada de la regla de
intención clara)_

- **a. El nombre revela la intención de dominio, no el mecanismo.** Nada de
  `data`, `handle`, `manager`, `process` donde el dominio tiene un término
  propio (`landmark`, `pinch`, `tier`, `back-pressure`).
- **b. Los comentarios explican POR QUÉ, nunca QUÉ.** Un comentario que
  parafrasea el código es señal de que hay que renombrar o extraer. El repo ya
  cumple esto en `back-pressure.ts` y `perf-governor.ts`: ese es el piso, no la
  excepción.
- **c. Superficie pública autodocumentada.** La firma (tipos, nombres, retorno)
  comunica el contrato sin leer el cuerpo.
- **d. Impacto mínimo al cambiar el core.** Un cambio de regla no obliga a
  editar N archivos dispersos. Valor por defecto duplicado en varios archivos =
  violación (caso vivo: los defaults de controles).
- **e. Features borrables sin cirugía.** Cada experiencia (`draw`, `catch`,
  `cosmos`, `lasers`) vive localizada detrás de la interfaz `Experience`;
  sacarla no debe dejar tentáculos en el shell.
- **f. Flujo de datos inmutable y rastreable.** El estado se deriva, no se muta
  a escondidas. La máquina de estados (`app-state.ts`) es la única fuente de
  verdad del ciclo de vida de la app.
- **g. Consistencia ante excepción.** Si algo falla, el estado queda consistente
  o recuperable, nunca a medias. Todo guard o flag "in flight" se libera en
  `finally`, no en el camino feliz (caso vivo: el guard del bloom).
- **h. Los boundaries comunican lo que pasa.** Fallo tragado en un boundary
  (worker, cámara, carga de assets) = violación. Un `detect-error` que se
  descarta sin señal al usuario ni al desarrollador no cumple.
- **i. Límites explícitos: timeouts, reintentos acotados, watchdog.** Todo gate
  que puede quedar tomado para siempre necesita su tope de tiempo y su camino de
  recuperación. Aplica al gate de back-pressure y a la carga del modelo.
- **j. Fail-closed donde importa.** Ante duda de seguridad o de integridad,
  denegar. Código de terceros que no valida integridad antes de ejecutarse es
  fail-open.

### Legibilidad en frío (k-m)

Que el artefacto demuestre lo que es en ~30 segundos, sin abrir el código. No
sube el craft: evita que buen trabajo quede **sub-descripto**.
_(corpus: `refs/architecture`, cluster de legibilidad en frío; refs OSS: guía de
GitLab para OSS y el README de 5 partes de GitHub)_

- **k. El README lidera con prueba visible y framing honesto.** Este repo es un
  artefacto **visual**: la descripción textual NO cuenta como prueba. El primer
  screenful necesita captura o GIF de la app corriendo, más el statement de
  qué-es y para-quién.
- **l. Donde prometés robustez o performance, la prueba está y es
  reproducible.** El repo promete performance (worker, governor, harness) y
  privacidad: cada promesa necesita su prueba ejecutable, con entorno declarado
  (máquina, versiones, metodología). Un documento de resultados que viene de una
  corrida fallida no cumple. _(ref: benchsuite de ripgrep, TechEmpower)_
- **m. Framing honesto: se declara el límite del claim.** Decí dónde NO aplica
  (oclusión calibrada para mano derecha, e2e fuera de CI, matriz de navegadores
  real). La vulnerabilidad calibrada da más confianza que un número pulido.
  _(ref: Gallant / ripgrep, "not universally faster")_

### Techo de Craft

El piso es `violated` / `ok`. Esto es lo que mueve el repo de "correcto" a
"referencia" (se copia tal cual). Idea rectora: **la calidad se vuelve un hecho
chequeado por la máquina, no una convención**.
_(corpus: `refs/architecture`, techo de craft, consenso 2026-07-09)_

- **Nombres y superficie:** imposible de malusar, no solo legible. Un contrato
  de boundary bien especificado y con UNA sola fuente (el protocolo del worker
  se declara una vez, no se transcribe a mano en tres lados). _(LLVM,
  type-state-builder)_
- **Encapsulamiento:** el boundary es un hecho de CI, allowlist default-deny de
  imports. _(import-boss de Kubernetes)_ En este repo: reglas
  `no-restricted-imports` por carpeta en `eslint.config.js`.
- **Integridad de estado:** invariante observable e inyectado con fallas. Un
  `assert` es una PRUEBA verificada en tests, distinto de un comentario
  "esto nunca pasa". _(SQLite, PostgreSQL)_
- **Observabilidad:** el contexto se captura en el ORIGEN y se renderiza
  diferido. _(tokio-rs/tracing-error)_
- **Resiliencia:** cap exponencial finito, jitter, y stop por presupuesto de
  tiempo. Un presupuesto por llamada, no reintentos anidados por capa.
  _(AWS Builders' Library, client-go, gRPC)_
- **Fail-closed:** la rama por defecto de toda decisión de integridad o permisos
  DENIEGA. _(RBAC de Kubernetes, `default allow := false` de Rego)_

> Al aplicar cada punto, distinguí lo **gateable por linter/CI** (regla dura) de
> lo que es **criterio de review** (juicio). Solo lo primero se puede prometer.

### Reglas enforzables del stack

#### TypeScript

_(corpus: `refs/typescript/strict-loopholes.md`, destilado de tRPC y Nx)_

1. **`any` explícito es BLOCKER.** Si la estructura es genuinamente desconocida,
   el tipo correcto es `unknown` y se valida antes de operar.
2. **`as Type` sin validación real es MAYOR a BLOCKER.** Excepción acotada a
   casos inevitables (WebGL, eventos DOM muy específicos), y aun ahí con type
   guard o chequeo runtime al lado.
3. **Discriminated unions con manejo exhaustivo.** Todo `switch` (o cadena
   `if/else`) sobre un union cierra con una rama que asigna a `never` y lanza.
   Aplica a `AppEvent`, a los mensajes del worker y a `ExperienceKind`.
4. **La strictness vive en UN solo `tsconfig.json`.** Un tsconfig hoja que
   re-declara flags de strictness es drift. _(corpus: `refs/node-ts`, base
   compartida de Backstage, Directus y n8n)_
5. **El techo de strictness es el de Directus** para un repo de este tamaño:
   `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
   `noImplicitOverride`, `noUncheckedIndexedAccess`, sin `allowUnreachableCode`
   ni `allowUnusedLabels`. Los cuatro primeros ya están puestos;
   `noUncheckedIndexedAccess` es deuda conocida (ver "Estado del retrofit").
   _(corpus: `refs/node-ts`, divergencia D1: codebase chica nace con el techo)_

#### App Node/TS y CI

_(corpus: `refs/node-ts/from-consensus-2026-07-16.md`, verificado contra
Backstage, n8n y Directus)_

6. **Typecheck es un gate de CI propio y bloqueante**, separado de lint y de
   build, sin `continue-on-error`.
7. **CI sin enmascaramiento de fallos:** cero `continue-on-error` y cero
   `|| true` que se traguen un error real en los workflows de PR. Las
   excepciones se documentan en el propio workflow.
8. **Actions de terceros pinneadas a SHA completo**, no a tag mutable.
9. **Supply-chain determinista:** allowlist de scripts de postinstall y lockfile
   sin duplicados como check, además del `npm audit` que ya corre.
10. **Nada de correr TypeScript en producción.** El entrypoint publicado sale de
    `dist/`. Acá es literal: lo que se publica a Pages es el build de Vite.
11. **Coverage con umbral es un gate real o no existe.** El umbral vive en
    `vitest.config.ts` y `npm test` lo corre, así que CI lo enforca. Se sube
    como ratchet, nunca se baja para que pase un cambio.
    _(honestidad del corpus: el ratchet de coverage es barra propia, no
    consenso OSS; ninguno de los repos top del set gatea coverage)_

#### Workers y off-main-thread

_(corpus: `refs/web-mdn/web-workers.md` sobre MDN, más la skill
`off-main-thread`)_

12. **Mover trabajo a un worker no acelera el cómputo: libera el main thread.**
    Los claims de performance se redactan como responsividad (INP), no como
    throughput.
13. **Transferir, no clonar.** `ImageBitmap` y `ArrayBuffer` cruzan el boundary
    como transferables; el emisor pierde el acceso y eso es lo esperado. Clonar
    un frame por `postMessage` es una regresión.
14. **No hay cleanup implícito de un worker.** Todo worker creado se termina
    (`terminate()` desde afuera o `self.close()` desde adentro). Un worker
    olvidado es un leak.
15. **Un protocolo ad-hoc de más de ~2 tipos de mensaje se esconde detrás de una
    capa tipada**, y el contrato se declara UNA vez (no copiado a mano en worker,
    cliente y test).

#### Render y Three.js

_(corpus: `refs/creative/from-mrdoob-three.js.md`, saqueo de mrdoob/three.js)_

16. **Cero allocation en el hot path.** Los temporales (`Vector3`, `Quaternion`,
    `Matrix4`) son singletons de módulo reutilizados por frame, no `new` por
    landmark. A 60fps por 21 landmarks, esto es presión de GC directa.
17. **`sideEffects` y treeshake explícitos**, nunca el default implícito.
    Imports nombrados de `three`, no `import * as THREE`.
18. **El tamaño del bundle es un check, no una impresión.** Si el chunk 3D
    crece, tiene que verse en un número.
19. **`InstancedMesh.count` se ajusta al conteo real dibujado.** Pagar siempre
    el peor caso de instancias es la regresión típica del render instanciado.
    _(skill `gpu-text-rendering`: una draw call, N celdas, hot path sin allocs)_

#### Inferencia y MediaPipe

_(corpus: `refs/creative/from-google-ai-edge-mediapipe.md`, saqueo de
google-ai-edge/mediapipe)_

20. **La detección de capacidades trata a WebKit como caso aparte.**
    "OffscreenCanvas existe" no implica "el delegate GPU sirve": Safari soporta
    WebGL2 sobre OffscreenCanvas recién desde la 17. La detección recibe
    `navigator` por parámetro para poder testearse.
21. **Reset explícito de estado por frame** en el camino de inferencia, o un
    comentario que explique por qué no hace falta. Es el bug clase MediaPipe de
    concatenar manos entre frames.
22. **Prohibido `any` en la capa de inferencia.** El tipo mínimo local más un
    test sin browser (con un módulo fake) reemplazan al `eslint-disable`.
23. **Errores accionables que nombran el campo exacto a cambiar**, al estilo de
    los guards de running-mode de MediaPipe.
24. **Gobernanza de PRs explícita** cuando la superficie es grande: el README
    dice qué clase de cambios se aceptan. _(mismo saqueo, `CONTRIBUTING.md`)_

#### UI viva y usable

_(corpus: `refs/creative/design-exemplars`: G1-G11 del saqueo de neal.fun,
G12-G19 anclados en WCAG 2.2, Nielsen Norman Group y Laws of UX)_

25. **Nada popea** (G2): todo elemento que entra o sale tiene transición >=150ms.
26. **Ack instantáneo** (G6, G12): el primer frame post-interacción ya muestra
    cambio; si algo va a tardar más de 400ms, hay indicador de progreso.
27. **`prefers-reduced-motion` cubre TODO el motion** (G7), no un subconjunto.
28. **Legibilidad primero** (G9, G19): sin scroll horizontal parásito, sin texto
    cortado, sin colisiones. La verificación es numérica
    (`getBoundingClientRect()` contra TODOS los vecinos), no a ojo.
29. **Targets >=24x24 px CSS** (G13) y contraste de texto >=4.5:1 (G14).
30. **Transiciones de 100 a 500ms** (G18): pasado eso el motion cruza de juice a
    fricción. Vivo no es ruidoso (G8): el motion tiene propósito.

#### Boundaries de arquitectura

31. **La flecha de dependencias apunta al dominio.** `src/domain` es puro: no
    importa de `render`, `ui`, `inference` ni `camera`. `inference` y `camera`
    no conocen la presentación. Esto está enforzado en `eslint.config.js` con
    `no-restricted-imports`, y el gate se verificó plantando una violación
    sintética (falla en rojo, no en silencio).
32. **`render` no importa de `ui`.** Los contratos de datos compartidos entre
    UI y render (por ejemplo el estado de los controles) viven en `src/domain`.
    Regla todavía NO enforzada por lint: hay una arista invertida viva (ver
    "Estado del retrofit").

### Documentación

- **El README nombra al proyecto igual que el manifest.** El título del README,
  el `name` de `package.json` y el nombre del repo son el mismo nombre. Si hay
  un nombre "de marca" distinto del slug, el README lo dice explícito en la
  primera línea, no lo deja como contradicción silenciosa.
- **No se linkea a archivos que no existen.** Todo link relativo del README
  apunta a una ruta viva del repo. El workflow `link-check.yml` lo gatea; un
  link nuevo se agrega con el gate en verde, no confiando en la vista previa.
- **El README no es un molde reciclado.** Nada de secciones heredadas de otro
  repo que no describen a este, ni promesas genéricas. Cada afirmación
  ("el video nunca sale de tu dispositivo", "corre en un worker", los números de
  performance) tiene que ser verificable contra el código o contra un test.
- **La tabla de experiencias es un contrato doc-código.** Espeja `EXPERIENCES`
  de `src/domain/experiences.ts`: si cambia una, cambian las dos en el mismo
  commit.
- **Si el README promete algo que el código no garantiza, se corrige el README o
  se construye la garantía.** No se deja la promesa suelta.

### Gates del repo

```bash
npm run format:check   # prettier
npm run lint           # eslint (incluye los boundaries de arquitectura)
npm run typecheck      # tsc --noEmit, estricto
npm test               # vitest + umbral de coverage
npm run build          # tsc --noEmit && vite build
npm run smoke:webgpu   # la escena real pinta píxeles de verdad
npm run test:e2e       # Playwright con cámara falsa y worker real
```

Ninguno se debilita para que pase un cambio. Si un gate molesta, se arregla el
código o se sube la barra, nunca al revés.

### Estado del retrofit

Enforzado hoy por la máquina:

- `tsconfig.json` con `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`,
  `allowUnreachableCode: false`, `allowUnusedLabels: false`, además del strict
  que ya estaba.
- `eslint.config.js` con `no-restricted-imports` por carpeta para los
  boundaries que hoy están limpios.
- Umbral de coverage en `vitest.config.ts`, corrido por `npm test` (y por CI).
- `.gitattributes` con `* text=auto eol=lf`.
- `engines.node >= 20.19.0` en `package.json`, alineado con lo que fija CI.

Deuda conocida (regla escrita, gate todavía NO puesto, con su motivo):

- `noUncheckedIndexedAccess`: prende ~40 errores reales de indexado en
  `catch-game.ts`, `occluder.ts` y `particle-field.ts`. Es trabajo de dominio,
  no de config: va como fix propio.
- Boundary `render` -> `ui`: `src/render/ar-scene.ts` importa `ControlsState`
  desde `src/ui/ar-controls.ts`. La regla de lint entra recién cuando
  `ControlsState` y sus defaults se muevan a `src/domain`.
- Actions pinneadas a SHA: requiere resolver los SHA reales de cada action y
  verificar el workflow en GitHub, no se puede validar localmente.
