# CLAUDE-EUGENE.md

Eugene's variant of the Vibe Disk Game. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls, sizing).

## Entry page

- [eugene.html](eugene.html) — sets `<body data-player="eugene">` so [main.js](main.js) dynamically imports `eugene-physics.js`. Has Reset, ⛶ Fullscreen, and two runtime toggles (`#altFriction`, `#quadSpring`) in `#panel`.

## Files

- [eugene-physics.js](eugene-physics.js) — Eugene's `update(dt)`. Owns its own spring physics inlined (deliberately *not* using [controller-spring-drag.js](controller-spring-drag.js)) — see "Why no shared controller" below. Per frame: 4 substeps interleaved with brick collision (bisection to find first contact), spring force toward anchor with separate radial/tangential damping, optional alt-friction mode (damping in the anchor's reference frame instead of the screen's), optional quadratic spring stiffness (`force = k_sq * dist * displacement`), then friction when spring inactive, wall + bar bounces, mallet→disk collision (delegated to `tickMallet`), bubble-pop tick. Reads runtime mode toggles directly from `#altFriction` and `#quadSpring` DOM elements. Registers a `renderExtras` callback that draws the spring-line visual (anchor → disk) — render.js itself stays variant-agnostic.
- [eugene-bricks.js](eugene-bricks.js) — `bricks` array, `initBricks()`, and the `bubblePop` animation state colocated because its lifecycle is triggered by brick collision. Self-registers `renderExtras` callbacks for both, calls `initBricks()` at module load, and subscribes to the Reset button to regenerate. Brick collision logic itself lives in eugene-physics.js (interleaved with the substep integration there).
- [eugene-mallet.js](eugene-mallet.js) — tap empty space to spawn an air-hockey mallet that follows the finger and deflects the disk with restitution < 1. Self-registers a `renderExtras` callback and `inputHooks.emptyDown/emptyMove/emptyUp`. `tickMallet(dt)` resolves the disk-vs-mallet collision and is called once per frame from eugene-physics.js.

All three files are only loaded on Eugene's page (transitively, via main.js's dynamic import of eugene-physics.js).

## Spring physics constants

Two parallel sets, switched by the `#altFriction` toggle at runtime:

- Default (damping in screen reference frame): `SPRING_K = 800`, `SPRING_K_SQ = 10`, `DAMP_RADIAL = SPRING_K/10`, `DAMP_TANGENTIAL = SPRING_K/10`.
- Alt friction (damping in anchor reference frame — felt-like response when the finger moves): `ALT_SPRING_K = 850`, `ALT_SPRING_K_SQ = 0.5`, `ALT_DAMP_RADIAL = ALT_SPRING_K/10`, `ALT_DAMP_TANGENTIAL = ALT_SPRING_K/10`.

Substep count is `SUBSTEPS = 4`. Substeps exist for two reasons: (1) the stiff spring (`SPRING_K = 800`) is numerically unstable with simple Euler integration at full frame `dt`, and (2) brick collision needs sub-frame resolution to avoid tunneling.

The `#quadSpring` toggle replaces `k * dx` with `k_sq * dist * dx` so the spring force grows quadratically with displacement. Useful for a snappier feel at large pulls.

## Why no shared controller

The original architecture plan was to extract Eugene's spring-drag into [controller-spring-drag.js](controller-spring-drag.js) the same way Alex's was. After discussion, the verdict: **physics engines stay per-variant**. Eugene's spring physics has too many idiosyncratic features (non-isotropic friction, finger-frame damping, runtime mode toggles) for a shared controller to be anything but contorted. Forcing it into the shared shape would either bloat the controller's API with options or invite constant modifications. Reusable abstractions in this codebase live one level smaller — at the **feature module** layer (mallet, bumper, trail, bricks), which any future variant can pick up.

## Bubble-pop / glass mode

When the disk hits the bar in Eugene's variant, it becomes "glass" (`disk.glass = true`, near-invisible body with iridescent rim, `playDing()`). A glass disk hitting a brick **pops** instead of breaking the brick: spawns a `bubblePop` animation, plays `playShatter()`, recenters the disk with zero velocity, deactivates mallet + anchor, and the next substep aborts (`shattered = true`).

When all bricks are destroyed, `playFanfare()` fires and a 600ms-delayed reset regenerates the wall + recenters the disk + clears glass/mallet/anchor.
