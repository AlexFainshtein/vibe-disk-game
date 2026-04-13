# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vibe Disk Game — a single-page HTML5 Canvas demo of a draggable disk with friction and wall bounces. Pure static site: no build step, no dependencies, no tests.

## Running

Serve the directory statically and open in a browser:

```
python -m http.server 8000
```

Then open http://localhost:8000. To iterate, edit `script.js` / `style.css` / `index.html` and refresh.

## Architecture

ES modules loaded via `<script type="module" src="main.js">` — must be served over http:// (not `file://`).

- [index.html](index.html) — canvas element, on-screen UI text, and the floating control panel (sliders for disk size and friction, reset button).
- [state.js](state.js) — shared mutable state: `canvas`, `ctx`, `params` (friction, diskRadius, frameMultiplier, wallBounce), `disk` (x,y,vx,vy,r), and `input` (dragging, mouseBuf). Also owns the `resize` listener that sizes the canvas to the window.
- [physics.js](physics.js) — `update(dt)` applies proportional friction (`speed * friction * dt * frameMultiplier`), integrates position, and handles wall bounces (×`params.wallBounce`). No-op while `input.dragging`.
- [render.js](render.js) — `draw()` renders gradient background, disk shadow, disk, and highlight each frame.
- [input.js](input.js) — `setupInput()` attaches pointerdown/move/up handlers. On release, velocity is computed from the last two samples in `input.mouseBuf` and clamped to 1600 px/s.
- [controls.js](controls.js) — `initControls()` wires panel sliders to `params` and persists `{friction, diskRadius}` to `localStorage` under key `vibe-settings`.
- [main.js](main.js) — entry point: imports the modules, wires `setupInput()` + `initControls()`, and runs the `requestAnimationFrame` loop with `dt` clamped to 33ms.
- [style.css](style.css) — fullscreen canvas + fixed-position overlay styling for `#ui` and `#panel`.

## Notes

- Friction is a per-second proportional factor in [0,1], not a multiplier. The reset button currently sets `friction = 0.98`, which is inconsistent with the default `0.02` elsewhere — a known quirk in [controls.js](controls.js).
- The canvas is resized to `window.innerWidth/innerHeight` on load and resize, but the disk position is not re-centered on resize (only on `load`).
