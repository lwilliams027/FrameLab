// ============================================================
// Supabase client (singleton)
// ============================================================
// Reads project URL + anon key from Vite env vars at build time.
// In dev: define them in `.env.local` at the project root.
// In prod (GitHub Actions): they come from repo secrets, baked
// into the static bundle by the workflow's `env:` block.
//
// The anon key is intentionally public — it's what the browser
// uses to talk to Supabase. RLS policies in the database control
// what it can actually do.
// ============================================================

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Don't crash the app — let the Frame Data tab show a friendly
  // "missing config" panel and the rest of the UI still works
  // against in-memory state. This makes local dev forgiving.
  console.warn(
    "[supabase] VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set. " +
    "Frame Data and combos will not persist across reloads. " +
    "See SUPABASE_SETUP.md for how to set them."
  );
}

export const supabase = url && key ? createClient(url, key) : null;

/** True if the client is configured and ready to make requests. */
export const isSupabaseEnabled = () => supabase !== null;

/** Public URL for a stored video file. */
export function videoPublicUrl(storagePath) {
  if (!supabase || !storagePath) return null;
  const { data } = supabase.storage.from("frame-videos").getPublicUrl(storagePath);
  return data?.publicUrl || null;
}
