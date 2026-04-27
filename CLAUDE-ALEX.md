# CLAUDE-ALEX.md

Alex's variant of the Vibe Disk Game. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls, sizing, reset chain).

## Entry page

- [alex.html](alex.html) — sets `<body data-player="alex">` so [main.js](main.js) dynamically imports `alex-physics.js`. Has Reset and ⏸ Pause buttons in `#panel`.

## Files

- [alex-physics.js](alex-physics.js) — Alex's `update(dt)`. Pipeline per frame:
  1. Compute `bar.vy` from frame-to-frame delta.
  2. Tick spring-drag controller (see below); apply friction.
  3. **Static-overlap snap (bar):** if the bar overlaps the disk, push disk down to `bar.bottom + disk.r` (and clamp to floor). Sets `nowBarContact`. This is what kinematically carries a stationary disk along when the user drags the bar.
  4. **Static-overlap snap (bumper):** if the bumper overlaps the disk, push disk along the contact normal, clamp to the playable area (walls + bar + floor). If the disk wedges into a corner and is still overlapping, nudge the bumper back along the same normal so they end up just touching. Sets `nowBumperContact` and calls `notifyBumperHit` so the trail's reset-on-firstHit still triggers.
  5. **Time-of-impact (TOI) integration loop** (max 4 iterations): finds the earliest collision (over the four walls + bumper) in the remaining frame, integrates exactly to that point, records the impact in the trail (clean V-vertex), reflects velocity, repeats with leftover time. Walls reflect with `*= -params.bounce`. **Bar reflection is the same** — no `+2·bar.vy` kick — so the bar can carry the disk's position via the static-snap but never injects kinetic energy (this stops the runaway-acceleration spiral that the kick used to cause). Sound for left/right/floor hits plays immediately inside the loop; bar (ceiling) and bumper hits set their respective `nowContact` flag and defer to the rising-edge logic below.
  6. **Rising-edge sound:** plays a chime (bar) or knock (bumper) on the transition from `wasContact = false` → `nowContact = true`. Continuous push (bar dragging into stationary disk; disk wedged against a placed bumper) is silent after the first frame. Intensity for bar = `max(|disk.vy|, |bar.vy|)`; for bumper = disk speed; floored at 0.15 so placement-into-disk is still audible.
  7. Bumper events poll, target tick, trail tick, idle-reset bookkeeping (existing).

  `noteFromY()` maps disk vertical position at bounce time to one of 5 pentatonic notes (bar = 4 highest, floor = 0 lowest, middle band split into 3 stripes). Controller's `grabbed` event triggers `clearPause()`; its `flung` event erases the trail. Also registers a `renderExtras` callback that draws the spring line from anchor to disk while held.

  **Owns Alex's color overrides:** sets `disk.color` and `bar.color` at module load (overriding the warm defaults in [playfield.js](playfield.js)) and defines `SPRING_COLOR` for the spring line. **Owns Alex's bar layout:** sets `bar.layout = 'top'` — the bar starts at `bar.height` from the top and acts as a movable ceiling; the disk lives below with the canvas bottom as the floor. Background gradient lives in `state.js → screen.backgrounds.alex`; bumper color in [alex-bumper.js](alex-bumper.js) is kept in sync with `bar.color` so the disk-affecting "furniture" reads as one visual group.
- [controller-spring-drag.js](controller-spring-drag.js) — pure controller: `createSpringDragController({springK, springDamp, flingThreshold})` returns a `tick(entity, anchor, dt)` function that applies a damped spring force from the entity toward the anchor while held, classifies the release gesture as a fling (speed > threshold; entity keeps its velocity) or a place (≤ threshold; entity is frozen by zeroing its velocity), and returns `{grabbed, released, flung, placed, active}` events the game module reacts to. Knows nothing about walls, sounds, or any game concern — operates only on `{x,y,vx,vy}`-shaped entities and `{x,y,active}`-shaped anchors. Eugene's variant deliberately does **not** use this controller; per the project verdict, physics engines stay per-variant because Eugene's exotic features (non-isotropic friction, finger-frame damping) don't generalize cleanly. Reused only by future Alex-style games.
- [alex-targets.js](alex-targets.js) — soft regenerating colored circles that chime an octave above the wall mapping when the disk passes through. Each target keeps a fixed pentatonic note across regenerations. **Currently shelved** (`USE_TARGETS = false` in alex-physics.js): rapid-fire collection bursts disrupted the wall-bounce melody. Code retained for revival.
- [alex-bumper.js](alex-bumper.js) — touch empty space to place a static circle (`BUMPER_RADIUS_FRACTION` of the shorter canvas dimension; bigger than the disk so it's visible under the finger) the disk reflects off. Tap on the bumper to remove it; tap on a different empty spot to relocate. Uses `inputHooks.emptyDown` (no move/up — the bumper does not follow finger drift after placement). The actual circle-vs-circle collision math (TOI + reflection) lives in [alex-physics.js](alex-physics.js); this module owns the bumper data (exported as `bumper`), the user-input lifecycle, the render hook, and the event flags. `notifyBumperHit()` is called by alex-physics on each detected collision so the event flags update correctly. `tickBumper()` returns `{firstHit, placed, removed, removedAfterHit}` events so other modules can react: the trail uses `firstHit` and `removedAfterHit` (a removal that came after at least one collision) to reset; idle-reset uses `placed` and `removed` as user-interaction signals. Subscribes to the Reset button click to clear itself.
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
