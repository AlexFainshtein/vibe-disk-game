import { canvas, inputHooks, renderExtras } from '../state.js';
import { disk, bar, setDiskRadiusFraction } from '../playfield.js';
// import './alex2-diagnostic.js'; // uncomment to re-run the one-shot XPBD convergence test (writes xpbd-convergence.csv)

// Alex2: a Verlet-integrated string. The user drags one end (the "anchor")
// with the finger; the rest of the string follows by pure inertia + iterative
// distance-constraint relaxation. No gravity, no damping — a minimal sandbox
// for studying whip / pendulum / wave dynamics.
//
// Why no explicit acceleration term in the Verlet step here: with equal
// particle masses and no external forces, a·dt² is zero, so the update
// collapses to  new_pos = pos + (pos − prev_pos).  The (pos − prev_pos)
// term encodes velocity implicitly; inertia is fully preserved.

// Hide the engine's bar; hide the engine's disk (DISK_RADIUS_FRACTION → 0,
// so render.js draws nothing for it on every frame and every resize). We
// draw the rope + the anchor marker ourselves through renderExtras.
bar.hidden = true;
inputHooks.diskGrab = false;
setDiskRadiusFraction(0);

const N = 15;                       // particles in the chain
const ROPE_LENGTH_FRACTION = 0.45;  // fraction of canvas width

// XPBD with substepping + adaptive constraint iterations. Each substep
// runs the constraint sweep repeatedly until the worst link-length
// violation (max over links of |dist − L| / L) drops below
// TARGET_VIOLATION, or until MAX_ITERATIONS is hit. Lagrange multipliers
// (lambda) reset at the start of each substep. Set COMPLIANCE > 0 to make
// the rope intentionally stretchy.
const SUBSTEPS         = 8;
const MAX_ITERATIONS   = 50;        // cap per substep
const TARGET_VIOLATION = 0.01;      // 1% per-link length tolerance
const COMPLIANCE       = 0;         // 0 = perfectly rigid; >0 = stretchy
const LOG_INTERVAL     = 60;        // frames between console-log lines

const ANCHOR_MARKER_RADIUS_FRAC = 1 / 60;
const ANCHOR_GRAB_RADIUS_FRAC   = 1 / 30;  // tap inside this radius grabs the anchor without snapping it to the touch point
const ANCHOR_COLOR = '#88c0d0';
const ANCHOR_KEY_STEP = 5;                 // pixels per arrow-key press
// Each segment is colored by its index along the chain (anchor → tip).
// Hue rotates through the full spectrum so overlapping segments from
// different parts of the chain are visually distinguishable.

let segmentLength = (canvas.width * ROPE_LENGTH_FRACTION) / (N - 1);
const particles = []; // each: { x, y, px, py }
const lambda = new Float64Array(N - 1); // Lagrange multipliers per link

function initRope(){
  particles.length = 0;
  segmentLength = (canvas.width * ROPE_LENGTH_FRACTION) / (N - 1);
  const startX = canvas.width / 2 - (canvas.width * ROPE_LENGTH_FRACTION) / 2;
  const y = canvas.height / 2;
  for(let i = 0; i < N; i++){
    const x = startX + i * segmentLength;
    particles.push({ x, y, px: x, py: y });
  }
}
initRope();

// Anchor follows the finger when held. We use the empty-space hooks rather
// than a disk-grab gesture so any touch on the canvas captures the anchor.
// Two grab modes set at pointerdown:
//   - Touch inside ANCHOR_GRAB_RADIUS of the anchor → grab with the touch's
//     offset from the anchor preserved; the anchor does NOT snap. Subsequent
//     moves keep the same offset, so the anchor follows the finger smoothly.
//   - Touch outside that radius → anchor snaps to the touch (offset = 0).
// Without this, tapping "on" the anchor would jostle it by a few pixels and
// inject a transient velocity that the chain interprets as a fast flick.
let anchorHeld = false;
let grabOffsetX = 0;
let grabOffsetY = 0;
inputHooks.emptyDown = (x, y) => {
  const grabR = Math.min(canvas.width, canvas.height) * ANCHOR_GRAB_RADIUS_FRAC;
  const dx = x - particles[0].x;
  const dy = y - particles[0].y;
  if(Math.hypot(dx, dy) > grabR){
    // Far from anchor: snap to the touch.
    particles[0].x = x;
    particles[0].y = y;
    particles[0].px = x;
    particles[0].py = y;
    grabOffsetX = 0;
    grabOffsetY = 0;
  } else {
    // Inside the grab zone: hold the anchor where it is, drag with offset.
    grabOffsetX = particles[0].x - x;
    grabOffsetY = particles[0].y - y;
  }
  anchorHeld = true;
  return true; // capture pointer for subsequent move / up
};
inputHooks.emptyMove = (x, y) => {
  if(!anchorHeld) return;
  particles[0].x = x + grabOffsetX;
  particles[0].y = y + grabOffsetY;
};
inputHooks.emptyUp = () => {
  anchorHeld = false;
};

// Arrow keys move the anchor in fixed increments — for controllable, axis-
// aligned tests independent of touch jitter. The browser's key autorepeat
// gives smooth motion when a key is held.
window.addEventListener('keydown', (e) => {
  let moved = false;
  switch(e.key){
    case 'ArrowLeft':  particles[0].x -= ANCHOR_KEY_STEP; moved = true; break;
    case 'ArrowRight': particles[0].x += ANCHOR_KEY_STEP; moved = true; break;
    case 'ArrowUp':    particles[0].y -= ANCHOR_KEY_STEP; moved = true; break;
    case 'ArrowDown':  particles[0].y += ANCHOR_KEY_STEP; moved = true; break;
  }
  if(moved) e.preventDefault();
});

// Adaptive-iteration logging state. We track the worst iteration count and
// the worst post-iteration violation across all substeps and all frames in
// the current LOG_INTERVAL window, then print one summary line and reset.
let logFrameCount = 0;
let logPeakIter   = 0;
let logPeakViol   = 0;

export function update(dt){
  const subDt = dt / SUBSTEPS;
  const alphaTilde = COMPLIANCE / (subDt * subDt);

  let framePeakIter = 0;
  let framePeakViol = 0;

  for(let s = 0; s < SUBSTEPS; s++){
    // 1. Verlet integration for non-anchor particles. No gravity, no damping.
    for(let i = 1; i < N; i++){
      const p = particles[i];
      const vx = p.x - p.px;
      const vy = p.y - p.py;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy;
    }

    // 2. Reset Lagrange multipliers at the start of every substep.
    lambda.fill(0);

    // 3. Adaptive XPBD constraint iterations. Sweep → check worst link
    // violation → stop when below TARGET_VIOLATION or when MAX_ITERATIONS
    // hit.  Anchor (particle 0) has inverse mass 0 (immovable).
    let iter = 0;
    let maxViolation;
    do {
      // Constraint sweep
      for(let i = 0; i < N - 1; i++){
        const a = particles[i];
        const b = particles[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const nx = dx / dist, ny = dy / dist;
        const C = dist - segmentLength;
        const wA = (i === 0) ? 0 : 1;
        const wB = 1;
        const dLambda = (-C - alphaTilde * lambda[i]) / (wA + wB + alphaTilde);
        lambda[i] += dLambda;
        a.x -= dLambda * wA * nx;
        a.y -= dLambda * wA * ny;
        b.x += dLambda * wB * nx;
        b.y += dLambda * wB * ny;
      }
      iter++;

      // Post-sweep violation check
      maxViolation = 0;
      for(let i = 0; i < N - 1; i++){
        const a = particles[i];
        const b = particles[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const viol = Math.abs(dist - segmentLength) / segmentLength;
        if(viol > maxViolation) maxViolation = viol;
      }
    } while(iter < MAX_ITERATIONS && maxViolation > TARGET_VIOLATION);

    if(iter > framePeakIter) framePeakIter = iter;
    if(maxViolation > framePeakViol) framePeakViol = maxViolation;
  }

  // Throttled logging: track peaks across the LOG_INTERVAL window.
  if(framePeakIter > logPeakIter) logPeakIter = framePeakIter;
  if(framePeakViol > logPeakViol) logPeakViol = framePeakViol;
  logFrameCount++;
  if(logFrameCount >= LOG_INTERVAL){
    console.log(`[Alex2] last ${logFrameCount}f | peak iters/substep: ${logPeakIter}/${MAX_ITERATIONS} | peak final violation: ${(logPeakViol * 100).toFixed(3)}%`);
    logFrameCount = 0;
    logPeakIter = 0;
    logPeakViol = 0;
  }
}

function drawRope(ctx){
  ctx.lineWidth = 3;
  for(let i = 0; i < N - 1; i++){
    const a = particles[i];
    const b = particles[i + 1];
    const hue = (i / (N - 2)) * 360;
    ctx.strokeStyle = `hsl(${hue}, 85%, 60%)`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Small disk marking the anchor (finger end).
  const r = Math.min(canvas.width, canvas.height) * ANCHOR_MARKER_RADIUS_FRAC;
  ctx.fillStyle = ANCHOR_COLOR;
  ctx.beginPath();
  ctx.arc(particles[0].x, particles[0].y, r, 0, Math.PI * 2);
  ctx.fill();
}
renderExtras.push(drawRope);

// Reset re-initializes the rope to its straight starting shape. controls.js
// handles its own reset of disk/bar; we just add ours alongside.
document.getElementById('resetDisk')?.addEventListener('click', initRope);
