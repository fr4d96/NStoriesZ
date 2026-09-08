import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const restrictedAdminClientImport = {
  name: "@/lib/supabase/admin",
  message:
    "lib/supabase/admin.ts (the service-role client) may only be imported from the two narrow modules that own a genuine privileged boundary: lib/story/image-pipeline.ts (image processing/promotion) and lib/auth/username-login.ts (username-to-email resolution at sign-in, which has no anon-safe alternative — see that file's header). Add the function you need to one of them instead of importing the admin client directly.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [restrictedAdminClientImport] },
      ],
    },
  },
  {
    // The service-role allowlist. Adding a file here widens the platform's
    // single most privileged boundary (Engineering Rule 1) — each entry
    // must justify itself in its own header comment.
    files: ["lib/story/image-pipeline.ts", "lib/auth/username-login.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
