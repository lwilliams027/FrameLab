// ============================================================
// Game registry
// ============================================================
// Source of truth for which games this build supports and their
// per-game configuration. The DB has its own `games` table — this
// file is the client-side mirror so the launcher and per-game
// pages can render before any data has loaded from Supabase.
//
// To add a third game:
//   1. Add an entry here
//   2. Insert the row into Supabase's `games` table
//   3. Seed its roster in `characters`
// No other code changes needed — routing, reducer, and UI all read
// from this registry.
// ============================================================

export const GAMES = [
  {
    id: "mvs",
    name: "MultiVerSus",
    shortName: "MvS",
    tagline: "WB platform fighter",
    description: "Crossover platform fighter from Player First Games — Bugs, Batman, Arya, Shaggy, and more.",
    releaseYear: 2022,
    coverColor: "#6366f1",
    accentRgb: "99,102,241",
    enabled: true,
  },
  {
    id: "ivs",
    name: "Invincible Versus",
    shortName: "IvS",
    tagline: "Invincible-themed fighter",
    description: "Platform fighter set in the Invincible universe — Mark, Atom Eve, Allen the Alien, and the rest of GDA.",
    releaseYear: 2026,
    coverColor: "#ffd166",
    accentRgb: "255,209,102",
    enabled: true,
  },
];

export function getGame(id) {
  return GAMES.find(g => g.id === id) || null;
}

export const DEFAULT_GAME_ID = GAMES[0]?.id || "mvs";

// Simple URL-based game scoping. App.jsx reads window.location.hash
// (since GitHub Pages hosts a static SPA, hash-routing is the safest
// bet — no server config, no 404 issues on refresh).
//
// Routes:
//   #/                    → launcher
//   #/<gameId>            → that game's dashboard
//   #/<gameId>/<tabId>    → that game's specific tab
export function parseRoute() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  if (!raw) return { gameId: null, tabId: null };
  const [gameId, tabId] = raw.split("/");
  return {
    gameId: getGame(gameId) ? gameId : null,
    tabId: tabId || null,
  };
}

export function setRoute({ gameId, tabId }) {
  if (!gameId) {
    window.location.hash = "/";
    return;
  }
  window.location.hash = tabId ? `/${gameId}/${tabId}` : `/${gameId}`;
}
