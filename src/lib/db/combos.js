// ============================================================
// Combo persistence — read/write against `public.combos`
// ============================================================
// All helpers are scoped by `game_id` so the same UI code can
// drive any game. Mappers translate between snake_case rows and
// the camelCase JS objects the reducer prefers.
// ============================================================

import { supabase } from "../supabase.js";

function rowToCombo(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    characterId: row.character_id,
    totalDamage: Number(row.total_damage) || 0,
    startPercent: Number(row.start_percent) || 0,
    endPercent: Number(row.end_percent) || 100,
    killConfirm: !!row.kill_confirm,
    notes: row.notes || "",
    sequence: Array.isArray(row.sequence) ? row.sequence : [],
    sourceMatchId: row.source_match_id || null,
    sourceSegmentIds: row.source_segment_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function comboToRow(combo) {
  if (!combo.gameId) throw new Error("Combo needs a gameId");
  if (!combo.characterId) throw new Error("Combo needs a characterId");
  return {
    ...(combo.id && isUuid(combo.id) ? { id: combo.id } : {}),
    game_id: combo.gameId,
    character_id: combo.characterId,
    total_damage: Number(combo.totalDamage) || 0,
    start_percent: Number(combo.startPercent) || 0,
    end_percent: Number(combo.endPercent) || 100,
    kill_confirm: !!combo.killConfirm,
    notes: combo.notes || "",
    sequence: combo.sequence || [],
    source_match_id: combo.sourceMatchId || null,
    source_segment_ids: combo.sourceSegmentIds || [],
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id) => UUID_RE.test(id || "");

/** List combos for a single game. */
export async function listCombos(gameId) {
  if (!supabase || !gameId) return [];
  const { data, error } = await supabase
    .from("combos")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[combos] list failed:", error);
    return [];
  }
  return (data || []).map(rowToCombo);
}

export async function upsertCombo(combo) {
  if (!supabase) throw new Error("Supabase not configured");
  const row = comboToRow(combo);
  const { data, error } = await supabase
    .from("combos")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return rowToCombo(data);
}

export async function insertCombo(combo) {
  if (!supabase) throw new Error("Supabase not configured");
  const row = comboToRow(combo);
  delete row.id;
  const { data, error } = await supabase
    .from("combos")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return rowToCombo(data);
}

export async function deleteCombo(id) {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.from("combos").delete().eq("id", id);
  if (error) throw error;
}
