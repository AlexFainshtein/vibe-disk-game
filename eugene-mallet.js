import { canvas, renderExtras, inputHooks } from './state.js';
import { disk } from './playfield.js';
import { playKnock, playGulp } from './sound.js';

// Eugene-only feature: tap empty space to spawn a hollow-shell mallet that
// follows the finger. The mallet has TWO modes determined at spawn time by
// whether the disk was inside or outside the shell:
//   'outside' — disk outside; the mallet bounces it AWAY (off the outer rim),
//               moderate restitution.
//   'inside'  — disk inside; the mallet TRAPS it (it bounces off the inner
//               wall), heavy damping (very inelastic).
//
// The finger touches the BOTTOM RIM of the shell (not its center) — feels
// more natural when sweeping the mallet around, especially on phone.
//
// Self-registers a render hook + input hooks at module load. eugene-physics.js
// calls tickMallet(dt) each frame to resolve the mallet→disk collision.

// Mallet radius is 3× the disk radius (in the same shorter-canvas-dimension units).
// Per eugene-physics, Eugene's variant calls setDiskRadiusFraction(1/40), so this
// gives MALLET ≈ 9/40 of the shorter canvas dimension.
export const MALLET_RADIUS_FRACTION = (1/40) * 9;

const MALLET_RESTITUTION       = 0.5; // outer shell: moderate bounce
const MALLET_INNER_RESTITUTION = 0.1; // inner shell: heavy damping
const MAX_KNOCK_SPEED = 1200;

export const mallet = {
  active: false,
  x: 0, y: 0,
  prevX: 0, prevY: 0,
  vx: 0, vy: 0,
  r: 0,            // set on spawn from MALLET_RADIUS_FRACTION × shorter canvas dim
  mode: 'outside'  // 'outside' | 'inside' — set at spawn based on disk position
};

function drawMallet(c){
  if(!mallet.active) return;
  const shellR = mallet.r;
  const strokeW = Math.max(4, shellR * 0.12);
  c.beginPath();
  c.arc(mallet.x, mallet.y, shellR, 0, Math.PI * 2);
  c.strokeStyle = mallet.mode === 'inside'
    ? 'rgba(255,180,80,0.85)'   // warm amber when ball is trapped inside
    : 'rgba(160,220,255,0.85)'; // cool blue when ball is outside
  c.lineWidth = strokeW;
  c.stroke();
}

// This file is only loaded on Eugene's page (main.js dynamically imports the active
// physics module). No need to guard the registrations on player.
renderExtras.push(drawMallet);

function malletRadius(){
  return Math.min(canvas.width, canvas.height) * MALLET_RADIUS_FRACTION;
}

// Spawn / reposition the mallet at the touch position. The shell's center is
// placed `mallet.r` above the touch point so the bottom rim sits under the
// finger (feels natural when dragging the mallet around).
inputHooks.emptyDown = (x, y) => {
  const r = malletRadius();
  const cx = x;
  const cy = y - r; // center offset so bottom rim is under finger
  mallet.r = r;
  mallet.x = cx;
  mallet.y = cy;
  mallet.prevX = cx;
  mallet.prevY = cy;
  mallet.vx = 0;
  mallet.vy = 0;
  // Disk inside the shell at spawn → 'inside' mode (trap); else → 'outside'.
  const distToDisk = Math.hypot(disk.x - cx, disk.y - cy);
  mallet.mode = distToDisk < r - disk.r ? 'inside' : 'outside';
  mallet.active = true;
  // The gulp chirp fires every time the ring becomes warm amber (i.e., the
  // disk becomes captured) — both spawn-around-disk and wall-passage paths.
  if(mallet.mode === 'inside') playGulp();
  return true; // capture pointer for subsequent move/up
};
inputHooks.emptyMove = (x, y) => {
  mallet.prevX = mallet.x;
  mallet.prevY = mallet.y;
  mallet.x = x;
  mallet.y = y - mallet.r; // keep bottom rim under finger
};
inputHooks.emptyUp = () => {
  mallet.active = false;
};

export function tickMallet(dt){
  if(!mallet.active) return;

  // velocity from position delta this frame
  mallet.vx = (mallet.x - mallet.prevX) / dt;
  mallet.vy = (mallet.y - mallet.prevY) / dt;
  mallet.prevX = mallet.x;
  mallet.prevY = mallet.y;

  const dx = disk.x - mallet.x;
  const dy = disk.y - mallet.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const nx = dx / dist, ny = dy / dist; // outward normal from mallet center
  const shellR = mallet.r;

  if(mallet.mode === 'outside'){
    // Frictionless trap door: in 'outside' mode the wall does NOT deflect the
    // disk. The disk passes through with full velocity, and as soon as its
    // center crosses fully inside the shell (dist ≤ shellR − disk.r) the mode
    // switches to 'inside' and the shell becomes a trap. While the disk is
    // straddling the wall (shellR − disk.r < dist < shellR + disk.r) no force
    // is applied — neither outside nor inside collision fires.
    const contactR = shellR - disk.r;
    if(dist <= contactR){
      mallet.mode = 'inside';
      playGulp();
    }
  } else {
    // Disk inside (trapped): bounces off the INNER wall of the shell.
    // Contact when disk center is farther than shellR - disk.r from mallet center.
    const contactR = shellR - disk.r;
    if(dist < contactR) return;
    // push disk inward (toward mallet center) so it sits at the inner wall
    disk.x = mallet.x + nx * contactR;
    disk.y = mallet.y + ny * contactR;
    // For an inner-wall reflection, the surface normal points inward (negate nx,ny).
    // Equivalently, we reflect when relVn > 0 (disk moving outward into the wall).
    const relVn = (disk.vx - mallet.vx) * nx + (disk.vy - mallet.vy) * ny;
    if(relVn <= 0) return; // already moving inward (separating from inner wall)
    disk.vx -= (1 + MALLET_INNER_RESTITUTION) * relVn * nx;
    disk.vy -= (1 + MALLET_INNER_RESTITUTION) * relVn * ny;
    disk.glass = false;
    playKnock(Math.min(Math.abs(relVn) / MAX_KNOCK_SPEED, 1));
  }
}
