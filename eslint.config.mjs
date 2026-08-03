import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const restrictedAdminClientImport = {
  name: "@/lib/supabase/admin",
  message:
    "lib/supabase/admin.ts (the service-role client) may only be imported from lib/story/image-pipeline.ts — the one narrow module that owns the image-processing/promotion trust boundary. Add the function you need there instead of importing the admin client directly.",
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
    files: ["lib/story/image-pipeline.ts"],
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
