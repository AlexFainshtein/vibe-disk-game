import { canvas, params } from './state.js';
import { disk, bar, anchor } from './playfield.js';
import { playKnock, playChime } from './sound.js';
import { tickTargets } from './alex-targets.js';
import { tickBumper } from './alex-bumper.js';
import { tickTrail, pauseTrail, resetTrail } from './alex-trail.js';
import { clearPause } from './alex-pause.js';

const MAX_BOUNCE_SPEED = 1200;
const SPRING_K = 200; // was 40;     // spring stiffness (higher = snappier)
const SPRING_DAMP = 4;   // damping (higher = less oscillation)

const USE_CHIMES = true;            // pentatonic chime on bounce instead of knock
const USE_TARGETS = false;          // soft regenerating targets — shelved for now (set true to re-enable)
const USE_BUMPER = true;            // touch empty space to spawn a bumper that the disk collides with
const USE_TRAIL = true;             // draw the disk's trajectory; resets only on fling, bar move, bumper hit, bumper-removed-after-hit
const USE_IDLE_RESET = false;       // freeze the disk after IDLE_TIMEOUT seconds idle. Off by default — the Pause button covers this use case.
const IDLE_TIMEOUT = 60;            // seconds of idle before the disk's velocity is zeroed (only used when USE_IDLE_RESET is true)
const FLING_SPEED_THRESHOLD = 200;  // px/sec at release; above this counts as a fling and erases the trail

let idleTime = 0;
let prevAnchorActive = false;

// Map disk vertical position at bounce time to one of 5 pentatonic notes.
// Touching the bar → 0 (lowest), touching the ceiling → 4 (highest);
// the middle band of height (H - 2R) is split into 3 equal stripes for 1, 2, 3.
function noteFromY(){
  const physY = bar.y - disk.y; // height of disk center above the bar
  const H = bar.y;
  const R = disk.r;
  const eps = 0.5;
  if(physY <= R + eps) return 0;
  if(physY >= H - R - eps) return 4;
  const t = (physY - R - eps) / (H - 2*R - 2*eps); // 0..1 across middle band
  if(t < 1/3) return 1;
  if(t < 2/3) return 2;
  return 3;
}

export function update(dt){
  // compute bar velocity from position change; remember whether bar moved this frame
  bar.vy = (bar.y - bar.prevY) / dt;
  const barMoved = bar.y !== bar.prevY;
  bar.prevY = bar.y;

  const friction = params.friction; // 0..1 fractional braking
  const frameMultiplier = params.frameMultiplier;

  // anchor transitions: grabbed pauses trail recording + clears pause state; released decides fling vs. place
  const grabbed = anchor.active && !prevAnchorActive;
  const released = !anchor.active && prevAnchorActive;
  prevAnchorActive = anchor.active;

  if(grabbed) clearPause();

  // No-fling release: if the user lets go with the disk barely moving, treat it as a deliberate placement
  // and zero the velocity so the disk freezes wherever they put it.
  const flung = released && Math.hypot(disk.vx, disk.vy) > FLING_SPEED_THRESHOLD;
  if(released && !flung){
    disk.vx = 0;
    disk.vy = 0;
  }

  // damped spring toward anchor
  if(anchor.active){
    const dx = anchor.x - disk.x;
    const dy = anchor.y - disk.y;
    disk.vx += (SPRING_K * dx - SPRING_DAMP * disk.vx) * dt;
    disk.vy += (SPRING_K * dy - SPRING_DAMP * disk.vy) * dt;
  }

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
  if(disk.y - disk.r < 0){ disk.y = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -params.bounce; bounced = true; }
  // bar collision: disk bounces off bar top with relative velocity
  if(disk.y + disk.r > bar.y){
    disk.y = bar.y - disk.r;
    bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy));
    disk.vy = -Math.abs(disk.vy) * params.bounce + 2 * bar.vy;
    bounced = true;
  }
  if(bounced){
    const intensity = Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1);
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else playKnock(intensity);
  }

  if(USE_TARGETS) tickTargets(dt);

  if(USE_TRAIL){
    if(grabbed) pauseTrail();
    if(flung || barMoved || bumperEvents.firstHit || bumperEvents.removedAfterHit) resetTrail();
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
