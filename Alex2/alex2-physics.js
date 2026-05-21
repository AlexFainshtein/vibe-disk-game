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

const N = 150;                       // particles in the chain
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
const ANCHOR_GRAB_RADIUS_FRAC   = 1 / 60;  // grab zone = visible marker; no extra tolerance
const ANCHOR_COLOR = '#88c0d0';
const ANCHOR_KEY_STEP = 5;                 // pixels per arrow-key press

// Weight at the free (tip) end of the rope. Mass is expressed as a fraction
// of the total particle-mass count: WEIGHT_MASS_FRACTION × N unit particle
// masses. With N=15 and 0.30 fraction, the tip carries 4.5 unit masses
// (every other non-anchor particle has unit mass). Each particle stores its
// own inverse mass in `w` (see initRope) so the constraint solver respects it.
const WEIGHT_MASS_FRACTION = 0.30;
const WEIGHT_MASS          = WEIGHT_MASS_FRACTION * 15; // tied to N below
const WEIGHT_RADIUS_FRAC   = 1 / 40;       // 1.5× the anchor marker radius
const WEIGHT_COLOR         = '#e0e0e0';

// Rods are circular obstacles the rope collides with. Top-down view —
// imagine pegs sticking up out of the table. Tap on empty canvas places a
// rod at the touch; tap on an existing rod removes it.
const ROD_RADIUS_FRAC      = 1 / 30;
const ROD_TAP_RADIUS_FRAC  = 1 / 25;       // forgiving tap zone for removing a rod
const ROD_COLOR            = '#8e8378';    // muted warm gray
// Each segment is colored by its index along the chain (anchor → tip).
// Hue rotates through the full spectrum so overlapping segments from
// different parts of the chain are visually distinguishable.

let segmentLength = (canvas.width * ROPE_LENGTH_FRACTION) / (N - 1);
const particles = []; // each: { x, y, px, py }
const lambda = new Float64Array(N - 1); // Lagrange multipliers per link
const rods = [];      // each: { x, y, r }

function initRope(){
  particles.length = 0;
  segmentLength = (canvas.width * ROPE_LENGTH_FRACTION) / (N - 1);
  const startX = canvas.width / 2 - (canvas.width * ROPE_LENGTH_FRACTION) / 2;
  const y = canvas.height / 2;
  for(let i = 0; i < N; i++){
    const x = startX + i * segmentLength;
    // Inverse mass: anchor (i=0) is immovable; the tip (i=N-1) carries
    // WEIGHT_MASS unit-particle masses; the rest are unit mass.
    const w = (i === 0)     ? 0
            : (i === N - 1) ? 1 / WEIGHT_MASS
            :                 1;
    particles.push({ x, y, px: x, py: y, w });
  }
}
initRope();

// Tap hierarchy at pointerdown:
//   1. Inside ANCHOR_GRAB_RADIUS of the anchor → grab the anchor with
//      offset preserved; subsequent moves keep the same offset so the
//      anchor follows the finger without jolting.
//   2. On an existing rod → remove that rod.
//   3. Otherwise → place a new rod at the touch.
// Anchor no longer snaps to touch — once clicks are used to manage rods,
// snap-to-touch would conflict (clicking far from the anchor would both
// move the anchor and place a rod). Anchor moves via proximity grab +
// drag or via arrow keys.
let anchorHeld = false;
let grabOffsetX = 0;
let grabOffsetY = 0;
inputHooks.emptyDown = (x, y) => {
  // 1. Anchor proximity grab.
  const grabR = Math.min(canvas.width, canvas.height) * ANCHOR_GRAB_RADIUS_FRAC;
  const dxA = x - particles[0].x;
  const dyA = y - particles[0].y;
  if(Math.hypot(dxA, dyA) <= grabR){
    grabOffsetX = particles[0].x - x;
    grabOffsetY = particles[0].y - y;
    anchorHeld = true;
    return true; // capture pointer for subsequent move / up
  }
  // 2. Rod removal — search newest first so visually-top rods get removed
  // before older ones.
  const tapR = Math.min(canvas.width, canvas.height) * ROD_TAP_RADIUS_FRAC;
  for(let i = rods.length - 1; i >= 0; i--){
    const dxR = x - rods[i].x;
    const dyR = y - rods[i].y;
    if(Math.hypot(dxR, dyR) <= Math.max(rods[i].r, tapR)){
      rods.splice(i, 1);
      return false;
    }
  }
  // 3. Place a new rod.
  rods.push({ x, y, r: Math.min(canvas.width, canvas.height) * ROD_RADIUS_FRAC });
  return false;
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

    // 3. Adaptive XPBD constraint + rod-collision iterations. Each pass:
    // distance-constraint sweep → segment-vs-rod collision projection →
    // measure worst remaining violation. Stop when below TARGET_VIOLATION
    // or when MAX_ITERATIONS hit. The anchor's inverse mass is 0, so
    // distance and rod corrections both leave it untouched automatically
    // — the user can drag the anchor through rods, and the rope drapes
    // (via segment-vs-rod) around them.
    let iter = 0;
    let maxViolation;
    do {
      // Distance-constraint sweep
      for(let i = 0; i < N - 1; i++){
        const a = particles[i];
        const b = particles[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const nx = dx / dist, ny = dy / dist;
        const C = dist - segmentLength;
        const wA = a.w;
        const wB = b.w;
        const dLambda = (-C - alphaTilde * lambda[i]) / (wA + wB + alphaTilde);
        lambda[i] += dLambda;
        a.x -= dLambda * wA * nx;
        a.y -= dLambda * wA * ny;
        b.x += dLambda * wB * nx;
        b.y += dLambda * wB * ny;
      }

      // Segment-vs-rod collision projection. For each segment + rod, find
      // the closest point P on the segment to the rod center (clamped to the
      // segment endpoints, so this also handles the particle-vs-rod case at
      // t=0 / t=1). If P is inside the rod, push the segment outward along
      // the rod-center→P normal, distributing the correction across both
      // endpoints by barycentric weights (1−t) on A and t on B, scaled by
      // each endpoint's inverse mass. The anchor (w=0) auto-immovable.
      for(let i = 0; i < N - 1; i++){
        const a = particles[i];
        const b = particles[i + 1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abLen2 = abx*abx + aby*aby;
        if(abLen2 < 1e-12) continue;
        for(let r = 0; r < rods.length; r++){
          const rod = rods[r];
          let t = ((rod.x - a.x) * abx + (rod.y - a.y) * aby) / abLen2;
          if(t < 0) t = 0;
          else if(t > 1) t = 1;
          const px = a.x + t * abx;
          const py = a.y + t * aby;
          const dx = px - rod.x;
          const dy = py - rod.y;
          const distSq = dx*dx + dy*dy;
          if(distSq >= rod.r * rod.r) continue;
          const dist = Math.sqrt(distSq) || 1e-6;
          const nx = dx / dist, ny = dy / dist;
          const omt = 1 - t;
          const denom = a.w * omt * omt + b.w * t * t;
          if(denom < 1e-12) continue;  // both endpoints immovable
          const delta = (rod.r - dist) / denom;
          a.x += a.w * delta * omt * nx;
          a.y += a.w * delta * omt * ny;
          b.x += b.w * delta * t   * nx;
          b.y += b.w * delta * t   * ny;
        }
      }
      iter++;

      // Post-sweep violation check — worst of: link-length error, segment-
      // vs-rod penetration (as fraction of rod radius).
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
      for(let i = 0; i < N - 1; i++){
        const a = particles[i];
        const b = particles[i + 1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abLen2 = abx*abx + aby*aby;
        if(abLen2 < 1e-12) continue;
        for(let r = 0; r < rods.length; r++){
          const rod = rods[r];
          let t = ((rod.x - a.x) * abx + (rod.y - a.y) * aby) / abLen2;
          if(t < 0) t = 0;
          else if(t > 1) t = 1;
          const px = a.x + t * abx;
          const py = a.y + t * aby;
          const dpx = px - rod.x;
          const dpy = py - rod.y;
          const distSq = dpx*dpx + dpy*dpy;
          if(distSq < rod.r * rod.r){
            const viol = (rod.r - Math.sqrt(distSq)) / rod.r;
            if(viol > maxViolation) maxViolation = viol;
          }
        }
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

// Drawing layers, painted bottom-up by render.js iterating renderExtras:
//   1. rope segments — bottom
//   2. rods — on top of segments, so chord segments that cut through a rod's
//      interior are hidden (the rope visually drapes over the rod)
//   3. endpoints (anchor + weight) — on top of everything, always visible
function drawRopeSegments(ctx){
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
}

function drawRods(ctx){
  ctx.fillStyle = ROD_COLOR;
  for(const rod of rods){
    ctx.beginPath();
    ctx.arc(rod.x, rod.y, rod.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEndpoints(ctx){
  // Anchor (finger end)
  const anchorR = Math.min(canvas.width, canvas.height) * ANCHOR_MARKER_RADIUS_FRAC;
  ctx.fillStyle = ANCHOR_COLOR;
  ctx.beginPath();
  ctx.arc(particles[0].x, particles[0].y, anchorR, 0, Math.PI * 2);
  ctx.fill();
  // Weight (free end)
  const weightR = Math.min(canvas.width, canvas.height) * WEIGHT_RADIUS_FRAC;
  ctx.fillStyle = WEIGHT_COLOR;
  ctx.beginPath();
  ctx.arc(particles[N - 1].x, particles[N - 1].y, weightR, 0, Math.PI * 2);
  ctx.fill();
}

renderExtras.push(drawRopeSegments);
renderExtras.push(drawRods);
renderExtras.push(drawEndpoints);

// Reset re-initializes the rope to its straight starting shape and clears
// all placed rods. controls.js handles its own reset of disk/bar; we add
// ours alongside.
document.getElementById('resetDisk')?.addEventListener('click', () => {
  initRope();
  rods.length = 0;
});
