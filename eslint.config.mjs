import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React 19 / React Compiler rules. These flag patterns the existing
    // codebase uses intentionally (post-mount hydration setState; manual
    // useCallback/useMemo); revisit and refactor against the new Compiler
    // guidance in a focused follow-up PR. Treating them as `warn` keeps
    // them visible in CI output without gating the build.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // The React Compiler also flags use-before-declaration through
      // `immutability` (e.g. a useCallback referenced from an earlier
      // useEffect via closure capture). The existing pattern is safe at
      // runtime; keep it informational and tighten in a follow-up.
      "react-hooks/immutability": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // Apostrophes in JSX text are routinely safe; this is a stylistic
      // preference rather than a correctness signal.
      "react/no-unescaped-entities": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Don't lint binary / Rust / vendored content even if it happens to
    // sit under a scanned directory.
    "src-tauri/**",
    "public/**",
    "landing/**/*.png",
    "**/*.png",
    "**/*.ico",
    "**/*.icns",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.webp",
    "**/*.ttf",
    "**/*.woff",
    "**/*.woff2",
  ]),
]);

export default eslintConfig;
