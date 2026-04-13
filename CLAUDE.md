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

Three files, all at the repo root:

- [index.html](index.html) — canvas element, on-screen UI text, and the floating control panel (sliders for disk size and friction, reset button).
- [script.js](script.js) — all game logic in a single module-less script:
  - `params` holds tunable state (`friction`, `diskRadius`); `disk` holds physics state (`x,y,vx,vy,r`).
  - `update(dt)` applies proportional friction (`speed * friction * dt`), integrates position, and handles wall bounces (×−0.9). Skipped while `dragging`.
  - `draw()` renders gradient background, disk shadow, disk, highlight each frame.
  - `loop(t)` is the `requestAnimationFrame` driver; `dt` is clamped to 33ms.
  - Pointer events (`pointerdown/move/up`) drive drag. On release, velocity is computed from the last two samples in `mouseBuf` and clamped to 1600 px/s.
  - `initControls()` wires the panel sliders to `params` and persists `{friction, diskRadius}` to `localStorage` under key `vibe-settings`.
- [style.css](style.css) — fullscreen canvas + fixed-position overlay styling for `#ui` and `#panel`.

## Notes

- Friction is a per-second proportional factor in [0,1], not a multiplier. The reset button currently sets `friction = 0.98`, which is inconsistent with the default `0.02` elsewhere — a known quirk in [script.js:201](script.js#L201).
- The canvas is resized to `window.innerWidth/innerHeight` on load and resize, but the disk position is not re-centered on resize (only on `load`).
