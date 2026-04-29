import { canvas, params, renderOverlays } from './state.js';
import { disk, bar, anchor } from './playfield.js';
import { playKnock, playChime } from './sound.js';
import { tickTargets } from './alex-targets.js';
import { tickBumper, bumper, notifyBumperHit } from './alex-bumper.js';
import { tickTrail, pauseTrail, resetTrail, setTrailColor, resetTrailColor, trailHasContent } from './alex-trail.js';
import { clearPause, negatePausedVelocity, getPausedSpeed, scalePausedVelocity } from './alex-pause.js';
import { createSpringDragController } from './controller-spring-drag.js';

// Alex-specific color palette (overrides the warm defaults in playfield.js).
// Background gradient is set in state.js (screen.backgrounds.alex).
// Monochrome: a flat gray disc on a dark background — no 3D treatment, since
// the ball was the only 3D-looking object in an otherwise flat game. The trail
// is the disk's translucent echo (rgba 255,255,255,0.28 in alex-trail.js); the
// spring line is mid-gray, visible against both the dark background and the
// gray disc.
//
// To revive the 3D "ball" look (drop shadow + radial gradient highlight at
// upper-left + specular ellipse — render.js gates all three on disk.highlight),
// uncomment the disk.highlight line below. Tuned values preserved here for the
// eventual colorful version.
disk.color     = '#888888';                   // flat disc fill
// disk.highlight = '#e8e8e8';                // 3D ball: bright spot at upper-left
bar.color      = '#3a4a66';                   // dark slate — playfield furniture, shared with the bumper
const SPRING_COLOR = '#aaaaaa';               // mid-gray — visible on both dark background and gray disc

// Alex's bar lives at the top of the canvas as a movable ceiling; the disk lives
// below it with the canvas bottom as the floor. This flips the wall collisions
// in update() and the note mapping in noteFromY (compared to Eugene's bottom-bar layout).
bar.layout = 'top';

// Auto-drift intro: at startup the disk is given a small initial velocity so
// it gently bounces around the playfield, producing occasional pentatonic
// chimes when it hits walls. This signals to first-time users that the disk
// is alive and touchable, without needing on-screen instructions; the user's
// first grab naturally takes over (anchor activates and the spring physics
// applies). We don't restore this on Reset — Reset reads as "stop everything
// and start fresh" rather than "restart intro".
disk.vx = 120;
disk.vy = 80;

// Disk-center marker + spring visualization. The center dot is *always*
// visible (a permanent attachment-point indicator); the line and anchor dot
// only appear while the user holds the disk. On desktop the center dot is
// steadily visible; on mobile the finger usually covers it during a hold and
// it flashes through after release. Rendered as an overlay so it sits on top
// of the disk.
function drawSpringOverlay(c){
  c.fillStyle = SPRING_COLOR;
  c.beginPath();
  c.arc(disk.x, disk.y, 5, 0, Math.PI*2);
  c.fill();
  if(!anchor.active) return;
  c.beginPath();
  c.moveTo(anchor.x, anchor.y);
  c.lineTo(disk.x, disk.y);
  c.strokeStyle = SPRING_COLOR;
  c.lineWidth = 2;
  c.stroke();
  c.beginPath();
  c.arc(anchor.x, anchor.y, 5, 0, Math.PI*2);
  c.fill();
}
renderOverlays.push(drawSpringOverlay);

// Erase / Draw toggle button (and the R key): press to flip the disk's
// velocity and switch the trail's drawing mode. In "Draw" mode (default), new
// trail strokes are white. In "Erase" mode, new strokes paint the canvas
// background color slightly thicker than the forward 1.5 px stroke, so the
// disk retracing its path overpaints (and effectively erases) the original
// white trail. The button label toggles between "Erase" (the action available
// when in Draw mode) and "Draw" (the action available when in Erase mode),
// mirroring the Pause/Resume label pattern. Trail data is preserved across
// presses; a roundtrip of presses leaves the visual trail re-drawn in white.
//
// Known caveat: once the disk has retraced past the end of the original white
// trail, subsequent strokes are still drawn in background color and become
// invisible. The user has to press Draw to come back to white. There's no
// clean automatic exit (we don't know when "fully erased" finishes).
//
// Depends on a flat background — see state.js → screen.backgrounds.alex.
//
// COLOR-CYCLE alternative (Pulse variant): each press cycles a new color on
// the new trail (no erase mode). Commented out below.
const REVERSE_TRAIL_COLOR = '#071018'; // matches the (flat) background in state.js
const REVERSE_TRAIL_WIDTH = 3;          // wider than the forward 1.5 px to cover antialiased edges
let reverseToggleOn = false;
const reverseBtn = document.getElementById('reverseBtn');
function setReverseLabel(){
  if(reverseBtn) reverseBtn.textContent = reverseToggleOn ? 'Draw' : 'Erase';
}
function doReverse(){
  disk.vx = -disk.vx;
  disk.vy = -disk.vy;
  // If the disk is paused, its real velocity lives in alex-pause.js's saved
  // velocity (disk.vx/vy are zero). Flip that too so a Resume after Reverse
  // resumes in the reversed direction.
  negatePausedVelocity();
  reverseToggleOn = !reverseToggleOn;
  if(reverseToggleOn) setTrailColor(REVERSE_TRAIL_COLOR, 'source-over', REVERSE_TRAIL_WIDTH);
  else                resetTrailColor();
  setReverseLabel();
  // Seed the new segment at the disk's current position so the new trail
  // visually joins the end of the previous one (otherwise its first point
  // would be one integration step away in the reversed direction).
  tickTrail();
}
// COLOR-CYCLE alternative (Pulse variant): each press flips velocity and
// switches to the next color in a cycle (no erase mode — colors layer over
// each other for a richer image).
// const REVERSE_COLORS = ['rgba(255,90,200,0.60)','rgba(120,230,255,0.60)','rgba(255,220,80,0.60)'];
// let reverseIdx = 0;
// function doReverse(){
//   disk.vx = -disk.vx; disk.vy = -disk.vy; negatePausedVelocity();
//   setTrailColor(REVERSE_COLORS[reverseIdx]); tickTrail();
//   reverseIdx = (reverseIdx + 1) % REVERSE_COLORS.length;
// }
window.addEventListener('keydown', (e) => {
  if(e.key === 'r' || e.key === 'R') doReverse();
});
reverseBtn?.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't let the canvas see the tap
reverseBtn?.addEventListener('click', doReverse);
document.getElementById('resetDisk')?.addEventListener('click', () => {
  resetTrailColor();
  reverseToggleOn = false;
  setReverseLabel();
});

// +/− speed controls. Each click scales the disk's velocity by a constant
// factor (4/3 up, 3/4 down — inverses, so a +/− pair returns to the original
// speed). Direction is preserved, so the trajectory pattern continues
// undisturbed; only the magnitude changes. Also scales the saved paused
// velocity so a Pause→+→Resume sequence resumes at the new speed.
const SPEED_STEP_UP   = 3/2;
const SPEED_STEP_DOWN = 2/3;
function adjustSpeed(factor){
  disk.vx *= factor;
  disk.vy *= factor;
  scalePausedVelocity(factor); // no-op if not paused
}
const fasterBtn = document.getElementById('fasterBtn');
const slowerBtn = document.getElementById('slowerBtn');
fasterBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
fasterBtn?.addEventListener('click', () => adjustSpeed(SPEED_STEP_UP));
slowerBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
slowerBtn?.addEventListener('click', () => adjustSpeed(SPEED_STEP_DOWN));

// Enable/disable the motion-modifying buttons (Reverse/Erase, +, −) based on
// whether they have anything to act on. Common rule: needs motion (live or
// paused velocity) AND not currently held — the spring drives disk.vx/vy
// during a grab, which would flicker the buttons, and these actions have no
// useful effect mid-grab anyway. Reverse adds one extra requirement: trail
// must be non-empty (the experiment paints over an existing path).
const MOVING_EPS = 0.5; // px/sec — below this is "effectively at rest"
function updateButtonStates(){
  const liveSpeed = Math.hypot(disk.vx, disk.vy);
  const pausedSpeed = getPausedSpeed();
  const hasMotion = liveSpeed > MOVING_EPS || pausedSpeed > MOVING_EPS;
  const canControl = hasMotion && !anchor.active;
  if(reverseBtn) reverseBtn.disabled = !(canControl && trailHasContent());
  if(fasterBtn)  fasterBtn.disabled  = !canControl;
  if(slowerBtn)  slowerBtn.disabled  = !canControl;
}
updateButtonStates(); // initial state at module load: no motion → all three disabled

// Fade the "Wiggle the disk." hint after the first canvas pointerdown.
// CSS handles the fade animation; { once: true } ensures we only fire once.
const uiHint = document.getElementById('ui');
if(uiHint){
  canvas.addEventListener('pointerdown', () => uiHint.classList.add('hidden'), { once: true });
}

const MAX_BOUNCE_SPEED = 1200;

// While the user holds the disk, walls/bar/bumper use a softer bounce
// coefficient than free-flying collisions. A stretched spring can push the
// disk into an obstacle at high speed but tiny displacement, where viscous
// damping does very little work per cycle — without this, the disk buzzes
// indefinitely against the obstacle. SPRING_BOUNCE bleeds enough energy off
// each contact that the disk settles quickly. Free-flying behavior on release
// is unchanged (anchor.active is false then, so params.bounce applies).
const SPRING_BOUNCE = 0.2;

const USE_CHIMES = true;            // pentatonic chime on bounce instead of knock
const USE_TARGETS = false;          // soft regenerating targets — shelved for now (set true to re-enable)
const USE_BUMPER = true;            // touch empty space to spawn a bumper that the disk collides with
const USE_TRAIL = true;             // draw the disk's trajectory; resets only on fling, bar move, bumper hit, bumper-removed-after-hit
const USE_IDLE_RESET = false;       // freeze the disk after IDLE_TIMEOUT seconds idle. Off by default — the Pause button covers this use case.
const IDLE_TIMEOUT = 60;            // seconds of idle before the disk's velocity is zeroed (only used when USE_IDLE_RESET is true)

// Spring-drag is the user's control scheme: hold the disk, the disk springs toward
// the finger, release classifies as fling or place. Tuning lives here so Alex can
// pick its own feel without touching the controller module.
const springDrag = createSpringDragController({
  springK: 200,         // spring stiffness (higher = snappier)
  springDamp: 4,        // damping (higher = less oscillation)
  flingThreshold: 200,  // px/sec at release; above this counts as a fling and erases the trail
});

let idleTime = 0;

// Rising-edge tracking for "first contact" sounds. Bar, bumper, and any
// wall/floor play their respective sound (chime / knock) on the transition
// from "not in contact" to "in contact" — a continuous push (bar dragging
// into a stationary disk, disk wedged against a placed bumper, or disk
// pressed into a wall by the spring) is silent after the first frame. Bar
// and bumper flags get refreshed from BOTH the static-snap and the TOI loop;
// the wall flag is set only by TOI hits (walls have no static-snap
// counterpart). The single combined wall flag means corner hits or rapid
// left↔right bouncing collapse to one sound per first-contact frame.
let wasBarContact = false;
let wasBumperContact = false;
let wasWallContact = false;

// Map disk vertical position at bounce time to one of 5 pentatonic notes.
// With the bar at the top acting as ceiling: touching the bar → 4 (highest),
// touching the floor (canvas bottom) → 0 (lowest); the middle band of height
// (H - 2R) is split into 3 equal stripes for 3, 2, 1 from top to bottom.
function noteFromY(){
  const ceilingY = bar.y + bar.height;          // disk's effective ceiling
  const physY = disk.y - ceilingY;              // depth of disk center below the bar
  const H = canvas.height - ceilingY;           // available vertical space below the bar
  const R = disk.r;
  const eps = 0.5;
  if(physY <= R + eps) return 4;                // just below the bar → highest
  if(physY >= H - R - eps) return 0;            // just above the floor → lowest
  const t = (physY - R - eps) / (H - 2*R - 2*eps); // 0..1, top→bottom of middle band
  if(t < 1/3) return 3;
  if(t < 2/3) return 2;
  return 1;
}

// ---- Time-of-impact (TOI) collision helpers ----------------------------------
// Each helper returns the time t in (0, dtRemaining] of the first contact with
// the corresponding object, or Infinity if no contact happens within that time.
// The disk's current position and velocity are read directly from `disk`.

function timeToWalls(dtRemaining){
  let bestT = Infinity, bestKind = null;
  // disk.x reaches the left wall when disk.x + vx*t = disk.r
  if(disk.vx < 0){
    const t = (disk.r - disk.x) / disk.vx;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'left'; }
  }
  // disk.x reaches the right wall when disk.x + vx*t = canvas.width - disk.r
  if(disk.vx > 0){
    const t = (canvas.width - disk.r - disk.x) / disk.vx;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'right'; }
  }
  // disk.y reaches the floor when disk.y + vy*t = canvas.height - disk.r
  if(disk.vy > 0){
    const t = (canvas.height - disk.r - disk.y) / disk.vy;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'floor'; }
  }
  // disk.y reaches the ceiling when disk.y + vy*t - disk.r = bar.y + bar.height
  if(disk.vy < 0){
    const ceilingY = bar.y + bar.height;
    const t = (ceilingY + disk.r - disk.y) / disk.vy;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'ceiling'; }
  }
  if(bestT > dtRemaining) return { t: Infinity, kind: null };
  return { t: bestT, kind: bestKind };
}

function timeToBumper(dtRemaining){
  if(!bumper.active) return Infinity;
  const dx = disk.x - bumper.x;
  const dy = disk.y - bumper.y;
  const vx = disk.vx, vy = disk.vy;
  const R = disk.r + bumper.r;
  // Quadratic in t: |D + V*t|^2 = R^2 -> a*t^2 + b*t + c = 0
  const a = vx*vx + vy*vy;
  const b = 2 * (dx*vx + dy*vy);
  const c = dx*dx + dy*dy - R*R;
  if(c < 0){
    // Already overlapping. Treat as immediate hit if approaching, else no hit.
    return b < 0 ? 0 : Infinity;
  }
  if(a < 1e-12) return Infinity; // not moving
  if(b >= 0)    return Infinity; // moving away (or tangent)
  const disc = b*b - 4*a*c;
  if(disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2*a);
  if(t < 0 || t > dtRemaining) return Infinity;
  return t;
}

function reflectAtWall(kind, bounce){
  let bs = 0;
  if(kind === 'left' || kind === 'right'){
    bs = Math.abs(disk.vx);
    disk.vx *= -bounce;
  } else if(kind === 'floor' || kind === 'ceiling'){
    bs = Math.abs(disk.vy);
    // No-kick model: the bar acts as a static surface for reflection. The
    // bar's own motion is handled separately via the static-overlap push in
    // update() (which kinematically carries the disk along) — so we don't
    // inject the bar's velocity into the disk on collision. This stops the
    // runaway-acceleration spiral that the old `+ 2*bar.vy` formula caused.
    disk.vy *= -bounce;
  }
  return bs;
}

function reflectAtBumper(bounce){
  // disk is at the moment of contact (just touching the bumper). Reflect
  // velocity across the contact normal. Returns the bounce speed (|v·n|).
  const dx = disk.x - bumper.x;
  const dy = disk.y - bumper.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const vDotN = disk.vx * nx + disk.vy * ny;
  if(vDotN >= 0) return 0; // already separating (defensive — shouldn't happen if TOI > 0)
  const factor = (1 + bounce) * vDotN;
  disk.vx -= factor * nx;
  disk.vy -= factor * ny;
  return Math.abs(vDotN);
}

export function update(dt){
  // compute bar velocity from position change; remember whether bar moved this frame
  bar.vy = (bar.y - bar.prevY) / dt;
  const barMoved = bar.y !== bar.prevY;
  bar.prevY = bar.y;

  const friction = params.friction; // 0..1 fractional braking
  const frameMultiplier = params.frameMultiplier;

  // Spring-drag controller: applies the spring force, classifies release.
  // Returns the gesture events the rest of update() reacts to.
  const ctrl = springDrag(disk, anchor, dt);
  if(ctrl.grabbed) clearPause();

  // friction (only when spring is not active)
  const speed = Math.hypot(disk.vx, disk.vy);
  if(!anchor.active && speed > 1e-6 && friction > 0){
    const decel = speed * friction * dt * frameMultiplier;
    const rawNewSpeed = speed - decel;
    let newSpeed;
    if(Math.sign(rawNewSpeed) !== Math.sign(speed)){
      newSpeed = speed;
    } else {
      newSpeed = rawNewSpeed;
    }
    const scale = newSpeed / speed;
    disk.vx *= scale;
    disk.vy *= scale;
  }

  // Track whether bar / bumper / any-wall are in contact with the disk this
  // frame. Bar and bumper flags are set by both the static-snap pass below
  // AND a dynamic TOI hit; the wall flag is set only by TOI hits. Sound plays
  // only on the rising edge (was-not → now-is), so a continuous push is
  // silent after the first contact. frameWallBs records the strongest pre-
  // reflection wall-impact speed seen this frame, used for the wall sound's
  // intensity at rising-edge time.
  let nowBarContact = false;
  let nowBumperContact = false;
  let nowWallContact = false;
  let frameWallBs = 0;

  // === Static-overlap snap (bar) ============================================
  // If the bar (acting as ceiling) overlaps the disk's current position, push
  // the disk down so it stays below the bar. This is what kinematically
  // "carries" a stationary disk along when the user drags the bar — the TOI
  // loop only detects collisions caused by disk velocity, so without this a
  // paused disk would be visually driven over by the bar. clampBarY bounds
  // bar.y to keep this push from shoving the disk past the floor (extra clamp
  // for defense).
  {
    const ceilingY = bar.y + bar.height;
    if(disk.y - disk.r < ceilingY){
      disk.y = ceilingY + disk.r;
      if(disk.y + disk.r > canvas.height) disk.y = canvas.height - disk.r;
      nowBarContact = true;
    }
  }

  // === Static-overlap snap (bumper) =========================================
  // Same idea for the bumper: when the user places one near the disk, push the
  // disk along the contact normal. Clamp the disk to the playable area so the
  // push can't shove it through walls / past the bar / under the floor. If
  // clamping leaves the disk still overlapping the bumper (disk wedged into a
  // corner), nudge the bumper back along the normal so they end up just
  // touching — the bumper's tapped position shifts a little, but the disk
  // stays put and the constraint is satisfied.
  if(USE_BUMPER && bumper.active){
    const ddx = disk.x - bumper.x;
    const ddy = disk.y - bumper.y;
    const Rsum = disk.r + bumper.r;
    const d2 = ddx*ddx + ddy*ddy;
    if(d2 < Rsum * Rsum){
      let nx, ny;
      if(d2 > 1e-9){
        const d = Math.sqrt(d2);
        nx = ddx / d; ny = ddy / d;
      } else {
        nx = 0; ny = -1; // centers coincide — pick an arbitrary direction
      }
      // Push disk to the surface, then clamp to the playable area.
      disk.x = bumper.x + nx * Rsum;
      disk.y = bumper.y + ny * Rsum;
      const minX = disk.r;
      const maxX = canvas.width - disk.r;
      const minY = bar.y + bar.height + disk.r;
      const maxY = canvas.height - disk.r;
      disk.x = Math.max(minX, Math.min(maxX, disk.x));
      disk.y = Math.max(minY, Math.min(maxY, disk.y));
      // If the clamp left the disk still overlapping the bumper, push the
      // bumper away from the disk along the same normal until they're just
      // touching.
      const fdx = disk.x - bumper.x;
      const fdy = disk.y - bumper.y;
      const fd2 = fdx*fdx + fdy*fdy;
      if(fd2 < Rsum * Rsum){
        const fd = Math.sqrt(fd2) || 1;
        bumper.x = disk.x - (fdx / fd) * Rsum;
        bumper.y = disk.y - (fdy / fd) * Rsum;
      }
      nowBumperContact = true;
      // The bumper module needs to know a contact happened so its `firstHit`
      // event flag fires (which, in turn, resets the trail — see USE_TRAIL).
      notifyBumperHit();
    }
  }

  // === Time-of-impact integration loop ======================================
  // Each iteration finds the earliest collision (over the four walls and the
  // bumper) within the remaining time, integrates up to it, records the
  // impact in the trail (giving a clean V-vertex at the actual geometric
  // contact), reflects velocity, and repeats with leftover time. Capped at 4
  // iterations to defend against pathological cases (e.g. disk wedged in a
  // corner). Sound for ceiling and bumper hits is suppressed here — both go
  // through the rising-edge logic at the end of update().
  // Soft bounce while the spring is held, normal bounce when free — see
  // SPRING_BOUNCE comment for why.
  const bounceCoeff = anchor.active ? SPRING_BOUNCE : params.bounce;
  let remaining = dt;
  for(let iter = 0; iter < 4 && remaining > 0; iter++){
    const wallHit = timeToWalls(remaining);
    const bumperT = USE_BUMPER ? timeToBumper(remaining) : Infinity;

    let t = remaining;
    let kind = null;
    if(wallHit.t < t){ t = wallHit.t; kind = wallHit.kind; }
    if(bumperT < t){   t = bumperT;   kind = 'bumper';   }

    disk.x += disk.vx * t;
    disk.y += disk.vy * t;
    remaining -= t;

    if(kind === null) break;

    // Record the impact point in the trail BEFORE reflecting velocity.
    if(USE_TRAIL && !anchor.active) tickTrail();

    let bs;
    if(kind === 'bumper'){
      bs = reflectAtBumper(bounceCoeff);
      notifyBumperHit();
      nowBumperContact = true;
      // sound deferred to rising-edge logic below
    } else if(kind === 'ceiling'){
      bs = reflectAtWall(kind, bounceCoeff);
      nowBarContact = true;
      // sound deferred to rising-edge logic below
    } else {
      // left, right, floor — set the wall-contact flag and defer sound to
      // the rising-edge logic below. Without this gating the spring pressing
      // the disk into a wall would re-trigger a sound every frame.
      bs = reflectAtWall(kind, bounceCoeff);
      if(bs > frameWallBs) frameWallBs = bs;
      nowWallContact = true;
    }
  }

  // === End-of-frame "bar carries disk" pin ==================================
  // After the TOI loop, the disk's own vy may have carried it slightly below
  // the bar within the frame (gap ≈ |disk.vy| · dt). When the bar is actively
  // pushing the disk in the same direction (bar.vy > 0 AND disk slower than
  // bar), pin the disk to bar.bottom + disk.r so the bar visibly carries it
  // along — disk's `vy` is preserved (still no-kick), only its position is
  // locked while the bar is the faster mover. The `disk.vy < bar.vy` clause
  // means a disk that just reflected off the bar (post-reflection vy >>
  // bar.vy) is correctly *not* pinned and flies away normally.
  if(nowBarContact && bar.vy > 0 && disk.vy < bar.vy){
    const ceilingY = bar.y + bar.height;
    disk.y = ceilingY + disk.r;
    if(disk.y + disk.r > canvas.height) disk.y = canvas.height - disk.r;
  }

  // === Defensive final overlap correction ===================================
  // Catch any wall overlap the TOI loop's iteration cap or floating-point drift
  // might have left behind (typically when the disk has high velocity in a
  // squeezed playfield and bounces faster than 4× per frame). The disk should
  // never end a frame outside the playable area; if the TOI already resolved
  // cleanly this is a no-op.
  {
    const ceilingY = bar.y + bar.height;
    if(disk.y - disk.r < ceilingY){ disk.y = ceilingY + disk.r; nowBarContact = true; }
    if(disk.y + disk.r > canvas.height) disk.y = canvas.height - disk.r;
    if(disk.x - disk.r < 0) disk.x = disk.r;
    if(disk.x + disk.r > canvas.width) disk.x = canvas.width - disk.r;
  }

  // === Rising-edge sounds (bar + bumper + walls/floor) ======================
  if(nowBarContact && !wasBarContact){
    // First contact this episode. Intensity from the larger of disk and bar
    // approach speeds so a slow disk hitting a fast-moving bar still chimes
    // audibly, and a fast disk hitting a stationary bar also works.
    const approach = Math.max(Math.abs(disk.vy), Math.abs(bar.vy));
    const intensity = Math.max(0.15, Math.min(approach / MAX_BOUNCE_SPEED, 1));
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else playKnock(intensity);
  }
  if(nowBumperContact && !wasBumperContact){
    // Knock for first contact with bumper. Bumper-placement-into-disk has no
    // real "approach speed", so we floor the intensity to keep it audible.
    const approach = Math.hypot(disk.vx, disk.vy);
    const intensity = Math.max(0.15, Math.min(approach / MAX_BOUNCE_SPEED, 1));
    playKnock(intensity);
  }
  if(nowWallContact && !wasWallContact && frameWallBs > 0){
    // First wall/floor contact this episode. Intensity uses the strongest
    // pre-reflection impact speed seen this frame, so corner hits sound
    // proportionate to the harder hit. No 0.15 floor: walls have no
    // "placement-into-disk" case where approach speed is artificially zero.
    const intensity = Math.min(frameWallBs / MAX_BOUNCE_SPEED, 1);
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else playKnock(intensity);
  }
  wasBarContact = nowBarContact;
  wasBumperContact = nowBumperContact;
  wasWallContact = nowWallContact;

  // Bumper events still need to be polled — `placed`, `removed`, `firstHit`,
  // `removedAfterHit` are updated by user input + notifyBumperHit() above.
  const bumperEvents = USE_BUMPER ? tickBumper() : { firstHit: false, placed: false, removed: false, removedAfterHit: false };

  if(USE_TARGETS) tickTargets(dt);

  if(USE_TRAIL){
    if(ctrl.grabbed) pauseTrail();
    // Trail resets on fling release and on bar movement. Bumper events used to
    // reset it too (the design rationale was "placing/removing a bumper marks
    // a new chapter"), but with auto-drift continuously producing a trail and
    // the user wanting to keep complex trajectories that happen to encounter
    // a bumper, that rule does more harm than good. The Erase/Draw button now
    // gives the user explicit control over trail lifecycle.
    if(ctrl.flung || barMoved) resetTrail();
    if(!anchor.active) tickTrail();
  }

  if(USE_IDLE_RESET){
    const userInteracting = anchor.active || bar.dragging || bumperEvents.placed || bumperEvents.removed;
    if(userInteracting) idleTime = 0;
    else idleTime += dt;
    if(idleTime >= IDLE_TIMEOUT){
      // freeze the picture: stop the disk in place, but don't reset position, bar, bumper, or trail
      disk.vx = 0;
      disk.vy = 0;
      idleTime = 0;
    }
  }

  updateButtonStates();
}
