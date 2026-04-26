# CLAUDE-ALEX.md

Alex's variant of the Vibe Disk Game. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls, sizing, reset chain).

## Entry page

- [alex.html](alex.html) — sets `<body data-player="alex">` so [main.js](main.js) dynamically imports `alex-physics.js`. Has Reset and ⏸ Pause buttons in `#panel`.

## Files

- [alex-physics.js](alex-physics.js) — Alex's `update(dt)`: ticks the spring-drag controller (see below), applies friction when the spring is inactive, integrates position, bumper collision (before walls so a bumper-push that lands the disk in a wall is resolved this frame), wall bounces (×`-params.bounce`), bar collision (velocity reflection + 2× bar velocity), bounce chime, target tick, trail tick, and idle-reset bookkeeping. `noteFromY()` maps disk vertical position at the moment of bounce to one of 5 pentatonic notes (bar = 0, ceiling = 4, middle band split into 3 stripes). The controller's `grabbed` event triggers `clearPause()`; its `flung` event erases the trail. On idle timeout (`IDLE_TIMEOUT` seconds of no user input), zeros the disk's velocity in place — does not reset position, bar, bumper, or trail. Also registers a `renderExtras` callback that draws the spring line from anchor to disk while held (visual feedback for the spring controller; matches Eugene's variant).
- [controller-spring-drag.js](controller-spring-drag.js) — pure controller: `createSpringDragController({springK, springDamp, flingThreshold})` returns a `tick(entity, anchor, dt)` function that applies a damped spring force from the entity toward the anchor while held, classifies the release gesture as a fling (speed > threshold; entity keeps its velocity) or a place (≤ threshold; entity is frozen by zeroing its velocity), and returns `{grabbed, released, flung, placed, active}` events the game module reacts to. Knows nothing about walls, sounds, or any game concern — operates only on `{x,y,vx,vy}`-shaped entities and `{x,y,active}`-shaped anchors. Eugene's variant deliberately does **not** use this controller; per the project verdict, physics engines stay per-variant because Eugene's exotic features (non-isotropic friction, finger-frame damping) don't generalize cleanly. Reused only by future Alex-style games.
- [alex-targets.js](alex-targets.js) — soft regenerating colored circles that chime an octave above the wall mapping when the disk passes through. Each target keeps a fixed pentatonic note across regenerations. **Currently shelved** (`USE_TARGETS = false` in alex-physics.js): rapid-fire collection bursts disrupted the wall-bounce melody. Code retained for revival.
- [alex-bumper.js](alex-bumper.js) — touch empty space to place a static circle (`BUMPER_RADIUS_FRACTION` of the shorter canvas dimension; tan; bigger than the disk so it's visible under the finger) the disk reflects off. Tap on the bumper to remove it; tap on a different empty spot to relocate. Uses `inputHooks.emptyDown` (no move/up — the bumper does not follow finger drift after placement). Standard circle-vs-circle elastic reflection. Hits play `playKnock` (deliberately not part of the pentatonic melody). `tickBumper()` returns `{firstHit, placed, removed, removedAfterHit}` events so other modules can react: the trail uses `firstHit` and `removedAfterHit` (a removal that came after at least one collision) to reset; idle-reset uses `placed` and `removed` as user-interaction signals. Subscribes to the Reset button click to clear itself.
- [alex-trail.js](alex-trail.js) — soft semi-transparent polyline tracing the disk's trajectory. Stored as an array of segments; `pauseTrail()` ends the current segment without erasing so a subsequent resume starts a new sub-path (no straight line drawn between pre-pause and post-resume positions). Recording is paused while the user holds the disk. The trail is erased only on a fling release, bar movement, the first disk-bumper collision, or removal of a bumper that had been hit. It is **not** erased on Reset (the trajectory is a pattern the user wants to keep seeing) or on a no-fling release (which freezes the disk in place). On Reset the current segment is *broken* (subscribes to the Reset button via `pauseTrail`) so the teleport from the previous position to the center isn't drawn as a synthetic straight line.
- [alex-pause.js](alex-pause.js) — wires the ⏸ Pause / ▶ Resume button on Alex's page. Pause saves the disk's current velocity and zeros it; Resume restores the saved velocity. `clearPause()` is called by alex-physics on grab so a user picking up a paused disk takes over without the saved velocity coming back unexpectedly on the next Resume.

## Per-feature toggles

Alex's variant introduces small features one at a time. Each lives behind a `const`-flag at the top of [alex-physics.js](alex-physics.js) so it can be plugged in / out by flipping a single value:

- `USE_CHIMES` — bounces play `playChime` with a pentatonic note picked by `noteFromY()`; when false, falls back to `playKnock`.
- `USE_TARGETS` — soft regenerating circles in the playfield. Currently shelved (false).
- `USE_BUMPER` — touch empty space to place a static bumper.
- `USE_TRAIL` — draws the disk's current trajectory.
- `USE_IDLE_RESET` — after `IDLE_TIMEOUT` seconds of no user interaction, freezes the disk in place (zeros velocity); does **not** reset position, bar, bumper, or trail. Off by default — the Pause button covers this use case.

Plus tunables: `FLING_SPEED_THRESHOLD` (px/sec) — releases above this count as flings (which erase the trail and let the disk continue); releases at or below freeze the disk in place. Pause is a separate UI feature in [alex-pause.js](alex-pause.js); not flag-gated, just present when alex.html includes the `#pauseBtn` element.

Helper functions for a feature live next to its flag, or in their own `alex-*.js` module when the helper grows non-trivial.

## Sizing (Alex-specific)

- `BUMPER_RADIUS_FRACTION` (alex-bumper.js) — fraction of the shorter canvas dimension. Recomputed on resize.

## Reset behavior (Alex-specific)

The Reset button (handler in [controls.js](controls.js)) resets bar + disk; alex-bumper.js subscribes to the same click to clear itself. The trail does **not** subscribe — the trajectory is what the user wants to see after pressing Reset. The idle auto-reset is a different action (just zero the disk's velocity) and does **not** click the Reset button.
