import { canvas, renderExtras, inputHooks } from '../state.js';
import { disk } from '../playfield.js';
import { playKnock, playGulp } from '../sound.js';
import { isLeftHanded } from './alex1-handedness.js';
import {
  MALLET_RADIUS_FRACTION, MALLET_CENTER_OFFSET, MALLET_INNER_RESTITUTION,
  MAX_BOUNCE_SPEED, THUMB_CORNER_Y
} from './alex1-config.js';

export { MALLET_RADIUS_FRACTION };

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

renderExtras.push(drawMallet);

function malletRadius(){
  return Math.min(canvas.width, canvas.height) * MALLET_RADIUS_FRACTION;
}

// Returns the thumb-pivot corner for the current handedness.
// Right-handed: bottom-right corner; left-handed: bottom-left corner.
// The mallet center is placed along the ray from this corner through the touch
// point, at distance mallet.r beyond the touch — so the near rim sits under
// the finger regardless of the drag direction.
function thumbCorner(){
  return { x: isLeftHanded ? 0 : canvas.width, y: canvas.height * THUMB_CORNER_Y };
}

function malletCenterFromTouch(tx, ty, r){
  const c = thumbCorner();
  const dx = tx - c.x, dy = ty - c.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  return { x: tx + (dx / len) * r * MALLET_CENTER_OFFSET, y: ty + (dy / len) * r * MALLET_CENTER_OFFSET };
}

inputHooks.emptyDown = (x, y) => {
  const r = malletRadius();
  const { x: cx, y: cy } = malletCenterFromTouch(x, y, r);
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
  const { x: cx, y: cy } = malletCenterFromTouch(x, y, mallet.r);
  mallet.x = cx;
  mallet.y = cy;
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
    // switches to 'inside' and the shell becomes a trap.
    const contactR = shellR - disk.r;
    if(dist <= contactR){
      mallet.mode = 'inside';
      playGulp();
    }
  } else {
    // Disk inside (trapped): bounces off the INNER wall of the shell.
    const contactR = shellR - disk.r;
    if(dist < contactR) return;
    disk.x = mallet.x + nx * contactR;
    disk.y = mallet.y + ny * contactR;
    const relVn = (disk.vx - mallet.vx) * nx + (disk.vy - mallet.vy) * ny;
    if(relVn <= 0) return;
    disk.vx -= (1 + MALLET_INNER_RESTITUTION) * relVn * nx;
    disk.vy -= (1 + MALLET_INNER_RESTITUTION) * relVn * ny;
    disk.glass = false;
    playKnock(Math.min(Math.abs(relVn) / MAX_BOUNCE_SPEED, 1));
  }
}
