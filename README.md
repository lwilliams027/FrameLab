# MVSI — MultiVersus Combo Intelligence

A React + Vite single-page app for cataloging combos, visualizing them as
interactive flowcharts, comparing characters, and viewing animation
frame data extracted from the game's Unreal Engine assets.

## Tabs

- **Dashboard** — combo browser with character / kill-confirm filters
- **Builder** — form-based combo editor with live flowchart preview
- **Flowcharts** — full-screen interactive SVG flowchart viewer with DI branches
- **Kill Confirms** — sortable kill-confirm table with detail panel
- **Compare** — head-to-head and global kill comparison with radar charts
- **Analytics** — bar / scatter charts comparing characters
- **Frame Data** — Smash-style frame data view (startup, active, recovery,
- **Move Studio** — drop any video and get auto-zoom motion detection,
  1/10× slow-mo, draggable A/B trim, and one-click export of the
  trimmed slow-mo zoomed clip as a downloadable video file
  FAF, hitbox damage, knockback) with synced gameplay video and a
  draggable 60fps scrubber
- **Import / Export** — JSON validation and round-trip for both combos
  and frame data

## Running locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/MVSIFrameData/`).

## Building for GitHub Pages

`vite.config.js` is set to `base: '/MVSIFrameData/'` for the existing
GitHub repo. If you fork or rename, change that to match your repo name.

A GitHub Actions workflow at `.github/workflows/deploy.yml` builds and
deploys automatically on every push to `main`. After pushing, set
**Settings → Pages → Source** to **GitHub Actions** in the repo. Within
~90 seconds the site is live at `https://<user>.github.io/MVSIFrameData/`.

## Adding more frame data

Three ways, depending on whether you want it permanently in the repo or
just for the current session.

### Permanent (committed to the repo)

Each move needs three things:

1. **Asset JSON** — the `PfgFixedAnimDataAsset` export, in `public/data/`
2. **Gameplay video** — `.mp4` / `.webm` / `.gif`, in `public/media/`
3. **Optional stats sidecar** — manually-entered damage / knockback /
   hitstun, in `public/data/`

Then add an entry to `public/data/manifest.json`:

```json
{
  "moves": [
    {
      "data":  "data/Mvs_Banana_Attack_NeutralAir_Montage_FAD.json",
      "media": "media/Mvs_Banana_NeutralAir.mp4",
      "stats": "data/Mvs_Banana_Attack_NeutralAir_Montage_FAD.stats.json"
    }
  ]
}
```

### Session-only (Import / Export tab)

Open the **Import / Export** tab and drop files onto the **Frame Data**
drop zone. Supported file types:

- Asset JSON (`*_Montage_FAD.json`) — the move definition
- Video / GIF (`.mp4`, `.webm`, `.gif`) — paired by base name
- Stats sidecar (`*.stats.json`) — manual damage / KB values
- A previously-exported bundle JSON

**Validation rule.** Dropping a video without either (a) a matching
asset JSON in the same drop, or (b) an already-loaded move with a
matching base name, will be **rejected**. The intent is that uploading
a GIF without telling the app what move it represents shouldn't
silently succeed.

Session-uploaded data lives in memory and is lost on reload. To save it,
click **Download Bundle JSON** in the same panel — that produces a
single file containing every loaded asset JSON and stats sidecar.

### Bundle import

Drop a previously-exported bundle JSON onto the same drop zone. It's
auto-detected as a bundle (rather than a single asset) and replaces the
current state.

## What's auto-derived vs. manual

The Frame Data tab pulls these directly from the asset JSON's notify
events:

| Field | Source | How |
|-------|--------|-----|
| Total frames | derived | `Duration` value, decoded from 32.32 fixed-point |
| Startup | derived | first frame of any `MvsHitboxSetAnimNotifyState` |
| Active | derived | total frame count of all hitbox notifies |
| Recovery | derived | `total - last_active_frame - 1` |
| FAF (cancel) | derived | earliest `MvsActionBranchNotifyState_Immediate` |
| Hitbox count | derived | number of hitbox notify windows |

These need a **stats sidecar JSON** (the optional `stats` entry):

| Field | Source |
|-------|--------|
| Damage % | manual |
| Knockback angle / base / scale | manual |
| Hitstun / blockstun | manual |
| Kill % | manual |
| Display name override | manual |

The reason: damage and knockback live in separate `BoxComponent` /
`HitboxData` Unreal assets that the montage exports don't include.

### Stats sidecar format

Match one entry per derived hitbox window (see the example at
`public/data/Mvs_Arya_Attack_Combo1_Montage_FAD.stats.json`):

```json
{
  "displayName": "Jab 1",
  "input": "Attack",
  "killPercent": null,
  "hitboxes": [
    {
      "damage": 7,
      "knockbackAngle": 45,
      "knockbackBase": 30,
      "knockbackScale": 60,
      "hitstun": 14,
      "blockstun": 9,
      "notes": ""
    }
  ],
  "notes": "Combo starter."
}
```

`null` fields display as `—` in the table.

## Keyboard shortcuts (Frame Data tab)

- `Space` — play/pause
- `←` / `→` — step one frame
- Click or drag the scrubber to seek; type a frame number directly into
  the input

## Project file layout

```
src/
  App.jsx              ← combo intelligence (Dashboard, Builder, Compare, etc.)
                        + ImportExport tab now includes a FrameDataIO panel
  App.css              ← global tokens / theme
  FrameDataTab.jsx     ← the Frame Data viewer component
  frameDataParser.js   ← decoders, parser, deriveAttackStats helper
  main.jsx             ← React entry point
public/
  data/manifest.json   ← list of moves to load on startup
  data/*.json          ← asset exports + stats sidecars
  media/*.mp4          ← gameplay captures
.github/workflows/
  deploy.yml           ← auto-build and deploy to GitHub Pages
```

## Tech stack

React 19 · Vite 8 · Recharts 3 · ESLint 9. No CSS framework.
