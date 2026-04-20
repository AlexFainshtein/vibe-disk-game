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

- [index.html](index.html) — canvas element, on-screen UI text, and a Reset button.
- [state.js](state.js) — shared mutable state: `canvas`, `ctx`, `params` (friction, diskRadius, frameMultiplier, bounce), `disk` (x,y,vx,vy,r), `bar` (y,prevY,vy,height), and `input` (dragging, mouseBuf). Also owns the `resize` listener that sizes the canvas to the window.
- [physics.js](physics.js) — `update(dt)` computes bar velocity from position delta, applies proportional friction, integrates position, handles wall bounces (×`-params.bounce`), and bar collision (velocity reflection + 2× bar velocity). Triggers knock sound on bounce. No-op while `input.dragging`.
- [sound.js](sound.js) — Web Audio API sound effects: `playKnock(intensity)` for wall/bar bounces, `playGrab()`/`playRelease()` pips for catching/losing disk or bar, `playScrape(intensity)` for disk scraping against walls (varied pips from a predefined array).
- [render.js](render.js) — `draw()` renders gradient background, bar, disk shadow, disk, and highlight each frame.
- [input.js](input.js) — `setupInput()` attaches pointerdown/move/up handlers. Disk dragging: grab offset, clamped to walls/bar, auto-releases with wall-parallel velocity when pointer leaves disk, scrape pips on increasing divergence. Bar dragging: grab offset, clamped so disk can't be pushed above ceiling, auto-releases when pointer leaves bar.
- [controls.js](controls.js) — `initControls()` wires the Reset button to re-center the disk, zero its velocity, and reset the bar position.
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
