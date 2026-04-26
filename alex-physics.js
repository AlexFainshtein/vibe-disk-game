import { canvas, params, renderExtras } from './state.js';
import { disk, bar, anchor } from './playfield.js';
import { playKnock, playChime } from './sound.js';
import { tickTargets } from './alex-targets.js';
import { tickBumper } from './alex-bumper.js';
import { tickTrail, pauseTrail, resetTrail, setTrailColor, resetTrailColor } from './alex-trail.js';
import { clearPause } from './alex-pause.js';
import { createSpringDragController } from './controller-spring-drag.js';

// Alex-specific color palette (overrides the warm defaults in playfield.js).
// Background gradient is set in state.js (screen.backgrounds.alex).
disk.color = '#ffa53d'; // saturated amber — the protagonist
bar.color  = '#3a4a66'; // dark slate — playfield furniture, shared with the bumper
const SPRING_COLOR = '#22e8c4'; // vivid teal-mint — between cyan and green, strong but not neon

// Alex's bar lives at the top of the canvas as a movable ceiling; the disk lives
// below it with the canvas bottom as the floor. This flips the wall collisions
// in update() and the note mapping in noteFromY (compared to Eugene's bottom-bar layout).
bar.layout = 'top';

function drawSpringLine(c){
  if(!anchor.active) return;
  c.beginPath();
  c.moveTo(anchor.x, anchor.y);
  c.lineTo(disk.x, disk.y);
  c.strokeStyle = SPRING_COLOR;
  c.lineWidth = 2;
  c.stroke();
  c.beginPath();
  c.arc(anchor.x, anchor.y, 5, 0, Math.PI*2);
  c.fillStyle = SPRING_COLOR;
  c.fill();
}
renderExtras.push(drawSpringLine);

// EXPERIMENT (throwaway): press R to negate the disk's velocity and start a
// new trail in a contrasting color. Lets us watch the disk retrace its path
// in reverse and see how quickly the two trails diverge from rounding errors.
// Successive presses cycle through a small palette so multiple reversals are
// visually distinct. Reset restores the default white and rewinds the cycle.
// Remove this block + the setTrailColor/resetTrailColor imports + per-segment
// color support in alex-trail.js if not adopted.
const REVERSE_COLORS = [
  'rgba(255, 90, 200, 0.60)',  // magenta
  'rgba(120, 230, 255, 0.60)', // cyan
  'rgba(255, 220, 80, 0.60)',  // gold
];
let reverseIdx = 0;
function doReverse(){
  disk.vx = -disk.vx;
  disk.vy = -disk.vy;
  setTrailColor(REVERSE_COLORS[reverseIdx]);
  // Seed the new segment at the disk's current position so the new trail
  // visually joins the end of the previous one (otherwise its first point
  // would be one integration step away in the reversed direction).
  tickTrail();
  reverseIdx = (reverseIdx + 1) % REVERSE_COLORS.length;
}
window.addEventListener('keydown', (e) => {
  if(e.key === 'r' || e.key === 'R') doReverse();
});
const reverseBtn = document.getElementById('reverseBtn');
reverseBtn?.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't let the canvas see the tap
reverseBtn?.addEventListener('click', doReverse);
document.getElementById('resetDisk')?.addEventListener('click', () => {
  resetTrailColor();
  reverseIdx = 0;
});

const MAX_BOUNCE_SPEED = 1200;

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

  disk.x += disk.vx * dt;
  disk.y += disk.vy * dt;

  // bumper collision before walls so a bumper-push that lands the disk in a wall is resolved this frame
  const bumperEvents = USE_BUMPER ? tickBumper() : { firstHit: false, placed: false, removed: false, removedAfterHit: false };

  const W = canvas.width, H = canvas.height;
  let bounced = false, bounceSpeed = 0;
  if(disk.x - disk.r < 0){ disk.x = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  if(disk.x + disk.r > W){ disk.x = W - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  // floor collision: disk bounces off canvas bottom
  if(disk.y + disk.r > H){ disk.y = H - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -params.bounce; bounced = true; }
  // bar collision: disk bounces off bar bottom (the bar is the ceiling)
  // with relative velocity. Bar moving down (bar.vy > 0) pushes the disk down harder.
  const ceilingY = bar.y + bar.height;
  if(disk.y - disk.r < ceilingY){
    disk.y = ceilingY + disk.r;
    bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy));
    disk.vy = Math.abs(disk.vy) * params.bounce + 2 * bar.vy;
    bounced = true;
  }
  if(bounced){
    const intensity = Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1);
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else playKnock(intensity);
  }

  if(USE_TARGETS) tickTargets(dt);

  if(USE_TRAIL){
    if(ctrl.grabbed) pauseTrail();
    if(ctrl.flung || barMoved || bumperEvents.firstHit || bumperEvents.removedAfterHit) resetTrail();
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
}
