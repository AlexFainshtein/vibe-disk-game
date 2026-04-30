# CLAUDE-ZEN1.md

Zen1 variant of the Vibe Disk Game. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls, sizing).

## Entry page

- [Zen1/zen1.html](Zen1/zen1.html) — sets `<body data-player="zen1">`. Loads Planck.js from CDN before the ES module entry point. Has Reset, ⏸ Pause, and ◐ Color buttons in `#panel`. The `+` / `−` speed buttons live in a separate `#speed-panel` div centered at the bottom.

## Physics engine: Planck.js

Zen1 uses **Planck.js** (a JS port of Box2D, v1.0.0 from CDN) instead of the hand-rolled Euler integration used by Alex and Eugene. The world has zero gravity; all motion comes from the spring joint and wall/bar contacts.

- `PPM = 64` — pixels per meter. `toM(px)` and `toPx(m)` convert between coordinate spaces.
- `world.step(dt, 8, 3)` — 8 velocity iterations, 3 position iterations per frame.
- `diskBody` — dynamic, `bullet: true` (prevents tunneling at high speed), `fixedRotation: true`.
- `anchorBody` — static; repositioned each pointer-move to drag the spring anchor.
- `barBody` — static; polygon fixture rebuilt every frame the bar moves (see Bar section).
- `bumperBody` — kinematic circle; position synced from `bumper.x/y` each frame.

`diskBody` and helper functions (`toM`, `toPx`) are exported from [Zen1/zen1-physics.js](Zen1/zen1-physics.js) so feature modules can read the true Planck position rather than the stale `disk.x/y` fields (which are not updated in Zen1).

## Files

- [Zen1/zen1-physics.js](Zen1/zen1-physics.js) — main physics module. Owns world setup, spring lifecycle, bar/bumper sync, sound dispatch, and the `update(dt)` loop. Exports `diskBody`, `anchorBody`, `toM`, `toPx`.
- [Zen1/zen1-render.js](Zen1/zen1-render.js) — custom `draw()` replacing shared `render.js`. Renders gradient background → `renderExtras` callbacks → `bar.overlay()` (the tilted trapezoid drawn by zen1-bar.js) → disk (highlight/glass/flat) → `renderOverlays` callbacks.
- [Zen1/zen1-input.js](Zen1/zen1-input.js) — pointer event wiring. Calls `grab()` / `moveAnchor()` / `release()` exported from zen1-physics.js.
- [Zen1/zen1-bar.js](Zen1/zen1-bar.js) — tilted trapezoid bar (see Bar section). Sets `bar.hidden = true` so the shared flat-rect draw path in render is skipped; renders via `bar.overlay`.
- [Zen1/zen1-pause.js](Zen1/zen1-pause.js) — pause/resume. Saves and restores `diskBody` linear velocity; requires `initPause(diskBody, Vec2)` to be called after `initWorld()`. `clearPause()` is called by zen1-physics on grab so picking up a paused disk cancels pause cleanly.
- [Zen1/zen1-trail.js](Zen1/zen1-trail.js) — persistent offscreen-canvas trail (see Trail section).
- [Zen1/zen1-bumper.js](Zen1/zen1-bumper.js) — draggable circular bumper obstacle (same lifecycle as Alex's bumper; see CLAUDE-ALEX.md for the pattern).
- [Zen1/zen1-targets.js](Zen1/zen1-targets.js) — regenerating pickup circles. **Currently disabled** (`USE_TARGETS = false`). Collision detection uses `diskBody.getPosition()` (not `disk.x/y`).
- [Zen1/main-zen1.js](Zen1/main-zen1.js) — entry point: imports zen1-render and zen1-physics, runs the `requestAnimationFrame` loop.

## Bar: independent-edge trapezoid

`zen1-bar.js` extends the bar into a tilted trapezoid by tracking two independent Y values:

- `bar.y1` — Y of the left edge top.
- `bar.y2` — Y of the right edge top.
- `bar.y` — `min(y1, y2)`, used by shared input.js for hit-detection bounding.

Input zones (handled inside zen1-bar.js via `inputHooks`):
- **Left 48 px** — drags only `bar.y1`.
- **Right 48 px** — drags only `bar.y2`.
- **Middle** — drags both edges together, preserving tilt.

The Planck polygon fixture for the bar is rebuilt every frame the bar moves (`updateBarBody()` in zen1-physics.js) to exactly match the visual trapezoid slope, extended 10 px past each wall to eliminate edge-gap tunneling.

## Spring physics

Spring joint is a Planck `DistanceJoint` with `length: 0`:

- `SPRING_FREQ_HZ = 4`, `SPRING_DAMP_RATIO = 0.7` — natural-feeling spring, slightly under-damped.
- While held: disk restitution → `ANCHOR_BOUNCE = 0.5`, linear damping → `HOLD_DAMPING = 5`.
- On release: speed > `FLING_THRESHOLD = 200` px/s → disk keeps momentum (`resetTrail`); otherwise velocity is zeroed.

## Trail: offscreen-canvas accumulation

[Zen1/zen1-trail.js](Zen1/zen1-trail.js) uses a persistent offscreen canvas — **never cleared between frames**, only on reset or grab. Each `tickTrail()` call draws one new line segment (prev → current position) directly onto the offscreen canvas, then `drawTrail()` blits it with a single `drawImage`. Cost is O(1) per frame regardless of total path length.

- `lineCap = 'butt'` — prevents round-cap alpha overlap at segment joints (which would show as brighter knees).
- `pauseTrail()` (called on grab) — clears the position buffer so the next segment after release starts fresh with no jump-line.
- `resetTrail()` — clears both the buffer and the offscreen canvas.
- On window resize the offscreen canvas is recreated (old drawing lost); position buffer is also cleared to avoid a stale connecting segment.
- **9 colors** (grey default + 8 pastels), all at 0.2 opacity, cycled by the ◐ Color button. Color changes affect only future strokes; old strokes retain their color.

## Speed buttons

`+` and `−` buttons in `#speed-panel` (bottom center) call `adjustSpeed(factor)` in zen1-physics.js:

- Moving disk: velocity scaled by `SPEED_FACTOR = 1.2` (+ button) or `1/1.2` (− button).
- Static disk (speed < 0.01 m/s): kicked at `INITIAL_SPEED_PX = 300` px/s at **37°** before the factor is applied.

## Feature flags (zen1-physics.js)

| Flag | Default | Effect |
|---|---|---|
| `USE_CHIMES` | `true` | Wall/bar bounces play pentatonic chimes keyed to disk Y; false falls back to knock sounds |
| `USE_TARGETS` | `false` | Regenerating pickup circles (currently shelved) |
| `USE_BUMPER` | `true` | Draggable circular bumper |
| `USE_TRAIL` | `true` | Offscreen-canvas path trail |
| `USE_IDLE_RESET` | `false` | Auto-freeze disk after `IDLE_TIMEOUT` seconds of no interaction |

## Key constants

| Constant | Value | Meaning |
|---|---|---|
| `PPM` | 64 | Pixels per metre (Planck.js scale) |
| `SPRING_FREQ_HZ` | 4 | Spring natural frequency |
| `SPRING_DAMP_RATIO` | 0.7 | Spring damping ratio |
| `FLING_THRESHOLD` | 200 px/s | Minimum release speed to keep momentum |
| `ANCHOR_BOUNCE` | 0.5 | Disk restitution while spring is active |
| `HOLD_DAMPING` | 5 | Linear damping while spring is active |
| `MAX_BOUNCE_SPEED` | 1200 px/s | Reference speed for sound intensity scaling |
