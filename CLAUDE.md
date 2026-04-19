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

- [index.html](index.html) — canvas element, on-screen UI text, and the floating control panel (sliders for disk size and friction, reset button).
- [state.js](state.js) — shared mutable state: `canvas`, `ctx`, `params` (friction, diskRadius, frameMultiplier, wallBounce), `disk` (x,y,vx,vy,r), and `input` (dragging, mouseBuf). Also owns the `resize` listener that sizes the canvas to the window.
- [physics.js](physics.js) — `update(dt)` applies proportional friction (`speed * friction * dt * frameMultiplier`), integrates position, and handles wall bounces (×`params.wallBounce`). Triggers knock sound on bounce. No-op while `input.dragging`.
- [sound.js](sound.js) — `playKnock(intensity)` synthesizes a wood-on-wood knock via Web Audio API (square wave with fast pitch/volume decay through a lowpass filter). Intensity (0–1) scales volume, pitch, and duration.
- [render.js](render.js) — `draw()` renders gradient background, disk shadow, disk, and highlight each frame.
- [input.js](input.js) — `setupInput()` attaches pointerdown/move/up handlers. On release, velocity is computed from the last two samples in `input.mouseBuf` and clamped to 1600 px/s.
- [controls.js](controls.js) — `initControls()` wires panel sliders to `params` and persists `{friction, diskRadius}` to `localStorage` under key `vibe-settings`.
- [main.js](main.js) — entry point: imports the modules, wires `setupInput()` + `initControls()`, and runs the `requestAnimationFrame` loop with `dt` clamped to 33ms.
- [style.css](style.css) — fullscreen canvas + fixed-position overlay styling for `#ui` and `#panel`. Disables pull-to-refresh and touch gestures on mobile via `overscroll-behavior` and `touch-action`.
- [deploy.bat](deploy.bat) — copies source files into `public/` and runs `firebase deploy`.
- [firebase.json](firebase.json) — Firebase Hosting config, serves from `public/`.

## Deploying

Run `deploy.bat` to copy source files to `public/` and deploy to Firebase Hosting. When adding new source files, add a corresponding `copy` line in `deploy.bat`.

## Notes

- Friction is a per-second proportional factor in [0,1], not a multiplier.
- The canvas is resized to `window.innerWidth/innerHeight` on load and resize, but the disk position is not re-centered on resize (only on `load`).
- The AudioContext is created lazily on first bounce; mobile browsers require a prior user gesture (the drag counts).
