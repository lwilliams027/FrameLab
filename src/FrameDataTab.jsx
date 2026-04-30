/**
 * FrameDataTab — MultiVersus animation asset viewer.
 *
 * Loads PfgFixedAnimDataAsset JSON exports plus optional video captures via a
 * manifest at /data/manifest.json. Each move is shown with a hero video panel,
 * a frame-accurate scrubber, and a multi-track timeline of notify events
 * (hitbox windows, action branches, sound triggers, etc.).
 *
 * State is local to this tab — it doesn't touch the global combo store.
 * Styling adapts to the existing MVSI design tokens (--accent, --bg2, etc.)
 * so it feels native to the rest of the app.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ============================================================
// CONSTANTS & DECODERS
// ============================================================

/** MultiVersus uses 32.32 fixed-point: actual = data / 2^32 */
const FIXED_SCALE = 4294967296;
const FPS = 60;

const CATEGORY_LABELS = {
  Nav: "Movement",
  Atk: "Attack",
  Attack: "Attack",
  Sig: "Signature",
  Hit: "Reaction",
  Def: "Defense",
  Tnt: "Taunt",
  Emo: "Emote",
};

function fp(value) {
  if (value == null) return 0;
  if (typeof value === "object" && "Data" in value) value = value.Data;
  return value / FIXED_SCALE;
}

function secondsToFrames(seconds) {
  return Math.round(seconds * FPS);
}

function cleanNotifyName(name) {
  return name.replace(/^AnimNotify_/, "").replace(/_C$/, "").replace(/_NotifyState$/, "");
}

function classifyNotify(name) {
  const n = name.toLowerCase();
  if (n.includes("hitbox")) return "hitbox";
  if (n.includes("actionbranch") || n.includes("branch")) return "branch";
  return "default";
}

// ============================================================
// PARSER
// ============================================================

function parseMoveName(rawName) {
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

function parseAsset(json) {
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

// ============================================================
// STYLES — adopts MVSI tokens, adds frame-data-specific layout
// ============================================================

const FRAMEDATA_STYLES = `
  .fd-layout { display: grid; grid-template-columns: 260px 1fr; gap: 20px; }
  @media(max-width: 900px) { .fd-layout { grid-template-columns: 1fr; } }

  /* Roster sidebar */
  .fd-roster {
    background: var(--bg2); border: 1px solid var(--line);
    border-radius: var(--r2); padding: 14px 0; max-height: calc(100vh - 200px);
    overflow-y: auto;
  }
  .fd-roster-empty {
    padding: 32px 16px; text-align: center; color: var(--text3); font-size: 13px;
  }
  .fd-char-group { margin-bottom: 4px; }
  .fd-char-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 9px 16px; font-family: var(--font-display); font-size: 14px;
    font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
    color: var(--text1); border-left: 3px solid transparent;
  }
  .fd-char-count {
    font-family: var(--font-mono); font-size: 10px; color: var(--text3);
    background: var(--bg3); padding: 2px 7px; border-radius: 3px;
  }
  .fd-move-item {
    padding: 6px 16px 6px 24px; font-size: 12px; color: var(--text2);
    cursor: pointer; border-left: 3px solid transparent;
    display: flex; align-items: center; gap: 8px;
  }
  .fd-move-item:hover { background: var(--bg3); color: var(--text0); }
  .fd-move-item.active {
    background: rgba(99,102,241,0.1); color: var(--accent3);
    border-left-color: var(--accent);
  }
  .fd-cat-tag {
    font-family: var(--font-mono); font-size: 9px; padding: 1px 5px;
    background: var(--bg4); color: var(--text3); border-radius: 2px;
    letter-spacing: 0.05em;
  }
  .fd-move-item.active .fd-cat-tag { background: var(--accent); color: #fff; }

  /* Hero header */
  .fd-hero-header {
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 12px; margin-bottom: 14px;
  }
  .fd-title-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .fd-character-line {
    font-family: var(--font-mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.2em; color: var(--cyan);
  }
  .fd-move-name {
    font-family: var(--font-display); font-weight: 700; font-size: 32px;
    letter-spacing: 1px; line-height: 1; color: var(--text0);
    text-transform: uppercase;
  }
  .fd-pills { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .fd-pill {
    padding: 4px 10px; border: 1px solid var(--line); background: var(--bg2);
    border-radius: var(--r); font-family: var(--font-mono); font-size: 11px;
    color: var(--text2);
  }
  .fd-pill strong { color: var(--gold); font-weight: 600; }

  /* Hero video */
  .fd-video {
    position: relative; background: #000; border: 1px solid var(--line);
    border-radius: var(--r2); aspect-ratio: 16 / 9; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 14px;
    box-shadow: 0 0 0 1px rgba(99,102,241,0.2), 0 0 60px rgba(99,102,241,0.08);
  }
  .fd-video video, .fd-video img {
    width: 100%; height: 100%; object-fit: contain; background: #000;
  }
  .fd-video-empty {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 12px; color: var(--text3); text-align: center;
    padding: 48px; cursor: pointer; width: 100%; height: 100%;
    border: 2px dashed transparent; transition: all 0.2s; border-radius: var(--r2);
  }
  .fd-video-empty:hover, .fd-video-empty.dragover {
    border-color: var(--accent); background: rgba(99,102,241,0.05);
    color: var(--text2);
  }
  .fd-video-icon {
    font-family: var(--font-display); font-size: 56px; line-height: 1;
    color: var(--bg4); font-weight: 700;
  }
  .fd-video-empty:hover .fd-video-icon { color: var(--accent); }
  .fd-video-title {
    font-family: var(--font-display); font-size: 16px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.15em; color: var(--text2);
  }
  .fd-video-hint {
    font-size: 11px; font-family: var(--font-mono); line-height: 1.6;
    max-width: 260px;
  }
  .fd-media-controls {
    position: absolute; top: 8px; right: 8px; display: flex; gap: 4px;
    z-index: 2; opacity: 0; transition: opacity 0.2s;
  }
  .fd-video:hover .fd-media-controls { opacity: 1; }
  .fd-media-btn {
    background: rgba(0,0,0,0.7); border: 1px solid var(--bg4); color: var(--text1);
    padding: 5px 9px; font-size: 10px; font-family: var(--font-mono);
    text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer;
    border-radius: 4px; backdrop-filter: blur(4px);
  }
  .fd-media-btn:hover { border-color: var(--accent); color: var(--accent3); }

  /* Scrubber */
  .fd-scrubber {
    background: var(--bg2); border: 1px solid var(--line); border-radius: var(--r);
    padding: 11px 16px; margin-bottom: 14px; display: flex; align-items: center; gap: 12px;
  }
  .fd-play-btn {
    width: 36px; height: 36px; border: 2px solid var(--accent);
    background: var(--bg1); color: var(--accent3); cursor: pointer; font-size: 14px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    transition: all 0.15s; border-radius: var(--r);
  }
  .fd-play-btn:hover {
    background: var(--accent); color: #fff;
    box-shadow: 0 0 16px rgba(99,102,241,0.4);
  }
  .fd-scrub-track {
    flex: 1; position: relative; height: 28px; cursor: pointer; min-width: 100px;
  }
  .fd-scrub-bg {
    position: absolute; top: 12px; left: 0; right: 0; height: 4px;
    background: var(--bg1); border: 1px solid var(--bg4); border-radius: 2px;
  }
  .fd-scrub-fill {
    position: absolute; top: 12px; left: 0; height: 4px;
    background: linear-gradient(90deg, var(--accent), var(--accent3));
    border-radius: 2px; pointer-events: none;
  }
  .fd-scrub-handle {
    position: absolute; top: 4px; width: 4px; height: 20px;
    background: var(--gold); transform: translateX(-50%); pointer-events: none;
    box-shadow: 0 0 10px rgba(245,158,11,0.6); border-radius: 1px;
  }
  .fd-scrub-notify {
    position: absolute; top: 8px; width: 2px; height: 12px;
    background: var(--cyan); pointer-events: none; transform: translateX(-50%);
    opacity: 0.7;
  }
  .fd-readout {
    font-family: var(--font-mono); font-size: 12px; color: var(--text1);
    min-width: 130px; text-align: right; white-space: nowrap;
  }
  .fd-readout strong { color: var(--gold); font-weight: 600; }
  .fd-frame-input {
    background: var(--bg1); border: 1px solid var(--bg4); color: var(--accent3);
    font-family: var(--font-mono); font-size: 12px;
    padding: 4px 6px; width: 56px; text-align: center; border-radius: 4px;
  }
  .fd-frame-input:focus { outline: 1px solid var(--accent); border-color: var(--accent); }

  /* Multi-track timeline */
  .fd-timeline {
    background: var(--bg2); border: 1px solid var(--line);
    border-radius: var(--r2); padding: 14px 18px; margin-bottom: 16px;
  }
  .fd-tl-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px; flex-wrap: wrap; gap: 10px;
  }
  .fd-tl-label {
    font-family: var(--font-display); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.18em; color: var(--cyan);
    font-weight: 600;
  }
  .fd-tl-tracks {
    position: relative; background: var(--bg1); border: 1px solid var(--bg4);
    border-radius: var(--r); padding: 5px 0;
  }
  .fd-tl-row {
    display: flex; align-items: stretch; height: 22px;
    border-bottom: 1px solid rgba(99,102,241,0.06);
  }
  .fd-tl-row:last-of-type { border-bottom: none; }
  .fd-tl-row-label {
    width: 38px; flex-shrink: 0; display: flex; align-items: center;
    justify-content: center; font-family: var(--font-mono); font-size: 9px;
    color: var(--text3); letter-spacing: 0.05em;
    border-right: 1px solid rgba(99,102,241,0.08);
  }
  .fd-tl-content { position: relative; flex: 1; min-width: 0; }
  .fd-tl-pip {
    position: absolute; top: 4px; bottom: 4px; width: 4px;
    transform: translateX(-50%); cursor: pointer; transition: all 0.1s;
    background: var(--accent); border: 1px solid var(--accent2); border-radius: 1px;
  }
  .fd-tl-bar {
    position: absolute; top: 4px; bottom: 4px; cursor: pointer;
    transition: all 0.1s; overflow: hidden; border-radius: 2px;
    background: rgba(99,102,241,0.25); border: 1px solid var(--accent);
  }
  .fd-tl-bar.is-hitbox, .fd-tl-pip.is-hitbox {
    background: rgba(245,158,11,0.3); border-color: var(--gold);
  }
  .fd-tl-pip.is-hitbox { background: var(--gold); }
  .fd-tl-bar.is-branch, .fd-tl-pip.is-branch {
    background: rgba(6,182,212,0.25); border-color: var(--cyan);
  }
  .fd-tl-pip.is-branch { background: var(--cyan); }
  .fd-tl-bar:hover, .fd-tl-pip:hover { filter: brightness(1.3); z-index: 2; }
  .fd-tl-bar.active { box-shadow: 0 0 10px var(--accent); filter: brightness(1.4); }
  .fd-tl-bar.is-hitbox.active { box-shadow: 0 0 10px var(--gold); }
  .fd-tl-bar.is-branch.active { box-shadow: 0 0 10px var(--cyan); }
  .fd-tl-pip.active { box-shadow: 0 0 10px currentColor; filter: brightness(1.5); }
  .fd-tl-bar-label {
    position: absolute; left: 4px; top: 50%; transform: translateY(-50%);
    font-family: var(--font-mono); font-size: 9px; color: var(--text0);
    white-space: nowrap; pointer-events: none;
    text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.9);
    overflow: hidden; text-overflow: ellipsis; max-width: calc(100% - 8px);
  }
  .fd-tl-playhead-zone {
    position: absolute; left: 38px; right: 0; top: 5px; bottom: 5px;
    pointer-events: none;
  }
  .fd-tl-playhead {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: var(--gold); transform: translateX(-50%);
    box-shadow: 0 0 8px rgba(245,158,11,0.7); z-index: 5;
  }
  .fd-tl-axis {
    display: flex; justify-content: space-between; margin-top: 6px;
    padding-left: 38px; font-family: var(--font-mono); font-size: 10px;
    color: var(--text3);
  }
  .fd-tl-legend {
    display: flex; gap: 12px; flex-wrap: wrap;
  }
  .fd-legend-item {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--font-mono); font-size: 10px; color: var(--text3);
  }
  .fd-legend-swatch {
    width: 10px; height: 10px; border: 1px solid; border-radius: 2px;
  }

  .fd-tooltip {
    position: fixed; background: var(--bg0); border: 1px solid rgba(99,102,241,0.4);
    padding: 6px 10px; font-family: var(--font-mono); font-size: 11px;
    color: var(--text0); z-index: 1000; pointer-events: none; white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6); border-radius: 4px;
  }
  .fd-tooltip strong { color: var(--gold); }

  /* Details collapse */
  .fd-details-toggle {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; background: transparent; border: 1px solid var(--line);
    color: var(--text2); padding: 9px 16px;
    font-family: var(--font-display); font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.18em; cursor: pointer;
    margin-top: 16px; transition: all 0.15s; border-radius: var(--r);
  }
  .fd-details-toggle:hover { border-color: var(--accent); color: var(--accent3); }
  .fd-details-toggle .fd-arrow {
    display: inline-block; transition: transform 0.2s; font-size: 10px;
  }
  .fd-details-toggle.open .fd-arrow { transform: rotate(180deg); }
  .fd-details-content { margin-top: 16px; }

  .fd-data-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1px; background: var(--line); border: 1px solid var(--line);
    border-radius: var(--r); overflow: hidden;
  }
  .fd-data-cell { background: var(--bg2); padding: 12px 14px; }
  .fd-cell-label {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--text3); margin-bottom: 4px;
  }
  .fd-cell-value {
    font-family: var(--font-mono); font-size: 16px; color: var(--gold);
    font-weight: 500;
  }

  .fd-loading {
    padding: 40px 20px; text-align: center; color: var(--text3);
    font-family: var(--font-mono); font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.15em;
  }
`;

// ============================================================
// COMPONENT
// ============================================================

export function FrameDataTab() {
  // ── Data state ──
  const [movesById, setMovesById] = useState(new Map());
  const [mediaByMoveId, setMediaByMoveId] = useState(new Map());
  const [selectedId, setSelectedId] = useState(null);
  const [loadStatus, setLoadStatus] = useState("loading"); // "loading" | "ready" | "empty"

  // ── Playback state ──
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [tooltip, setTooltip] = useState(null);

  // ── Refs ──
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const playStartTsRef = useRef(0);
  const playStartFrameRef = useRef(0);
  const scrubTrackRef = useRef(null);
  const objectUrlsRef = useRef([]);

  const move = movesById.get(selectedId);

  // ── Manifest loader ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("data/manifest.json");
        if (!res.ok) throw new Error("manifest missing");
        const manifest = await res.json();
        const newMoves = new Map();
        const newMedia = new Map();
        for (const entry of (manifest.moves || [])) {
          try {
            const r = await fetch(entry.data);
            if (!r.ok) continue;
            const json = await r.json();
            const parsed = parseAsset(json);
            for (const m of parsed) {
              newMoves.set(m.id, m);
              if (entry.media) {
                newMedia.set(m.id, {
                  url: entry.media,
                  type: /\.(mp4|webm|mov|m4v)$/i.test(entry.media) ? "video" : "image",
                  name: entry.media.split("/").pop(),
                  persisted: true,
                });
              }
            }
          } catch (e) {
            console.warn("[FrameData] skip", entry.data, e);
          }
        }
        if (cancelled) return;
        if (newMoves.size === 0) {
          setLoadStatus("empty");
          return;
        }
        setMovesById(newMoves);
        setMediaByMoveId(newMedia);
        // Prefer a move with media for initial selection
        let preferred = null;
        for (const [id] of newMedia) {
          if (newMoves.has(id)) { preferred = id; break; }
        }
        if (!preferred) preferred = newMoves.keys().next().value;
        setSelectedId(preferred);
        setLoadStatus("ready");
      } catch {
        if (!cancelled) setLoadStatus("empty");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Cleanup object URLs on unmount ──
  useEffect(() => () => {
    objectUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
  }, []);

  // ── Playback loop ──
  useEffect(() => {
    if (!isPlaying || !move) return;
    playStartFrameRef.current = currentFrame;
    playStartTsRef.current = performance.now();

    const videoEl = videoRef.current; // capture for cleanup
    if (videoEl) {
      videoEl.currentTime = playStartFrameRef.current / FPS;
      videoEl.play().catch(() => {});
    }

    const tick = (now) => {
      const elapsed = (now - playStartTsRef.current) / 1000;
      const frame = playStartFrameRef.current + elapsed * FPS;
      if (frame >= move.durationFrames) {
        setCurrentFrame(move.durationFrames);
        setIsPlaying(false);
        return;
      }
      setCurrentFrame(frame);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (videoEl) videoEl.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, selectedId]);

  // ── Play handler — wraps state to handle "play from end" resets ──
  const togglePlay = useCallback(() => {
    if (!move) return;
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      // If at end, snap to start before playing
      if (currentFrame >= move.durationFrames) setCurrentFrame(0);
      setIsPlaying(true);
    }
  }, [isPlaying, currentFrame, move]);

  // ── Selection ──
  const selectMove = useCallback((id) => {
    setIsPlaying(false);
    setSelectedId(id);
    setCurrentFrame(0);
  }, []);

  // ── Frame seek ──
  const setFrame = useCallback((frame, fromUserScrub = false) => {
    if (!move) return;
    const f = Math.max(0, Math.min(move.durationFrames, frame));
    setCurrentFrame(f);
    if (fromUserScrub) {
      setIsPlaying(false);
      if (videoRef.current) videoRef.current.currentTime = f / FPS;
    }
  }, [move]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        setFrame(Math.floor(currentFrame) - 1, true);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        setFrame(Math.floor(currentFrame) + 1, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, currentFrame, setFrame]);

  // ── Scrubber drag ──
  const dragRef = useRef(false);
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current || !scrubTrackRef.current || !move) return;
      const rect = scrubTrackRef.current.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      setFrame(pct * move.durationFrames, true);
    };
    const onUp = () => { dragRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [move, setFrame]);

  const onScrubMouseDown = (e) => {
    dragRef.current = true;
    if (!scrubTrackRef.current || !move) return;
    const rect = scrubTrackRef.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setFrame(pct * move.durationFrames, true);
  };

  // ── Per-move media upload ──
  const attachMedia = useCallback((id, file) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);
    const isVideo = file.type.startsWith("video/");
    setMediaByMoveId(prev => {
      const next = new Map(prev);
      const old = next.get(id);
      if (old && !old.persisted) URL.revokeObjectURL(old.url);
      next.set(id, {
        url, type: isVideo ? "video" : "image",
        name: file.name, persisted: false,
      });
      return next;
    });
  }, []);

  const detachMedia = useCallback((id) => {
    setMediaByMoveId(prev => {
      const next = new Map(prev);
      const old = next.get(id);
      if (old && !old.persisted) URL.revokeObjectURL(old.url);
      next.delete(id);
      return next;
    });
  }, []);

  // ── Group moves by character for sidebar ──
  const byCharacter = useMemo(() => {
    const out = {};
    for (const m of movesById.values()) {
      if (!out[m.character]) out[m.character] = [];
      out[m.character].push(m);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (a.category + a.action).localeCompare(b.category + b.action));
    }
    return out;
  }, [movesById]);

  // ── Render guards ──
  if (loadStatus === "loading") {
    return (
      <>
        <style>{FRAMEDATA_STYLES}</style>
        <div className="page-title">Frame <span>Data</span></div>
        <div className="fd-loading">Loading manifest from /data/manifest.json...</div>
      </>
    );
  }

  if (loadStatus === "empty") {
    return (
      <>
        <style>{FRAMEDATA_STYLES}</style>
        <div className="page-title">Frame <span>Data</span></div>
        <div className="card">
          <div className="card-title">No Frame Data Loaded</div>
          <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, marginBottom: 12 }}>
            Drop your <code style={{ color: "var(--accent3)" }}>PfgFixedAnimDataAsset</code> JSON exports
            into <code style={{ color: "var(--gold)" }}>public/data/</code> and list them
            in <code style={{ color: "var(--gold)" }}>public/data/manifest.json</code>.
          </p>
          <pre style={{ fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg1)",
                       padding: 14, borderRadius: "var(--r)", border: "1px solid var(--line)",
                       color: "var(--text1)", overflow: "auto" }}>
{`{
  "moves": [
    { "data": "data/Mvs_Arya_Attack_Combo1_Montage_FAD.json",
      "media": "media/Mvs_Arya_Attack_Combo1.mp4" }
  ]
}`}
          </pre>
        </div>
      </>
    );
  }

  // ── Detail render ──
  return (
    <>
      <style>{FRAMEDATA_STYLES}</style>
      <div className="page-title">Frame <span>Data</span></div>
      <div className="fd-layout">
        {/* Sidebar */}
        <aside className="fd-roster">
          {Object.keys(byCharacter).sort().map(char => (
            <div key={char} className="fd-char-group">
              <div className="fd-char-header">
                <span>{char}</span>
                <span className="fd-char-count">{byCharacter[char].length}</span>
              </div>
              {byCharacter[char].map(m => (
                <div key={m.id}
                     className={`fd-move-item ${m.id === selectedId ? "active" : ""}`}
                     onClick={() => selectMove(m.id)}>
                  <span className="fd-cat-tag">{m.category}</span>
                  <span>{m.action}</span>
                </div>
              ))}
            </div>
          ))}
        </aside>

        {/* Detail */}
        <div>
          {move ? (
            <MoveDetail
              move={move}
              media={mediaByMoveId.get(move.id)}
              currentFrame={currentFrame}
              isPlaying={isPlaying}
              showDetails={showDetails}
              onTogglePlay={togglePlay}
              onFrameInput={(v) => setFrame(v, true)}
              onScrubMouseDown={onScrubMouseDown}
              scrubTrackRef={scrubTrackRef}
              videoRef={videoRef}
              onAttachMedia={(f) => attachMedia(move.id, f)}
              onDetachMedia={() => detachMedia(move.id)}
              onToggleDetails={() => setShowDetails(s => !s)}
              setTooltip={setTooltip}
              onNotifyClick={(f) => setFrame(f, true)}
            />
          ) : null}
        </div>
      </div>

      {tooltip && (
        <div className="fd-tooltip"
             style={{ left: tooltip.x, top: tooltip.y - 32, transform: "translateX(-50%)" }}>
          {tooltip.text}
        </div>
      )}
    </>
  );
}

// ============================================================
// MOVE DETAIL SUB-COMPONENT
// ============================================================

function MoveDetail({
  move, media, currentFrame, isPlaying, showDetails,
  onTogglePlay, onFrameInput, onScrubMouseDown, scrubTrackRef, videoRef,
  onAttachMedia, onDetachMedia, onToggleDetails, setTooltip, onNotifyClick,
}) {
  const fileInputRef = useRef(null);
  const [dragHover, setDragHover] = useState(false);

  const categoryLabel = CATEGORY_LABELS[move.category] || move.category;
  const isAttack = ["Atk", "Attack", "Sig"].includes(move.category);
  const totalSec = Math.max(move.durationSec, 0.001);
  const totalFrames = move.durationFrames;

  // Group notifies by track
  const tracks = useMemo(() => {
    const t = {};
    for (const n of move.notifies) {
      if (!t[n.track]) t[n.track] = [];
      t[n.track].push(n);
    }
    return t;
  }, [move]);
  const trackKeys = Object.keys(tracks).map(Number).sort((a, b) => a - b);

  const axisMarks = useMemo(() => {
    const marks = [];
    const step = Math.max(1, Math.floor(totalFrames / 6));
    for (let f = 0; f <= totalFrames; f += step) marks.push(f);
    if (marks[marks.length - 1] !== totalFrames) marks.push(totalFrames);
    return marks;
  }, [totalFrames]);

  const handleFileChoose = () => fileInputRef.current?.click();
  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) onAttachMedia(f);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onAttachMedia(f);
  };

  const playheadPct = (currentFrame / Math.max(1, totalFrames)) * 100;
  const fillPct = playheadPct;

  return (
    <>
      {/* Hero header */}
      <div className="fd-hero-header">
        <div className="fd-title-row">
          <span className="fd-character-line">{move.character} · {categoryLabel}</span>
          <span className="fd-move-name">{move.action}</span>
        </div>
        <div className="fd-pills">
          <span className="fd-pill"><strong>{move.durationFrames}</strong> frames</span>
          <span className="fd-pill">{move.durationSec.toFixed(3)}s</span>
          <span className="fd-pill"><strong>{move.notifies.length}</strong> events</span>
        </div>
      </div>

      {/* Hero video */}
      <div className="fd-video">
        {media ? (
          <>
            {media.type === "video" ? (
              <video ref={videoRef} src={media.url} loop muted playsInline />
            ) : (
              <img src={media.url} alt={move.action} />
            )}
            <div className="fd-media-controls">
              <button className="fd-media-btn" onClick={handleFileChoose}>↻ Replace</button>
              {!media.persisted && (
                <button className="fd-media-btn" onClick={onDetachMedia}>× Remove</button>
              )}
            </div>
          </>
        ) : (
          <div className={`fd-video-empty ${dragHover ? "dragover" : ""}`}
               onClick={handleFileChoose}
               onDragEnter={(e) => { e.preventDefault(); setDragHover(true); }}
               onDragOver={(e) => { e.preventDefault(); setDragHover(true); }}
               onDragLeave={() => setDragHover(false)}
               onDrop={handleDrop}>
            <div className="fd-video-icon">＋</div>
            <div className="fd-video-title">Attach Animation</div>
            <div className="fd-video-hint">
              Drop an MP4, WebM, or GIF captured from the game.<br />
              Or click to browse.
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file"
               accept="video/*,image/gif,image/*"
               style={{ display: "none" }}
               onChange={handleFileChange} />
      </div>

      {/* Scrubber */}
      <div className="fd-scrubber">
        <button className="fd-play-btn" onClick={onTogglePlay} title="Play / Pause (Space)">
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <div className="fd-scrub-track" ref={scrubTrackRef}
             onMouseDown={onScrubMouseDown}
             onTouchStart={onScrubMouseDown}>
          <div className="fd-scrub-bg" />
          <div className="fd-scrub-fill" style={{ width: fillPct + "%" }} />
          {move.notifies.map((n, i) => {
            const pct = (n.startSec / totalSec) * 100;
            return <div key={i} className="fd-scrub-notify" style={{ left: pct + "%" }} />;
          })}
          <div className="fd-scrub-handle" style={{ left: playheadPct + "%" }} />
        </div>
        <input type="number" className="fd-frame-input"
               min="0" max={move.durationFrames}
               value={Math.round(currentFrame)}
               onChange={(e) => onFrameInput(parseInt(e.target.value) || 0)} />
        <div className="fd-readout">
          <strong>{Math.round(currentFrame)}</strong> / {move.durationFrames} · {(currentFrame / FPS).toFixed(3)}s
        </div>
      </div>

      {/* Multi-track timeline */}
      {trackKeys.length > 0 && (
        <div className="fd-timeline">
          <div className="fd-tl-header">
            <span className="fd-tl-label">Notify Tracks</span>
            <div className="fd-tl-legend">
              <div className="fd-legend-item">
                <span className="fd-legend-swatch" style={{ background: "rgba(245,158,11,0.3)", borderColor: "var(--gold)" }} />Hitbox
              </div>
              <div className="fd-legend-item">
                <span className="fd-legend-swatch" style={{ background: "rgba(6,182,212,0.25)", borderColor: "var(--cyan)" }} />Cancel/Branch
              </div>
              <div className="fd-legend-item">
                <span className="fd-legend-swatch" style={{ background: "rgba(99,102,241,0.25)", borderColor: "var(--accent)" }} />Other
              </div>
            </div>
          </div>
          <div className="fd-tl-tracks">
            {trackKeys.map(tk => (
              <div key={tk} className="fd-tl-row">
                <span className="fd-tl-row-label">T{tk}</span>
                <div className="fd-tl-content">
                  {tracks[tk].map((n, i) => {
                    const startPct = (n.startSec / totalSec) * 100;
                    const endPct = (n.endSec / totalSec) * 100;
                    const isRange = n.endSec > n.startSec + 0.001;
                    const cls = classifyNotify(n.name);
                    const extra = cls === "hitbox" ? "is-hitbox" : (cls === "branch" ? "is-branch" : "");
                    const cleanName = cleanNotifyName(n.name);
                    const tooltipText = `${cleanName} · f${n.startFrame}${isRange ? "–f" + n.endFrame : ""}`;
                    const inWindow = currentFrame >= n.startFrame &&
                                     currentFrame <= Math.max(n.startFrame, n.endFrame);
                    const onEnter = (e) => setTooltip({ text: tooltipText, x: e.clientX, y: e.clientY });
                    const onLeave = () => setTooltip(null);
                    if (isRange) {
                      return (
                        <div key={i}
                             className={`fd-tl-bar ${extra} ${inWindow ? "active" : ""}`}
                             style={{ left: startPct + "%", width: Math.max(0.5, endPct - startPct) + "%" }}
                             onClick={() => onNotifyClick(n.startFrame)}
                             onMouseEnter={onEnter}
                             onMouseLeave={onLeave}>
                          <span className="fd-tl-bar-label">{cleanName}</span>
                        </div>
                      );
                    }
                    return (
                      <div key={i}
                           className={`fd-tl-pip ${extra} ${inWindow ? "active" : ""}`}
                           style={{ left: startPct + "%" }}
                           onClick={() => onNotifyClick(n.startFrame)}
                           onMouseEnter={onEnter}
                           onMouseLeave={onLeave} />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="fd-tl-playhead-zone">
              <div className="fd-tl-playhead" style={{ left: playheadPct + "%" }} />
            </div>
          </div>
          <div className="fd-tl-axis">
            {axisMarks.map(f => <span key={f}>f{f}</span>)}
          </div>
        </div>
      )}

      {/* Collapsible details */}
      <button className={`fd-details-toggle ${showDetails ? "open" : ""}`}
              onClick={onToggleDetails}>
        <span>Frame Data Details</span>
        <span className="fd-arrow">▼</span>
      </button>
      {showDetails && (
        <div className="fd-details-content">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Animation Stats</div>
            <div className="fd-data-grid">
              <div className="fd-data-cell">
                <div className="fd-cell-label">Slot Sets</div>
                <div className="fd-cell-value">{move.slotCount}</div>
              </div>
              <div className="fd-data-cell">
                <div className="fd-cell-label">Bones Tracked</div>
                <div className="fd-cell-value">{move.boneCount}</div>
              </div>
              <div className="fd-data-cell">
                <div className="fd-cell-label">Socket Transforms</div>
                <div className="fd-cell-value">{move.socketCount}</div>
              </div>
              <div className="fd-data-cell">
                <div className="fd-cell-label">Visibility Curves</div>
                <div className="fd-cell-value">{move.curveCount}</div>
              </div>
            </div>
          </div>

          {move.notifies.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Notify Events ({move.notifies.length})</div>
              <table className="compare-table">
                <thead>
                  <tr><th>Notify</th><th>Track</th><th>Start</th><th>End</th><th>Window</th></tr>
                </thead>
                <tbody>
                  {move.notifies.map((n, i) => (
                    <tr key={i}>
                      <td>{cleanNotifyName(n.name)}</td>
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--text2)" }}>{n.track}</td>
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--accent3)" }}>f{n.startFrame}</td>
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--accent3)" }}>
                        {n.endSec > n.startSec ? "f" + n.endFrame : "—"}
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--gold)", textAlign: "right" }}>
                        {n.endSec > n.startSec ? (n.endFrame - n.startFrame) + " frames" : "instant"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {move.refMontage && (
            <div className="card">
              <div className="card-title">Source Asset</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text2)",
                            wordBreak: "break-all", padding: "10px 14px",
                            background: "var(--bg1)", border: "1px solid var(--line)",
                            borderRadius: "var(--r)" }}>
                {move.refMontage}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, padding: "16px 20px", border: "1px solid var(--gold)",
                        background: "rgba(245,158,11,0.06)", borderRadius: "var(--r)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 13,
                          textTransform: "uppercase", letterSpacing: "0.15em",
                          color: "var(--gold)", marginBottom: 8 }}>
              ⚠ Frame Data Caveats
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
              {isAttack
                ? "Hitbox windows above mark when hitboxes are active, but their physical shape (size, knockback angle, damage) lives in a sibling BoxComponent or HitboxData asset that needs separate export."
                : <>This is a <strong>{categoryLabel.toLowerCase()}</strong> animation — fighting-game frame data only exists on attack montages. Export <code style={{ color: "var(--accent3)" }}>Mvs_{move.character}_Attack_*</code> assets to populate that data.</>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
