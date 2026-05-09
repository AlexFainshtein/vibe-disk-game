# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vibe Disk Game — a single-page HTML5 Canvas demo of a draggable disk with friction, wall bounces, and collision sounds. Pure static site: no build step, no dependencies, no tests.

The project hosts multiple game variants that share an engine + playfield but have completely separate physics. Per-variant detail lives in dedicated docs auto-loaded below ([CLAUDE-ALEX.md](CLAUDE-ALEX.md), [CLAUDE-EUGENE.md](CLAUDE-EUGENE.md), [CLAUDE-ZEN1.md](CLAUDE-ZEN1.md)).

## Running

Serve the directory statically and open in a browser:

```
python -m http.server 8000
```

Then open http://localhost:8000. To iterate, edit source files and refresh.

## Testing on an Android phone (USB, with auto-reload) — preferred

Connect the phone via USB with USB debugging enabled, then:

```
npx live-server --port=8000 --no-browser
adb reverse tcp:8000 tcp:8000
```

(If PowerShell blocks `npx` with an execution-policy error, use `npx.cmd` instead.)

Open `http://localhost:8000` on the phone. Edits auto-reload on the phone. Re-run `adb reverse` if the tunnel drops.

## Testing on an Android phone (same Wi-Fi, with auto-reload) — alternative

```
npx live-server --port=8000 --host=0.0.0.0
```

Find your PC's LAN IP — run `ipconfig` and grab the IPv4 address under your Wi-Fi adapter (e.g. `192.168.1.134`; DHCP-assigned, may change between sessions). Allow Node.js through Windows Firewall on the **Private** profile when prompted, and confirm the Wi-Fi network's profile is set to Private (Public blocks LAN traffic).

On the phone (same Wi-Fi), open `http://<PC-LAN-IP>:8000`. Editing any file and saving auto-refreshes the phone. http (not https) is fine — this app uses no secure-context APIs.

## Architecture

ES modules loaded via `<script type="module" src="main.js">` — must be served over http:// (not `file://`).

### Shared files (used by every variant)

- [index.html](index.html) — landing menu. Two columns of buttons: **Alex** column links to [Alex/alex.html](Alex/alex.html) (labeled "Drift") and [Alex1/alex1.html](Alex1/alex1.html) (a placeholder sandbox); **Eugene** column links to [Eugene/eugene.html](Eugene/eugene.html) and [Zen1/zen1.html](Zen1/zen1.html). Contains a single `const DEFAULT = 'default'` at the top of an inline script — change the value to `'Alex/alex'`, `'Alex1/alex1'`, `'Eugene/eugene'`, or `'Zen1/zen1'` to forward directly to that variant on load instead of showing the menu. [Alex/alex.html](Alex/alex.html) is Alex's shipped variant (Drift): `<body data-player="alex">` so [main.js](main.js) dynamically imports `Alex/alex-physics.js`; shows the fading "Drift" title and panel buttons (Reset, Pause, −, +, Erase). Per-variant files (entry HTML and feature modules) live in `Alex/`, `Alex1/`, and `Eugene/` subfolders alongside the existing `Zen1/`; shared engine files stay at the project root.
- [state.js](state.js) — engine-only shared state: `canvas`, `ctx`, `params` (friction, frameMultiplier, bounce), `screen` (current player and per-player background colors), and the extension-point hooks shared modules subscribe to without modifying shared code: `renderExtras` (array of `(ctx) => void` draw callbacks called by render.js *before* the bar/disk — visuals that sit in the playfield, behind everything), `renderOverlays` (same shape, called *after* the disk — visuals that sit on top, e.g. Alex's spring line + endpoint dots), and `inputHooks` (`{emptyDown, emptyMove, emptyUp, barDown}` handlers called by input.js for touches that miss the disk, optionally hijack the bar drag, etc.). Owns the canvas `resize` listener. Knows nothing about disk, bar, bricks, mallet, etc. — those live in [playfield.js](playfield.js) and per-variant feature modules.
- [playfield.js](playfield.js) — playfield primitives shared by both variants: `disk` (x,y,vx,vy,r — `r` is `min(canvas.width, canvas.height) * DISK_RADIUS_FRACTION`, recomputed on resize), `bar` (y,prevY,vy,height — `height` is `canvas.height * BAR_HEIGHT_FRACTION`, recomputed on resize; initial position differs per player — Eugene's is at the bottom, Alex's is at the top), `bar.layout` (`'top'` or `'bottom'` — variants set this at module load to declare which side of the bar the disk lives on; default `'bottom'`), `anchor` (x,y,active — spring attachment point), `diskHistory` (last 5 positions for lag-compensated hit detection). Exports `clampBarY(newY)` which respects `bar.layout` so [input.js](input.js) can clamp the dragged bar without knowing which variant it's in. Owns its own `resize` listener that recomputes `disk.r` / `bar.height` and re-clamps `bar.y` (state.js's listener already updated `canvas.width/height` by the time this one fires, because state.js loads first).
- [sound.js](sound.js) — Web Audio API sound effects: `playKnock(intensity)` for wall/bar/bumper bounces (Eugene + Alex's bumper), `playChime(intensity, noteIndex, octaveShift = 0)` for pentatonic-pitched bounces (Alex; reads the frequency from `PENTATONIC_FREQS` — currently A minor pentatonic A3..G4 — multiplied by `2 ** octaveShift`; uses a triangle oscillator), `playGrab()`/`playRelease()` pips for catching/losing disk or bar, `playScrape(intensity)` for disk scraping against walls (varied pips from a predefined array). `initAudio()` creates and resumes the AudioContext eagerly — called on the first `pointerdown` so that sound is available from the very first bounce rather than waiting for the first wall hit.
- [render.js](render.js) — variant-agnostic `draw()` that renders per-player gradient background, all `renderExtras` callbacks (feature visuals like the bumper, trail, bricks, mallet, bubble pop — sit in the playfield, behind everything), the bar, the disk, and finally all `renderOverlays` callbacks (visuals that sit on top of the disk, e.g. Alex's spring line + endpoint dots). The disk renders as a flat fill by default; setting `disk.highlight` opts into the 3D "ball" look (drop shadow + radial gradient + specular ellipse, all three gated on the same flag), and `disk.glass` triggers Eugene's soap-bubble look. Per-variant visuals live in their owning modules and self-register into `renderExtras` or `renderOverlays`.
- [input.js](input.js) — `setupInput()` attaches pointerdown/move/up handlers. Clicking the disk (lag-compensated, checks last 5 frames) creates a spring anchor; moving the mouse moves the anchor; releasing the mouse removes the spring and the disk flies by inertia. Anchor is clamped to playable area (disk.r + 0.5 margin). Bar dragging: grab offset, clamped so disk can't be pushed above ceiling, auto-releases when pointer leaves bar. Pointerdowns that miss both bar and disk route through `inputHooks` so feature modules (Alex's bumper, Eugene's mallet) can opt in. Variant-agnostic — knows about disk/bar/anchor only via [playfield.js](playfield.js); has no per-player branches.
- [controls.js](controls.js) — `initControls()` wires the Reset button (resets disk + bar to per-player initial position), the fullscreen button (Eugene-only DOM lookup), and the Alt Friction / Quad Spring toggles (Eugene-only DOM lookups). Other modules subscribe to the Reset button's click directly to participate in "reset everything" — alex-bumper clears itself, eugene-bricks regenerates the wall — without controls.js needing to know about them.
- [main.js](main.js) — entry point: reads `body[data-player]` and **dynamically imports** only the active variant's physics module via a `physicsPaths` map keyed by player name (`alex`, `alex1`, `eugene`); falls back to Alex's path if the player is unknown. Wires `setupInput()` + `initControls()`; records disk position history each frame; runs the `requestAnimationFrame` loop with `dt` clamped to 33ms. Because the dynamic import is conditional, the inactive variant's feature modules are never fetched, parsed, or executed — no `dataset.player` guards needed inside the per-variant feature modules. Uses top-level `await`, supported in all modern browsers.
- [style.css](style.css) — fullscreen canvas + fixed-position overlay styling for `#ui` and `#panel`. The panel itself is transparent with `pointer-events: none` so the disk shows through and taps on empty panel area pass through to the canvas; only the buttons inside have a background and `pointer-events: auto`. Disables pull-to-refresh and touch gestures on mobile via `overscroll-behavior` and `touch-action`.
- [deploy.bat](deploy.bat) — copies source files into `public/` and runs `firebase deploy`. Routes to the Alex or Eugene Firebase project depending on the current Windows user.
- [firebase.json](firebase.json) — Firebase Hosting config, serves from `public/`.

### Per-variant docs

Per-variant files (entry HTML, physics, feature modules, runtime toggles) are described in:

@./CLAUDE-ALEX.md
@./CLAUDE-EUGENE.md
@./CLAUDE-ZEN1.md


### Sizing

Disk and bar dimensions are fractions of the canvas, so the toy stays right-sized across phones and orientations:

- `DISK_RADIUS_FRACTION` (playfield.js) — fraction of the shorter canvas dimension.
- `BAR_HEIGHT_FRACTION` (playfield.js) — fraction of the canvas height.

Both recompute on window resize. Variant-specific size constants (e.g. Alex's `BUMPER_RADIUS_FRACTION`) are documented in the per-variant files.

## Deploying

Run `deploy.bat` (Windows) or `./deploy.sh` (Linux/macOS) to copy source files to `public/` and deploy to Firebase Hosting. With no argument, both scripts run `firebase deploy` against the active Firebase project (Alex's); pass a project alias as the first argument (e.g. `deploy.bat eugene` or `./deploy.sh eugene`) to deploy to a different project (Eugene's).

**Keep `deploy.bat` and `deploy.sh` in sync.** They are parallel implementations — when adding/removing/renaming source files, update the copy list in BOTH scripts in the same change.

## Notes

- Friction is a per-second proportional factor in [0,1], not a multiplier.
- The canvas is resized to `window.innerWidth/innerHeight` on load and resize. The disk's radius is recomputed on resize, but its position is not re-centered (only on `load`).
- The AudioContext is created lazily on first bounce; mobile browsers require a prior user gesture (the drag counts).
