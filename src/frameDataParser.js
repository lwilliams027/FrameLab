/**
 * Frame data parser — pulls move metadata, frame timings, and notify
 * events out of MultiVersus PfgFixedAnimDataAsset JSON exports.
 *
 * Lives in its own file (not co-located with FrameDataTab.jsx) so React
 * Fast Refresh can apply hot-module-replacement cleanly: the rule
 * `react-refresh/only-export-components` requires component files to
 * export ONLY components. Constants and helpers live here.
 */

/** MultiVersus uses 32.32 fixed-point: actual = data / 2^32 */
export const FIXED_SCALE = 4294967296;
export const FPS = 60;

export const CATEGORY_LABELS = {
  Nav: "Movement",
  Atk: "Attack",
  Attack: "Attack",
  Sig: "Signature",
  Hit: "Reaction",
  Def: "Defense",
  Tnt: "Taunt",
  Emo: "Emote",
};

export function fp(value) {
  if (value == null) return 0;
  if (typeof value === "object" && "Data" in value) value = value.Data;
  return value / FIXED_SCALE;
}

export function secondsToFrames(seconds) {
  return Math.round(seconds * FPS);
}

export function cleanNotifyName(name) {
  return name.replace(/^AnimNotify_/, "").replace(/_C$/, "").replace(/_NotifyState$/, "");
}

export function classifyNotify(name) {
  const n = name.toLowerCase();
  if (n.includes("hitbox")) return "hitbox";
  if (n.includes("actionbranch") || n.includes("branch")) return "branch";
  return "default";
}

export function parseMoveName(rawName) {
  const cleaned = rawName.replace(/_Montage(_FAD)?$/, "").replace(/^Mvs_/, "");
  const parts = cleaned.split("_");
  let character = "Unknown", category = "Misc", action = cleaned;
  if (parts.length >= 3) {
    character = parts[0];
    category = parts[1];
    action = parts.slice(2).join(" ");
  } else if (parts.length === 2) {
    character = parts[0];
    action = parts[1];
  }
  action = action.replace(/([a-z])([A-Z])/g, "$1 $2");
  return { character, category, action };
}

/**
 * Parse a PfgFixedAnimDataAsset JSON (single object or array).
 * Returns an array of normalized move objects ready for UI consumption.
 */
export function parseAsset(json) {
  const arr = Array.isArray(json) ? json : [json];
  const moves = [];
  for (const asset of arr) {
    if (asset.Type !== "PfgFixedAnimDataAsset") continue;
    const props = asset.Properties || {};
    const parsed = parseMoveName(asset.Name || "");
    const durationSec = fp(props.Duration);
    const durationFrames = secondsToFrames(durationSec);

    const notifies = (props.NotifyData || []).map(n => ({
      name: n.NotifyName || "Unknown",
      startSec: fp(n.startTime),
      endSec: fp(n.EndTime),
      startFrame: secondsToFrames(fp(n.startTime)),
      endFrame: secondsToFrames(fp(n.EndTime)),
      track: n.TrackIndex ?? 0,
      group: n.GroupName || "",
    }));

    const sections = (props.SectionData || []).map(s => ({
      name: s.SectionName || "Unnamed",
      next: s.NextSectionName || "",
      startFrame: secondsToFrames(fp(s.startTime)),
      endFrame: secondsToFrames(fp(s.EndTime)),
    }));

    let boneCount = 0, socketCount = 0, slotCount = 0, curveCount = 0;
    const slotSets = props.SlotSets || [];
    for (const slot of slotSets) {
      slotCount++;
      const inner = slot.Value?.SlotSet || [];
      boneCount += inner.length;
      for (const b of inner) socketCount += (b.Value?.SocketTransforms || []).length;
      curveCount += (slot.Value?.VisibilityCurves || []).length;
    }

    moves.push({
      id: asset.Name,
      ...parsed,
      durationSec,
      durationFrames,
      notifies,
      sections,
      boneCount,
      socketCount,
      slotCount,
      curveCount,
      refMontage: props.ReferenceMontage?.AssetPathName || "",
    });
  }
  return moves;
}

/**
 * Parse a UE AnimMontage JSON export (the unbaked source for a FAD).
 *
 * The Montage carries MUCH richer notify data than the corresponding FAD —
 * each notify has a real `Duration` field (the FAD only stores start/end
 * frame indices), plus object paths to the underlying NotifyState classes
 * (so we can identify hitbox vs branch vs sound notifies more reliably).
 *
 * Returns: { id, durationSec, durationFrames, notifies, compositeSections }
 *          or null if the JSON didn't contain an AnimMontage.
 */
export function parseMontage(json) {
  const arr = Array.isArray(json) ? json : [json];
  const montage = arr.find(o => o.Type === "AnimMontage");
  if (!montage) return null;
  const props = montage.Properties || {};

  // Montage uses raw seconds (not fixed-point) for these fields
  const num = (v) => (typeof v === "number" ? v : 0);

  const durationSec = num(props.SequenceLength);
  const durationFrames = secondsToFrames(durationSec);

  const notifies = (props.Notifies || []).map(n => {
    const startSec = num(n.TriggerTimeOffset);
    const dur = num(n.Duration);
    const endSec = startSec + dur;
    // Strip the "MvsActionBranchNotifyState_*" / "AnimNotify_*" prefixes so
    // hitbox/branch detection in FrameDataTab still works the same way.
    const rawName = n.NotifyName || "Unknown";
    const cls = n.NotifyStateClass?.ObjectName || n.Notify?.ObjectName || "";
    return {
      name: rawName,
      classObject: cls,
      startSec, endSec,
      startFrame: secondsToFrames(Math.max(0, startSec)),
      endFrame:   secondsToFrames(Math.max(0, endSec)),
      durationSec: dur,
      track: n.TrackIndex ?? 0,
      // Original notify body is preserved for advanced inspectors
      raw: n,
    };
  });

  const compositeSections = (props.CompositeSections || []).map(s => ({
    name: s.SectionName || "Unnamed",
    next: s.NextSectionName || "",
    startSec: num(s.SegmentBeginTime),
    durationSec: num(s.SegmentLength),
  }));

  return {
    id: montage.Name,
    durationSec,
    durationFrames,
    notifies,
    compositeSections,
  };
}

/**
 * Merge a parsed Montage on top of a parsed move (from parseAsset).
 *
 * The FAD's notifies stay as the source of truth for frame indices (they're
 * baked from animation playback, so most accurate). The Montage's notifies
 * fill in `durationSec` and `classObject` fields where the FAD lacks them.
 * Any montage notify NOT present in the FAD gets appended.
 *
 * Returns a new move object — does not mutate the input.
 */
export function mergeMontageIntoMove(move, montage) {
  if (!move || !montage) return move;

  const fadCleanNames = move.notifies.map(n => cleanNotifyName(n.name).toLowerCase());

  // Augment FAD notifies with montage extras (duration + classObject)
  const augmented = move.notifies.map(n => {
    const cn = cleanNotifyName(n.name).toLowerCase();
    const m = montage.notifies.find(mm => {
      const mcn = cleanNotifyName(mm.name).toLowerCase();
      return mcn === cn && Math.abs(mm.startFrame - n.startFrame) <= 2;
    });
    if (!m) return n;
    return {
      ...n,
      durationSec: m.durationSec,
      classObject: m.classObject,
    };
  });

  // Append any montage-only notifies (rare — usually audio events with
  // negative offsets that don't show up in the FAD)
  const usedMontageIdxs = new Set();
  for (let i = 0; i < move.notifies.length; i++) {
    const cn = cleanNotifyName(move.notifies[i].name).toLowerCase();
    const idx = montage.notifies.findIndex((mm, mi) => {
      if (usedMontageIdxs.has(mi)) return false;
      const mcn = cleanNotifyName(mm.name).toLowerCase();
      return mcn === cn && Math.abs(mm.startFrame - move.notifies[i].startFrame) <= 2;
    });
    if (idx >= 0) usedMontageIdxs.add(idx);
  }
  for (let mi = 0; mi < montage.notifies.length; mi++) {
    if (usedMontageIdxs.has(mi)) continue;
    augmented.push(montage.notifies[mi]);
  }

  return {
    ...move,
    notifies: augmented,
    montageSections: montage.compositeSections,
    hasMontage: true,
  };
}

/**
 * Compute fighting-game frame data (startup, active, recovery, FAF) from a
 * move's notify events. Returns null for non-attack moves.
 */
export function deriveAttackStats(move) {
  const isHitbox = (n) => /hitbox/i.test(n.name);
  const isImmediate = (n) =>
    /actionbranch/i.test(n.name) && /immediate/i.test(n.name);
  const isQueued = (n) =>
    /actionbranch/i.test(n.name) && /queued/i.test(n.name);

  const hitboxes = move.notifies.filter(isHitbox).sort((a, b) => a.startFrame - b.startFrame);
  if (hitboxes.length === 0) return null;

  const firstActive = hitboxes[0].startFrame;
  const lastActive = Math.max(...hitboxes.map(h => h.endFrame));

  const activeWindows = hitboxes.map(h => ({
    startFrame: h.startFrame,
    endFrame: h.endFrame,
    duration: Math.max(1, h.endFrame - h.startFrame + 1),
  }));
  const totalActive = activeWindows.reduce((s, w) => s + w.duration, 0);
  const recovery = Math.max(0, move.durationFrames - lastActive - 1);

  const immediateBranches = move.notifies.filter(isImmediate);
  const faf = immediateBranches.length > 0
    ? Math.min(...immediateBranches.map(n => n.startFrame))
    : null;

  const queuedBranches = move.notifies.filter(isQueued);
  const cancelBuffer = queuedBranches.length > 0
    ? Math.min(...queuedBranches.map(n => n.startFrame))
    : null;

  return {
    startup: firstActive,
    active: totalActive,
    activeWindows,
    recovery,
    total: move.durationFrames,
    faf,
    cancelBuffer,
    hitboxCount: hitboxes.length,
  };
}

// ============================================================
// Placeholder slot generator
// ============================================================

/**
 * Standard fighting-game move slots — one row per (button, direction, type).
 * Used to seed empty Frame Data entries for every character so users only
 * need to attach videos.
 */
export const PLACEHOLDER_SLOTS = [
  { button: "Attack",  dir: "Neutral",  label: "Neutral Attack",  type: "Grounded", air: false },
  { button: "Attack",  dir: "Forward",  label: "Forward Attack",  type: "Grounded", air: false },
  { button: "Attack",  dir: "Up",       label: "Up Attack",       type: "Grounded", air: false },
  { button: "Attack",  dir: "Down",     label: "Down Attack",     type: "Grounded", air: false },
  { button: "Attack",  dir: "Neutral",  label: "Neutral Air",     type: "Aerial",   air: true  },
  { button: "Attack",  dir: "Forward",  label: "Forward Air",     type: "Aerial",   air: true  },
  { button: "Attack",  dir: "Up",       label: "Up Air",          type: "Aerial",   air: true  },
  { button: "Attack",  dir: "Down",     label: "Down Air",        type: "Aerial",   air: true  },
  { button: "Special", dir: "Neutral",  label: "Neutral Special", type: "Grounded", air: false },
  { button: "Special", dir: "Forward",  label: "Forward Special", type: "Grounded", air: false },
  { button: "Special", dir: "Up",       label: "Up Special",      type: "Grounded", air: false },
  { button: "Special", dir: "Down",     label: "Down Special",    type: "Grounded", air: false },
  { button: "Grab",    dir: "Neutral",  label: "Grab",            type: "Grab",     air: false },
];

/**
 * Build a deterministic placeholder ID for a given character + slot.
 * Same inputs always produce the same ID so re-running won't duplicate.
 */
export function placeholderId(character, slot) {
  const c = character.replace(/[^A-Za-z0-9]/g, "");
  const a = (slot.air ? "Air" : "") + slot.label.replace(/\s+/g, "");
  return `Placeholder_${c}_${a}`;
}

/**
 * Build placeholder Frame Data move entries for every (character × slot).
 * Returns: { [id]: moveObject }
 *
 * Pass `existing` (the current state.frameData.moves) to skip IDs already
 * present — protects real, parsed data from being overwritten.
 */
export function buildPlaceholderMoves(characters, existing = {}) {
  const out = {};
  for (const character of characters) {
    for (const slot of PLACEHOLDER_SLOTS) {
      const id = placeholderId(character, slot);
      if (existing[id]) continue;
      out[id] = {
        id,
        character,
        category: "Attack",
        action: slot.label,
        durationSec: 1.0,
        durationFrames: 60,
        notifies: [],
        sections: [],
        boneCount: 0,
        socketCount: 0,
        slotCount: 0,
        curveCount: 0,
        refMontage: "",
        isPlaceholder: true,
        buttonInput: slot.button,
        inputDirection: slot.dir,
        moveType: slot.type,
      };
    }
  }
  return out;
}
