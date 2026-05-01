// ============================================================
// Frame Data + Characters persistence
// ============================================================
// Game-scoped helpers for the per-game roster and move catalog.
// Loaded once per game on tab open, then mutations write through
// to Supabase + the in-memory reducer cache.
// ============================================================

import { supabase, videoPublicUrl } from "../supabase.js";

// ─── Mappers ─────────────────────────────────────────────────
function rowToCharacter(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    shortName: row.short_name || row.name,
    archetype: row.archetype || null,
    sortOrder: row.sort_order || 0,
  };
}

function rowToMove(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    characterId: row.character_id,
    category: row.category || "Attack",
    action: row.action,
    isPlaceholder: !!row.is_placeholder,
    buttonInput: row.button_input,
    inputDirection: row.input_direction,
    moveType: row.move_type,
    durationSec: Number(row.duration_sec) || 1.0,
    durationFrames: row.duration_frames || 60,
    notifies: Array.isArray(row.notifies) ? row.notifies : [],
    sections: Array.isArray(row.sections) ? row.sections : [],
    montageSections: Array.isArray(row.montage_sections) ? row.montage_sections : [],
    attackData: row.attack_data || null,
    hitboxStates: Array.isArray(row.hitbox_states) ? row.hitbox_states : [],
    movementData: row.movement_data || null,
    refMontage: row.ref_montage || "",
    boneCount: row.bone_count || 0,
    socketCount: row.socket_count || 0,
    slotCount: row.slot_count || 0,
    curveCount: row.curve_count || 0,
    hasMontage: !!row.has_montage,
  };
}

function moveToRow(move) {
  if (!move.gameId)      throw new Error("Move needs a gameId");
  if (!move.characterId) throw new Error("Move needs a characterId");
  return {
    id: move.id,
    game_id: move.gameId,
    character_id: move.characterId,
    category: move.category || "Attack",
    action: move.action,
    is_placeholder: !!move.isPlaceholder,
    button_input: move.buttonInput || null,
    input_direction: move.inputDirection || null,
    move_type: move.moveType || null,
    duration_sec: Number(move.durationSec) || 1.0,
    duration_frames: move.durationFrames || 60,
    notifies: move.notifies || [],
    sections: move.sections || [],
    montage_sections: move.montageSections || [],
    attack_data: move.attackData || null,
    hitbox_states: move.hitboxStates || [],
    movement_data: move.movementData || null,
    ref_montage: move.refMontage || "",
    bone_count: move.boneCount || 0,
    socket_count: move.socketCount || 0,
    slot_count: move.slotCount || 0,
    curve_count: move.curveCount || 0,
    has_montage: !!move.hasMontage,
  };
}

// ─── Loaders ─────────────────────────────────────────────────

/** List the roster for one game, sorted by sort_order then name. */
export async function listGames() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("enabled", true)
    .order("sort_order");
  if (error) { console.error("[games] list failed:", error); return []; }
  return data || [];
}

export async function listCharacters(gameId) {
  if (!supabase || !gameId) return [];
  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("game_id", gameId)
    .order("sort_order");
  if (error) { console.error("[chars] list failed:", error); return []; }
  return (data || []).map(rowToCharacter);
}

/**
 * Load EVERY frame-data table needed to render the Frame Data tab
 * for one game in a single round trip.
 * Returns: { moves: {id→move}, media: {moveId→media}, stats: {moveId→stats} }
 */
export async function loadFrameDataForGame(gameId) {
  if (!supabase || !gameId) return { moves: {}, media: {}, stats: {} };

  const movesPromise = supabase.from("frame_data_moves").select("*").eq("game_id", gameId);
  // media + stats join via move_id; we filter by game by joining through moves on the client
  const mediaPromise = supabase
    .from("frame_data_media")
    .select("*, frame_data_moves!inner(game_id)")
    .eq("frame_data_moves.game_id", gameId);
  const statsPromise = supabase
    .from("frame_data_stats")
    .select("*, frame_data_moves!inner(game_id)")
    .eq("frame_data_moves.game_id", gameId);

  const [movesRes, mediaRes, statsRes] = await Promise.all([movesPromise, mediaPromise, statsPromise]);

  if (movesRes.error) console.error("[fd] moves load failed:", movesRes.error);
  if (mediaRes.error) console.error("[fd] media load failed:", mediaRes.error);
  if (statsRes.error) console.error("[fd] stats load failed:", statsRes.error);

  const moves = {};
  for (const row of (movesRes.data || [])) moves[row.id] = rowToMove(row);

  const media = {};
  for (const row of (mediaRes.data || [])) {
    media[row.move_id] = {
      url: videoPublicUrl(row.storage_path),
      storagePath: row.storage_path,
      type: row.media_type || "video",
      name: row.original_name || "",
      size: row.size_bytes || 0,
      mimeType: row.mime_type,
      processed: row.processed || null,
      persisted: true,
    };
  }

  const stats = {};
  for (const row of (statsRes.data || [])) {
    stats[row.move_id] = {
      killPercent: row.kill_percent != null ? Number(row.kill_percent) : null,
      damage: row.damage != null ? Number(row.damage) : null,
      notes: row.notes || "",
      ...(row.extra || {}),
    };
  }

  return { moves, media, stats };
}

// ─── Move CRUD ───────────────────────────────────────────────

export async function upsertMove(move) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("frame_data_moves")
    .upsert(moveToRow(move), { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return rowToMove(data);
}

export async function deleteMove(id) {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.from("frame_data_moves").delete().eq("id", id);
  if (error) throw error;
}

// ─── Media (storage + table row) ─────────────────────────────

export async function attachMediaToMove(moveId, fileOrBlob, opts = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  const ext = (opts.extension || guessExtensionFromMime(fileOrBlob.type) || "webm").replace(/^\./, "");
  const safeName = opts.originalName || (fileOrBlob.name || `${moveId}.${ext}`);
  // Path format: <gameId>/<moveId>/<timestamp>.<ext>
  // Note moveId already contains gameId prefix; still nest for visual clarity.
  const path = `${moveId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("frame-videos")
    .upload(path, fileOrBlob, {
      cacheControl: "3600",
      contentType: fileOrBlob.type || "video/webm",
      upsert: false,
    });
  if (upErr) throw upErr;

  const row = {
    move_id: moveId,
    storage_path: path,
    media_type: fileOrBlob.type?.startsWith("image/") ? "image" : "video",
    original_name: safeName,
    size_bytes: fileOrBlob.size || 0,
    mime_type: fileOrBlob.type || null,
    processed: opts.processed || null,
  };
  const { data, error } = await supabase
    .from("frame_data_media")
    .upsert(row, { onConflict: "move_id" })
    .select()
    .single();
  if (error) {
    await supabase.storage.from("frame-videos").remove([path]).catch(() => {});
    throw error;
  }
  return {
    url: videoPublicUrl(path),
    storagePath: path,
    type: data.media_type,
    name: data.original_name,
    size: data.size_bytes,
    mimeType: data.mime_type,
    processed: data.processed,
    persisted: true,
  };
}

export async function detachMediaFromMove(moveId) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: existing } = await supabase
    .from("frame_data_media")
    .select("storage_path")
    .eq("move_id", moveId)
    .maybeSingle();
  if (existing?.storage_path) {
    await supabase.storage.from("frame-videos").remove([existing.storage_path]).catch(() => {});
  }
  const { error } = await supabase.from("frame_data_media").delete().eq("move_id", moveId);
  if (error) throw error;
}

// ─── Stats ───────────────────────────────────────────────────

export async function upsertStats(moveId, stats) {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase
    .from("frame_data_stats")
    .upsert(
      {
        move_id: moveId,
        kill_percent: stats.killPercent ?? null,
        damage: stats.damage ?? null,
        notes: stats.notes ?? "",
        extra: stats.extra ?? null,
      },
      { onConflict: "move_id" }
    );
  if (error) throw error;
}

export async function deleteStats(moveId) {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.from("frame_data_stats").delete().eq("move_id", moveId);
  if (error) throw error;
}

// ─── Helpers ─────────────────────────────────────────────────

function guessExtensionFromMime(mime) {
  if (!mime) return null;
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return null;
}
