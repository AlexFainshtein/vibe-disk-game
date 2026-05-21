# claude_game2.md

Game2 — a standalone arcade game in the Vibe Disk Game project. **Not a variant** in the engine-sharing sense: it does not use `state.js`, `playfield.js`, `render.js`, `input.js`, `sound.js`, `controls.js`, or `main.js`. The entire game lives in a single self-contained HTML file with inline CSS and JavaScript.

Linked from the landing menu's **Eugene** column (button "Game2") at [index.html](../index.html).

## Files

- [game2.html](game2.html) — the whole game. ~600 lines including style, markup, and script.

## What it is

Drag-launch target shooter. Targets and bombs fall from the top; you fling disks at them from a circular launch zone near the bottom of the screen.

- **Launch zone**: dotted blue circle, center at `(innerWidth/2, innerHeight*0.78)`, radius `min(innerWidth, innerHeight) * 0.18`. A pointer drag is converted into a disk if the gesture's path *touches* the zone at any point — you don't have to start inside it. Released velocity is taken from the last few pointer-move samples (median of three for stability).
- **Disks**: 27px blue circles. Live for `DISK_LIFETIME_MS = 3000` then auto-explode. Bounce off all four walls with `bounce = 0.95`. Disappear off the top of the screen.
- **Targets**: blue squares with hit-count text (1, 2, or 3). Spawn rate ~1.8s. Falling speed `0.75 + random*1.7`. A hit shrinks the target (size 120 → 95 → 70) and decrements the count. When the count would go below 1, the target turns **green**, points zero out, and it bounces upward off-screen — you missed your scoring window.
- **Bombs**: red dots with a dotted red blast circle (radius 90px). Spawn rate ~3.6s. Move diagonally; bounce off left/right walls. Hitting a bomb with a disk **explodes** it — every target whose square overlaps the blast radius is destroyed and scores. A disk that's inside any active blast circle ignores target collisions (so the blast does the work, not the disk).
- **Scoring**: a target's `points` equal its initial level (1, 2, or 3). Bombs award 1 point per detonation, regardless of how many targets they take out. Each point also adds 1 second to the timer (capped at `MAX_TIME = 20`).
- **Lives & timer**: 3 lives, 20-second timer. Timer ticks down when not paused, ticks audibly the last 10 seconds. Lose a life if (a) the timer hits zero ("It's about time!"), (b) a target falls past the bottom, or (c) a bomb falls past the bottom. On life loss the screen clears, an overlay appears with a Continue button, and the timer resets. Out of lives → final Game Over overlay with "Try again".

## Audio

All sound is Web Audio API oscillators + noise bursts, generated inline. No external assets. AudioContext is created lazily on the first pointer event and resumed if suspended.

Cute touches: `sadSound` is a descending three-note phrase on life loss; `finalGameOverSound` is a longer falling sequence with a noise tail for game over.

## Pause

Pause button bottom-right. Toggling unpause re-anchors `lastTimerTick` so the timer doesn't snap-deduct accumulated paused time.

## Why it lives in its own folder

Engine-sharing variants (Alex, Alex1, Eugene, Zen1) all pull the same playfield + render loop and swap physics. Game2 is a different genre and didn't benefit from that architecture, so it's a standalone HTML file deployed alongside.

## Deploy

`deploy.bat` and `deploy.sh` both copy `game2/*` to `public/game2/` so the game ships with the rest of the site. Keep that copy step in sync if files are added to this folder.
