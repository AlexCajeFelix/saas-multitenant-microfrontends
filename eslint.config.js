import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Edge Functions e testes sao Deno: `deno lint` cuida deles no CI.
    ignores: ["**/dist", "**/.vercel", "**/.turbo", "supabase/**", "tests/**", "coverage"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Divida conhecida: telas herdadas resetam formulario a partir de dado
      // carregado com setState em efeito. Funciona; migrar para `key` ou
      // estado derivado e trabalho a parte. Regra desligada ate la.
      "react-hooks/set-state-in-effect": "off",
      // Provedores exportam o hook junto (useAuth, useTenant...), de proposito.
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../packages/*", "../../../packages/*", "../../apps/*"],
              message: "Use @saas/platform/... em vez de caminho relativo entre pacotes.",
            },
          ],
        },
      ],
    },
  },
  {
    // Configs e scripts rodam no Node.
    files: ["**/vite.config.ts", "packages/platform/vite.ts", "scripts/**/*.{js,mjs}", "*.js"],
    languageOptions: { globals: globals.node },
    rules: { "no-restricted-imports": "off" },
  },
);
