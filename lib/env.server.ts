import "server-only";
import { z } from "zod";

/**
 * Only the Supabase-related vars live here, so importing this module (and
 * therefore validating/loading it) is scoped to code paths that actually talk
 * to Supabase — public pages that never touch Supabase never pay for this.
 */
const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url({
    message:
      "NEXT_PUBLIC_SUPABASE_URL is missing or not a valid URL. Copy .env.example to .env.local and fill in your Supabase development project's URL.",
  }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1, {
    message:
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. Copy .env.example to .env.local and fill in your Supabase development project's publishable key.",
  }),
});

const parsed = supabaseEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

if (!parsed.success) {
  const messages = parsed.error.issues.map((issue) => `- ${issue.message}`);
  throw new Error(
    `Invalid or missing environment variables:\n${messages.join("\n")}`,
  );
}

export const env = parsed.data;

/**
 * Service-role/admin env vars — a deliberately separate schema and export
 * from `env` above, so nothing that imports this module for the ordinary
 * publishable-key config also silently pulls in the secret schema. Only
 * `lib/supabase/admin.ts` and `lib/story/image-pipeline.ts` (the one narrow
 * module that module is allowed to be imported from) ever read `adminEnv`.
 */
const adminEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, {
    message:
      "SUPABASE_SERVICE_ROLE_KEY is missing. Required for the image-processing pipeline (lib/story/image-pipeline.ts) — never expose this to browser-accessible code (Engineering Rule 1).",
  }),
});

let cachedAdminEnv: z.infer<typeof adminEnvSchema> | undefined;

export function getAdminEnv() {
  if (!cachedAdminEnv) {
    const parsedAdmin = adminEnvSchema.safeParse({
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    if (!parsedAdmin.success) {
      const messages = parsedAdmin.error.issues.map(
        (issue) => `- ${issue.message}`,
      );
      throw new Error(
        `Invalid or missing environment variables:\n${messages.join("\n")}`,
      );
    }
    cachedAdminEnv = parsedAdmin.data;
  }
  return cachedAdminEnv;
}
