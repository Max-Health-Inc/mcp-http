// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Extend recommended + strict + stylistic type-checked rules
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Language options — enable typed linting
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-wide rule overrides
  {
    rules: {
      // Disallow floating promises and unhandled async control flow
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // Enforce explicit return types on exported functions
      "@typescript-eslint/explicit-module-boundary-types": "error",

      // Ban unsafe operations
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",

      // No explicit any — ever
      "@typescript-eslint/no-explicit-any": "error",

      // Prefer type imports for cleanliness
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Enforce exhaustive switch/if on union types
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // No unnecessary type assertions
      "@typescript-eslint/no-unnecessary-type-assertion": "error",

      // Require consistent array type notation
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],

      // Prefer nullish coalescing over ||
      "@typescript-eslint/prefer-nullish-coalescing": "error",

      // Prefer optional chaining
      "@typescript-eslint/prefer-optional-chain": "error",

      // Allow _-prefixed args/vars to be intentionally unused (TS convention)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Ignore built and generated artefacts
  {
    ignores: ["dist/**", "node_modules/**", "eslint.config.js"],
  },

  // Narrow, deliberate silencing. These files must keep exercising this
  // package's own deprecated surface while it still ships: `buildHandler` routes
  // to the deprecated stateful path when `stateful: true`, `protectedResourceResponse`
  // builds via the deprecated metadata builder, `index.ts` re-exports both, and
  // their tests must keep covering them until 0.4.0 removes them.
  //
  // The deprecation is a signal to CONSUMERS, delivered through JSDoc to their
  // editors. Anything NOT genuinely slated for removal should be un-deprecated
  // rather than added here — if this list grows, suspect the markers, not the rule.
  {
    files: [
      "src/handler.ts",
      "src/index.ts",
      // hosts the deprecated `handleMcpPostStateful`, which takes a `SessionStore`
      "src/transport.ts",
      "src/well-known.ts",
      "test/session-store.test.ts",
      "test/stateful.test.ts",
      "test/well-known.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },

  // Relaxed rules for test files: bun:test's expect() returns loosely typed
  // matchers that trigger unsafe-* rules. Tests are not production code.
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      // Allow explicit any in test helpers
      "@typescript-eslint/no-explicit-any": "warn",
      // bun-types adds `preconnect` to globalThis.fetch so tsc requires a
      // double-cast in mock assignments; ESLint incorrectly flags these as
      // unnecessary.  The suppression is intentional.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);
