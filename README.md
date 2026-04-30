# MVSI — MultiVersus Combo Intelligence

A React + Vite single-page app for cataloging combos, visualizing them as
interactive flowcharts, comparing characters, and now — viewing animation
frame data exported from the game's Unreal Engine assets.

## What's in here

**Combo Intelligence (the original)**
- **Dashboard** — combo browser with character/kill-confirm filters
- **Builder** — form-based combo editor with live flowchart preview
- **Flowcharts** — full-screen interactive SVG flowchart viewer with DI branches
- **Kill Confirms** — sortable table of all kill confirms with detail panel
- **Compare** — head-to-head and global kill comparison with radar charts
- **Analytics** — bar/scatter charts comparing characters
- **Import / Export** — JSON validation and round-trip

**Frame Data (new)**
- **Frame Data** — viewer for `PfgFixedAnimDataAsset` JSON exports paired
  with gameplay capture videos. Multi-track timeline of notify events,
  60fps scrubber, hitbox/cancel-window color coding.

## Running locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The Frame Data
tab loads its data from `public/data/manifest.json` on mount.

## Building for production

```bash
npm run build
npm run preview   # to test the build locally
```

The output in `dist/` can be deployed to any static host (GitHub Pages,
Netlify, Vercel, S3 + CloudFront, etc.).

## Adding more frame data

1. Drop the `_Montage_FAD.json` export into `public/data/`
2. (Optional) Drop the gameplay capture into `public/media/`
3. Append an entry to `public/data/manifest.json`:

```json
{
  "moves": [
    {
      "data": "data/Mvs_Banana_Attack_NeutralAir_Montage_FAD.json",
      "media": "media/Mvs_Banana_NeutralAir.mp4"
    }
  ]
}
```

The roster sidebar groups by character automatically based on the filename
pattern `Mvs_<Character>_<Category>_<Action>_Montage_FAD`.

Recognized categories: `Nav` (movement), `Attack` / `Atk`, `Sig`
(signature), `Hit` (reaction), `Def` (defense), `Tnt` (taunt), `Emo` (emote).

## What changed in this version

- **Added the missing `src/main.jsx`** entry point. Without it the app
  would not boot — `index.html` references `/src/main.jsx` but that file
  was not in the previous distribution.
- **Added `src/FrameDataTab.jsx`**, a new tab that loads MultiVersus
  animation assets from a manifest, plays them alongside captured video,
  and shows notify events on a multi-track timeline (color-coded for
  hitboxes / cancel windows / other).
- **Added the `Frame Data` tab** to the navigation in `App.jsx`.
- **Added two example frame-data files** plus an Arya combo capture in
  `public/data/` and `public/media/`.

## Frame Data limitations

- **Hitbox geometry** (size, knockback angle, damage) is not in the
  montage exports — it lives in separate `BoxComponent` or `HitboxData`
  assets. The tab shows hitbox notify *windows* but not their physical
  shape. If you can export those sibling assets, the parser can be
  extended to merge them.
- **Per-move uploaded media is in-memory only.** Anything dropped onto
  the video panel disappears on reload. To make a move's media permanent,
  put the file in `public/media/` and reference it in the manifest.

## Keyboard shortcuts (Frame Data tab)

- `Space` — play/pause
- `←` / `→` — step one frame
- Click or drag the scrubber to seek; type a frame number directly into
  the input
- Click any notify on the timeline to jump the playhead there

## Tech stack

React 19 · Vite 8 · Recharts 3 · ESLint 9. No CSS framework — all
styling lives in `src/App.css` plus inline `<style>` blocks per
component.
