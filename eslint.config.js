// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "*.config.*", "claude-scratch-*"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
  },
  // Los scripts de Node (smoke tests, build helpers) corren en Node, no en el
  // browser: les damos los globals de Node (process, etc.).
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Invariante de arquitectura como gate, no como convención (ver la sección
  // "Estándar nivel mundial" del CLAUDE.md). La flecha de dependencias apunta a
  // `src/domain`: los shells (ui, render, inference, camera) dependen del dominio
  // puro y nunca al revés. El estándar que copiamos: en un repo de referencia el
  // boundary es un hecho chequeado por CI (allowlist default-deny, estilo
  // import-boss de Kubernetes), no un acuerdo que se pierde en el tercer refactor.
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/render/**", "**/ui/**", "**/inference/**", "**/camera/**"],
              message:
                "src/domain es dominio puro: no puede importar de los shells (render, ui, inference, camera).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/inference/**/*.ts", "src/camera/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/render/**", "**/ui/**"],
              message:
                "La capa de inferencia/cámara no conoce la presentación: importá del dominio, no de render ni de ui.",
            },
          ],
        },
      ],
    },
  },
  // Prettier va al final: desactiva reglas de formato (las maneja Prettier).
  prettier,
);
