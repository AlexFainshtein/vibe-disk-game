import { renderExtras, inputHooks } from './state.js';
import { disk } from './playfield.js';
import { playKnock } from './sound.js';

// Eugene-only feature: tap empty space to spawn an air-hockey mallet that follows
// the finger; the mallet deflects the disk on overlap with restitution < 1.
//
// Self-registers a render hook + input hooks (emptyDown/emptyMove/emptyUp) at
// module load. eugene-physics.js calls tickMallet(dt) each frame to resolve the
// mallet→disk collision.

const MALLET_RESTITUTION = 0.5; // <1 absorbs energy on mallet hits
const MAX_KNOCK_SPEED = 1200;

export const mallet = {
  active: false,
  x: 0, y: 0,
  prevX: 0, prevY: 0,
  vx: 0, vy: 0
};

function drawMallet(c){
  if(!mallet.active) return;
  c.beginPath();
  c.arc(mallet.x, mallet.y, disk.r, 0, Math.PI * 2);
  c.fillStyle = 'rgba(200,200,200,0.75)';
  c.fill();
  // thick inset outline — drawn at reduced radius so stroke stays inside
  const strokeW = 10;
  c.beginPath();
  c.arc(mallet.x, mallet.y, disk.r - strokeW / 2, 0, Math.PI * 2);
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = strokeW;
  c.stroke();
  // center dot
  c.beginPath();
  c.arc(mallet.x, mallet.y, 5, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.fill();
}

// main.js eagerly imports both Alex's and Eugene's physics modules so it can pick
// one at runtime; that means this module's top-level code runs on Alex's page too.
// Gate the side effects (renderExtras / inputHooks registration) on player so we
// don't clobber Alex's bumper hook. The collision logic in tickMallet is also a
// no-op on Alex's page because mallet.active never becomes true there.
if(document.body.dataset.player === 'eugene'){
  renderExtras.push(drawMallet);

  inputHooks.emptyDown = (x, y) => {
    mallet.active = true;
    mallet.x = x;
    mallet.y = y;
    mallet.prevX = x;
    mallet.prevY = y;
    mallet.vx = 0;
    mallet.vy = 0;
    return true; // capture pointer for subsequent move/up
  };
  inputHooks.emptyMove = (x, y) => {
    mallet.prevX = mallet.x;
    mallet.prevY = mallet.y;
    mallet.x = x;
    mallet.y = y;
  };
  inputHooks.emptyUp = () => {
    mallet.active = false;
  };
}

export function tickMallet(dt){
  if(!mallet.active) return;

  // velocity from position delta this frame
  mallet.vx = (mallet.x - mallet.prevX) / dt;
  mallet.vy = (mallet.y - mallet.prevY) / dt;
  mallet.prevX = mallet.x;
  mallet.prevY = mallet.y;

  const dx = disk.x - mallet.x;
  const dy = disk.y - mallet.y;
  const dist = Math.hypot(dx, dy);
  const minDist = disk.r * 2;
  if(dist >= minDist || dist < 1e-6) return;

  // collision normal pointing from mallet center toward disk center
  const nx = dx / dist, ny = dy / dist;

  // push disk out of overlap
  disk.x = mallet.x + nx * minDist;
  disk.y = mallet.y + ny * minDist;

  // relative normal velocity — mallet treated as infinite mass
  const relVn = (disk.vx - mallet.vx) * nx + (disk.vy - mallet.vy) * ny;
  if(relVn >= 0) return; // already separating

  disk.vx -= (1 + MALLET_RESTITUTION) * relVn * nx;
  disk.vy -= (1 + MALLET_RESTITUTION) * relVn * ny;
  playKnock(Math.min(Math.abs(relVn) / MAX_KNOCK_SPEED, 1));
}
