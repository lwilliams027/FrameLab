// ============================================================
// Launcher — the home page where you pick a game
// ============================================================
// Renders the GAMES list as big card buttons. Clicking one sets
// the URL hash (#/<gameId>) which App.jsx watches and routes from.
// ============================================================

import { GAMES, setRoute } from "./lib/games.js";

const launcherStyles = `
  .gl-shell {
    min-height: 100vh; padding: 80px 32px; max-width: 1200px;
    margin: 0 auto; display: flex; flex-direction: column;
    align-items: center;
  }
  .gl-brand {
    font-family: var(--font-display);
    font-size: 56px; font-weight: 800; letter-spacing: 4px;
    text-transform: uppercase; color: var(--text0);
    margin-bottom: 8px; line-height: 1;
  }
  .gl-brand span {
    background: linear-gradient(135deg, var(--accent2), var(--accent3));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .gl-tagline {
    font-family: var(--font-mono); font-size: 13px; color: var(--text2);
    letter-spacing: 2px; text-transform: uppercase;
    margin-bottom: 64px;
  }
  .gl-section-title {
    font-family: var(--font-display);
    font-size: 14px; letter-spacing: 3px; font-weight: 700;
    text-transform: uppercase; color: var(--text2);
    margin-bottom: 20px; align-self: flex-start;
  }
  .gl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 20px; width: 100%;
  }
  .gl-card {
    position: relative;
    background: var(--bg2);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: 28px;
    cursor: pointer;
    transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
    overflow: hidden;
    text-align: left;
    color: inherit;
    width: 100%;
    font-family: inherit;
  }
  .gl-card::before {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(135deg, var(--card-color, var(--accent)), transparent 60%);
    opacity: 0.07; pointer-events: none;
    transition: opacity 0.2s;
  }
  .gl-card:hover {
    transform: translateY(-2px);
    border-color: var(--card-color, var(--accent));
    box-shadow: 0 8px 32px -8px var(--card-color, rgba(99,102,241,0.4));
  }
  .gl-card:hover::before { opacity: 0.14; }
  .gl-card-name {
    font-family: var(--font-display);
    font-size: 28px; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--text0);
    margin-bottom: 6px; line-height: 1.1;
  }
  .gl-card-tagline {
    font-family: var(--font-mono); font-size: 11px;
    letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--card-color, var(--accent3)); margin-bottom: 16px;
  }
  .gl-card-desc {
    font-size: 13px; color: var(--text2); line-height: 1.6;
    margin-bottom: 20px;
  }
  .gl-card-meta {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 16px; border-top: 1px solid var(--line);
    font-family: var(--font-mono); font-size: 10px;
    letter-spacing: 1px; text-transform: uppercase; color: var(--text3);
  }
  .gl-card-cta {
    color: var(--card-color, var(--accent3));
    font-weight: 700;
  }
  .gl-coming-soon {
    opacity: 0.4; pointer-events: none;
  }
  .gl-coming-soon .gl-card-cta { color: var(--text3); }
`;

export function GameLauncher() {
  return (
    <>
      <style>{launcherStyles}</style>
      <div className="gl-shell">
        <div className="gl-brand">Frame<span>Lab</span></div>
        <div className="gl-tagline">Combo intelligence · multi-game</div>

        <div className="gl-section-title">Choose a game</div>
        <div className="gl-grid">
          {GAMES.map(g => (
            <button
              key={g.id}
              className={`gl-card ${!g.enabled ? "gl-coming-soon" : ""}`}
              style={{ "--card-color": g.coverColor }}
              onClick={() => g.enabled && setRoute({ gameId: g.id })}
            >
              <div className="gl-card-name">{g.name}</div>
              <div className="gl-card-tagline">{g.tagline}</div>
              <div className="gl-card-desc">{g.description}</div>
              <div className="gl-card-meta">
                <span>{g.releaseYear}</span>
                <span className="gl-card-cta">
                  {g.enabled ? "OPEN ▸" : "COMING SOON"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
