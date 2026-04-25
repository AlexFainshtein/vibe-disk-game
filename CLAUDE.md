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
- [state.js](state.js) — shared mutable state: `screen` (current player and per-player background colors), `canvas`, `ctx`, `params` (friction, frameMultiplier, bounce), `disk` (x,y,vx,vy,r — `r` is `min(canvas.width, canvas.height) * DISK_RADIUS_FRACTION`, recomputed on resize), `bar` (y,prevY,vy,height; initial position differs per player — Eugene's is at the bottom, Alex's is at 0.85 of canvas height), `anchor` (x,y,active — spring attachment point), `diskHistory` (last 5 positions for lag-compensated hit detection), and `clickMarker`. Also exports two extension-point hooks shared modules can subscribe to without modifying shared code: `renderExtras` (array of `(ctx) => void` draw callbacks called by render.js) and `inputHooks` (`{emptyDown, emptyMove, emptyUp}` handlers called by input.js for touches that miss both bar and disk). Owns the `resize` listener that sizes the canvas and recomputes `disk.r`.
- [alex-physics.js](alex-physics.js) — Alex's `update(dt)`: bar velocity from position delta, damped spring force toward anchor (`SPRING_K`, `SPRING_DAMP`) when active, friction when spring is inactive, position integration, bumper collision (before walls so a bumper-push that lands the disk in a wall is resolved this frame), wall bounces (×`-params.bounce`), bar collision (velocity reflection + 2× bar velocity), bounce chime, target tick, trail tick, and idle-reset bookkeeping. `noteFromY()` maps disk vertical position at the moment of bounce to one of 5 pentatonic notes (bar = 0, ceiling = 4, middle band split into 3 stripes). On idle timeout, programmatically clicks the Reset button — feature modules subscribe to that click for their own cleanup, so manual press and auto-reset behave identically.
- [alex-targets.js](alex-targets.js) — soft regenerating colored circles that chime an octave above the wall mapping when the disk passes through. Each target keeps a fixed pentatonic note across regenerations. **Currently shelved** (`USE_TARGETS = false` in alex-physics.js): rapid-fire collection bursts disrupted the wall-bounce melody. Code retained for revival.
- [alex-bumper.js](alex-bumper.js) — touch empty space to place a static circle (`BUMPER_RADIUS_FRACTION` of the shorter canvas dimension; tan; bigger than the disk so it's visible under the finger) the disk reflects off. Tap on the bumper to remove it; tap on a different empty spot to relocate. Uses `inputHooks.emptyDown` (no move/up — the bumper does not follow finger drift after placement). Standard circle-vs-circle elastic reflection. Hits play `playKnock` (deliberately not part of the pentatonic melody). `tickBumper()` returns `{firstHit, placed, removed}` events so other modules (trail, idle-reset) can react. Subscribes to the Reset button click to clear itself.
- [alex-trail.js](alex-trail.js) — soft semi-transparent polyline tracing the disk's trajectory. Reset triggers in alex-physics.js: grab transition, bar movement, first collision after each new bumper placement, bumper removal. Subscribes to the Reset button click to clear itself.
- [eugene-physics.js](eugene-physics.js) — Eugene's variant. Similar structure but with separate radial/tangential damping relative to the cursor, and an "Alt Friction" mode toggled at runtime via `#altFriction` (different `SPRING_K` / damping constants for the alt mode). Triggers `playKnock` on bounce.
- [sound.js](sound.js) — Web Audio API sound effects: `playKnock(intensity)` for wall/bar/bumper bounces (Eugene + Alex's bumper), `playChime(intensity, noteIndex, octaveShift = 0)` for pentatonic-pitched bounces (Alex; reads the frequency from `PENTATONIC_FREQS` — currently A minor pentatonic A3..G4 — multiplied by `2 ** octaveShift`), `playGrab()`/`playRelease()` pips for catching/losing disk or bar, `playScrape(intensity)` for disk scraping against walls (varied pips from a predefined array).
- [render.js](render.js) — `draw()` renders the per-player gradient background, bar, all `renderExtras` callbacks (so feature visuals like the bumper and trail sit in the playfield, behind the disk), disk shadow, disk, highlight, and spring line from anchor to disk center when active.
- [input.js](input.js) — `setupInput()` attaches pointerdown/move/up handlers. Clicking the disk (lag-compensated, checks last 5 frames) creates a spring anchor; moving the mouse moves the anchor; releasing the mouse removes the spring and the disk flies by inertia. Anchor is clamped to playable area (disk.r + 0.5 margin). Bar dragging: grab offset, clamped so disk can't be pushed above ceiling, auto-releases when pointer leaves bar. Pointerdowns that miss both bar and disk route through `inputHooks` so feature modules (bumper) can opt in.
- [controls.js](controls.js) — `initControls()` wires the Reset button (resets disk + bar to per-player initial position), the fullscreen button (Eugene), and the Alt Friction toggle (Eugene). Other modules can subscribe to the Reset button's click to participate in "reset everything" without controls.js needing to know about them.
- [main.js](main.js) — entry point: reads `body[data-player]` and picks `alex-physics.js` or `eugene-physics.js`; wires `setupInput()` + `initControls()`; records disk position history each frame; runs the `requestAnimationFrame` loop with `dt` clamped to 33ms.
- [style.css](style.css) — fullscreen canvas + fixed-position overlay styling for `#ui` and `#panel`. Disables pull-to-refresh and touch gestures on mobile via `overscroll-behavior` and `touch-action`.
- [deploy.bat](deploy.bat) — copies source files into `public/` and runs `firebase deploy`. Routes to the Alex or Eugene Firebase project depending on the current Windows user.
- [firebase.json](firebase.json) — Firebase Hosting config, serves from `public/`.

### Per-feature toggles (Alex's side)

Alex's variant introduces small features one at a time. Each lives behind a `const`-flag at the top of [alex-physics.js](alex-physics.js) so it can be plugged in / out by flipping a single value:

- `USE_CHIMES` — bounces play `playChime` with a pentatonic note picked by `noteFromY()`; when false, falls back to `playKnock`.
- `USE_TARGETS` — soft regenerating circles in the playfield. Currently shelved (false).
- `USE_BUMPER` — touch empty space to place a static bumper.
- `USE_TRAIL` — draws the disk's current trajectory.
- `USE_IDLE_RESET` — auto-resets after `IDLE_TIMEOUT` seconds of no user interaction (programmatically clicks the Reset button).

Helper functions for a feature live next to its flag, or in their own `alex-*.js` module when the helper grows non-trivial.

### Reset chain

The Reset button is the single point of truth for "reset everything." Its click handler in [controls.js](controls.js) resets the bar and disk; alex-trail.js and alex-bumper.js subscribe to the same click to clear their own state. Alex's idle auto-reset programmatically clicks the button so manual press and auto-reset are symmetric.

### Sizing

Disk and bumper radii are fractions of the shorter canvas dimension (`DISK_RADIUS_FRACTION` in state.js, `BUMPER_RADIUS_FRACTION` in alex-bumper.js — both default to 1/6). They recompute on window resize so the toy stays right-sized across phones and orientations.

## Deploying

Run `deploy.bat` to copy source files to `public/` and deploy to Firebase Hosting. When adding new source files, add a corresponding `copy` line in `deploy.bat`.

## Notes

- Friction is a per-second proportional factor in [0,1], not a multiplier.
- The canvas is resized to `window.innerWidth/innerHeight` on load and resize. The disk's radius is recomputed on resize, but its position is not re-centered (only on `load`).
- The AudioContext is created lazily on first bounce; mobile browsers require a prior user gesture (the drag counts).
