# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vibe Disk Game — a single-page HTML5 Canvas demo of a draggable disk with friction, wall bounces, and collision sounds. Pure static site: no build step, no dependencies, no tests.

## Running

Serve the directory statically and open in a browser:

```
python -m http.server 8000
```

Then open http://localhost:8000. To iterate, edit source files and refresh.

## Testing on an Android phone (same Wi-Fi, with auto-reload)

Use `live-server` instead of `python -m http.server` to get reload-on-save:

```
npx live-server --port=8000 --host=0.0.0.0
```

(If PowerShell blocks `npx` with an execution-policy error, use `npx.cmd` instead.)

Find your PC's LAN IP — run `ipconfig` and grab the IPv4 address under your Wi-Fi adapter (e.g. `192.168.1.134`; DHCP-assigned, may change between sessions). Allow Node.js through Windows Firewall on the **Private** profile when prompted, and confirm the Wi-Fi network's profile is set to Private (Public blocks LAN traffic).

On the phone (same Wi-Fi), open `http://<PC-LAN-IP>:8000`. Editing any file and saving auto-refreshes the phone. http (not https) is fine — this app uses no secure-context APIs.

## Architecture

ES modules loaded via `<script type="module" src="main.js">` — must be served over http:// (not `file://`).

- [index.html](index.html) — landing page with two big buttons (Alex / Eugene) that route to per-player pages. Sets `sessionStorage.fromMenu` so the player pages can detect direct-URL access and bounce back to the menu.
- [alex.html](alex.html), [eugene.html](eugene.html) — per-player pages. Each loads the same `main.js` but sets `<body data-player="alex"|"eugene">` so [main.js](main.js) picks the matching physics module. Eugene's page also has a fullscreen button and an "Alt Friction" toggle in `#panel`.
- [state.js](state.js) — shared mutable state: `screen` (current player and per-player background colors), `canvas`, `ctx`, `params` (friction, diskRadius, frameMultiplier, bounce), `disk` (x,y,vx,vy,r), `bar` (y,prevY,vy,height; initial position differs per player — Eugene's is at the bottom, Alex's is at 0.85 of canvas height), `anchor` (x,y,active — spring attachment point), `diskHistory` (last 5 positions for lag-compensated hit detection), and `clickMarker`. Also owns the `resize` listener that sizes the canvas to the window.
- [alex-physics.js](alex-physics.js) — Alex's `update(dt)`: bar velocity from position delta, damped spring force toward anchor (`SPRING_K`, `SPRING_DAMP`) when active, friction when spring is inactive, position integration, wall bounces (×`-params.bounce`), and bar collision (velocity reflection + 2× bar velocity). On bounce, plays a pentatonic chime (when the `USE_CHIMES` flag is true) or falls back to `playKnock`. `noteFromY()` maps disk vertical position at the moment of bounce to one of 5 notes: touching the bar → 0 (lowest), touching the ceiling → 4 (highest), middle band of height (H − 2R) split into 3 equal stripes for notes 1, 2, 3.
- [eugene-physics.js](eugene-physics.js) — Eugene's variant. Similar structure but with separate radial/tangential damping relative to the cursor, and an "Alt Friction" mode toggled at runtime via `#altFriction` (different `SPRING_K` / damping constants for the alt mode). Triggers `playKnock` on bounce.
- [sound.js](sound.js) — Web Audio API sound effects: `playKnock(intensity)` for wall/bar bounces (Eugene), `playChime(intensity, noteIndex)` for pentatonic-pitched bounces (Alex; reads the frequency from `PENTATONIC_FREQS` — currently A minor pentatonic A3..G4), `playGrab()`/`playRelease()` pips for catching/losing disk or bar, `playScrape(intensity)` for disk scraping against walls (varied pips from a predefined array).
- [render.js](render.js) — `draw()` renders the per-player gradient background, bar, disk shadow, disk, highlight, and spring line from anchor to disk center when active.
- [input.js](input.js) — `setupInput()` attaches pointerdown/move/up handlers. Clicking the disk (lag-compensated, checks last 5 frames) creates a spring anchor; moving the mouse moves the anchor; releasing the mouse removes the spring and the disk flies by inertia. Anchor is clamped to playable area (disk.r + 0.5 margin). Bar dragging: grab offset, clamped so disk can't be pushed above ceiling, auto-releases when pointer leaves bar.
- [controls.js](controls.js) — `initControls()` wires the Reset button (resets disk + bar to per-player initial position), the fullscreen button (Eugene), and the Alt Friction toggle (Eugene).
- [main.js](main.js) — entry point: reads `body[data-player]` and picks `alex-physics.js` or `eugene-physics.js`; wires `setupInput()` + `initControls()`; records disk position history each frame; runs the `requestAnimationFrame` loop with `dt` clamped to 33ms.
- [style.css](style.css) — fullscreen canvas + fixed-position overlay styling for `#ui` and `#panel`. Disables pull-to-refresh and touch gestures on mobile via `overscroll-behavior` and `touch-action`.
- [deploy.bat](deploy.bat) — copies source files into `public/` and runs `firebase deploy`. Routes to the Alex or Eugene Firebase project depending on the current Windows user.
- [firebase.json](firebase.json) — Firebase Hosting config, serves from `public/`.

### Per-feature toggles (Alex's side)

Alex's variant introduces small features one at a time. Each lives behind a `const`-flag at the top of [alex-physics.js](alex-physics.js) so it can be plugged in / out by flipping a single value:

- `USE_CHIMES` — when true, bounces play `playChime` with a pentatonic note picked by `noteFromY()`; when false, falls back to `playKnock`.

Helper functions for a feature live next to its flag. When a feature grows past a small helper, extract it to its own file (e.g. `alex-chimes.js`).

## Deploying

Run `deploy.bat` to copy source files to `public/` and deploy to Firebase Hosting. When adding new source files, add a corresponding `copy` line in `deploy.bat`.

## Notes

- Friction is a per-second proportional factor in [0,1], not a multiplier.
- The canvas is resized to `window.innerWidth/innerHeight` on load and resize, but the disk position is not re-centered on resize (only on `load`).
- The AudioContext is created lazily on first bounce; mobile browsers require a prior user gesture (the drag counts).
