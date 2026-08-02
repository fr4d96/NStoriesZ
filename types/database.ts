// PLACEHOLDER — NOT GENERATED.
//
// No schema exists yet (Prompt 1 is the application foundation only), so
// this is a hand-written stand-in for an empty `public` schema, not real CLI
// output. Replace it by running one of:
//   npm run supabase:types          (local stack — needs Docker)
//   npm run supabase:types:linked   (linked Supabase development project)

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
