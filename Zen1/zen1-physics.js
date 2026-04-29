import { canvas, params, renderExtras } from '../state.js';
import { disk, bar, anchor } from '../playfield.js';
import { playKnock, playChime } from '../sound.js';
import { tickTargets } from './zen1-targets.js';
import { tickBumper, bumper, notifyBumperHit } from './zen1-bumper.js';
import { tickTrail, pauseTrail, resetTrail, setTrailColor, resetTrailColor } from './zen1-trail.js';
import { clearPause } from './zen1-pause.js';
import './zen1-bar.js';

disk.color     = '#888888';
disk.highlight = '#e8e8e8';
bar.color      = '#3a4a66';
const SPRING_COLOR = '#aaaaaa';

bar.layout = 'bottom';

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

const REVERSE_TRAIL_COLOR = '#071018';
const REVERSE_TRAIL_WIDTH = 3;
let reverseToggleOn = false;
function doReverse(){
  disk.vx = -disk.vx;
  disk.vy = -disk.vy;
  reverseToggleOn = !reverseToggleOn;
  if(reverseToggleOn) setTrailColor(REVERSE_TRAIL_COLOR, 'source-over', REVERSE_TRAIL_WIDTH);
  else                resetTrailColor();
  tickTrail();
}
window.addEventListener('keydown', (e) => {
  if(e.key === 'r' || e.key === 'R') doReverse();
});
const reverseBtn = document.getElementById('reverseBtn');
reverseBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
reverseBtn?.addEventListener('click', doReverse);
document.getElementById('resetDisk')?.addEventListener('click', () => {
  resetTrailColor();
  reverseToggleOn = false;
});

const uiHint = document.getElementById('ui');
if(uiHint){
  canvas.addEventListener('pointerdown', () => uiHint.classList.add('hidden'), { once: true });
}

const MAX_BOUNCE_SPEED  = 1200;
const SPRING_K          = 200;   // px/s² per px of displacement
const PULL_DAMPING      = 8;     // viscous damping (F = −c·v) applied while spring is active
const FLING_THRESHOLD   = 200;   // px/s — above this, release keeps velocity; below, freezes disk

const USE_CHIMES     = true;
const USE_TARGETS    = false;
const USE_BUMPER     = true;
const USE_TRAIL      = true;
const USE_IDLE_RESET = false;
const IDLE_TIMEOUT   = 60;

let idleTime         = 0;
let wasAnchorActive  = false;
let wasBarContact    = false;
let wasBumperContact = false;

function barFloorY(x){
  if(bar.y2 === undefined) return bar.y;
  return bar.y1 + (bar.y2 - bar.y1) * (x / canvas.width);
}

function barNormal(){
  const W = canvas.width;
  const tilt = (bar.y2 ?? bar.y1) - bar.y1;
  const len = Math.hypot(W, tilt) || 1;
  return { nx: tilt / len, ny: -W / len };
}

function barSignedDist(x, y){
  const { nx, ny } = barNormal();
  return x * nx + (y - bar.y1) * ny;
}

function noteFromY(){
  const R = disk.r, eps = 0.5;
  if(disk.y <= R + eps)                     return 4;
  if(disk.y >= barFloorY(disk.x) - R - eps) return 0;
  const t = (disk.y - R - eps) / (bar.y - 2*R - 2*eps);
  if(t < 1/3) return 3;
  if(t < 2/3) return 2;
  return 1;
}

function intersectorsAt(px, py){
  const hits = [];
  if(px - disk.r < 0)                         hits.push('left');
  if(px + disk.r > canvas.width)               hits.push('right');
  if(py - disk.r < 0)                          hits.push('top');
  if(barSignedDist(px, py) < disk.r)           hits.push('floor');
  if(USE_BUMPER && bumper.active &&
     Math.hypot(px - bumper.x, py - bumper.y) < disk.r + bumper.r)
                                               hits.push('bumper');
  return hits;
}

function applyReflection(kind){
  switch(kind){
    case 'left':   { const s = Math.abs(disk.vx); disk.vx =  s * params.bounce; return s; }
    case 'right':  { const s = Math.abs(disk.vx); disk.vx = -s * params.bounce; return s; }
    case 'top':    { const s = Math.abs(disk.vy); disk.vy =  s * params.bounce; return s; }
    case 'floor':  return reflectAtBar();
    case 'bumper': return reflectAtBumper();
  }
  return 0;
}

function reflectAtBar(){
  const { nx, ny } = barNormal();
  const vDotN = disk.vx*nx + disk.vy*ny;
  if(vDotN >= 0) return 0;
  const factor = (1 + params.bounce) * vDotN;
  disk.vx -= factor*nx;
  disk.vy -= factor*ny;
  return Math.abs(vDotN);
}

function reflectAtBumper(){
  const dx = disk.x - bumper.x, dy = disk.y - bumper.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx/dist, ny = dy/dist;
  const vDotN = disk.vx*nx + disk.vy*ny;
  if(vDotN >= 0) return 0;
  const factor = (1 + params.bounce) * vDotN;
  disk.vx -= factor*nx;
  disk.vy -= factor*ny;
  return Math.abs(vDotN);
}

export function update(dt){
  // Bar velocity at disk's x.
  const floorNow  = barFloorY(disk.x);
  const floorPrev = (bar.prevY1 ?? bar.y1) + ((bar.prevY2 ?? bar.y2) - (bar.prevY1 ?? bar.y1)) * (disk.x / canvas.width);
  bar.vy = (floorNow - floorPrev) / dt;
  const barMoved = bar.y1 !== bar.prevY1 || bar.y2 !== bar.prevY2;
  bar.prevY1 = bar.y1;
  bar.prevY2 = bar.y2;

  // Detect grab / release transitions.
  const justGrabbed  = anchor.active && !wasAnchorActive;
  const justReleased = !anchor.active && wasAnchorActive;
  wasAnchorActive = anchor.active;

  if(justGrabbed) clearPause();

  // On release: fling if fast, freeze if slow.
  let flung = false;
  if(justReleased){
    const speed = Math.hypot(disk.vx, disk.vy);
    if(speed <= FLING_THRESHOLD){ disk.vx = 0; disk.vy = 0; }
    else flung = true;
  }

  // Friction (always).
  {
    const speed = Math.hypot(disk.vx, disk.vy);
    if(speed > 1e-6 && params.friction > 0){
      const newSpeed = Math.max(0, speed - speed * params.friction * dt * params.frameMultiplier);
      disk.vx *= newSpeed / speed;
      disk.vy *= newSpeed / speed;
    }
  }

  let nowBarContact    = false;
  let nowBumperContact = false;

  // Binary-search CCD loop.
  let remaining = dt;
  for(let iter = 0; iter < 8 && remaining > 1e-9; iter++){
    const x0 = disk.x, y0 = disk.y;
    const vx0 = disk.vx, vy0 = disk.vy;
    // Recompute spring accel at current position each substep.
    const sax = anchor.active ? SPRING_K * (anchor.x - disk.x) : 0;
    const say = anchor.active ? SPRING_K * (anchor.y - disk.y) : 0;

    // Probe end-of-step position (linear — consistent with binary search below).
    const xE = x0 + vx0 * remaining;
    const yE = y0 + vy0 * remaining;

    if(intersectorsAt(xE, yE).length === 0){
      // No collision: commit full step.
      disk.vx = vx0 + sax * remaining;
      disk.vy = vy0 + say * remaining;
      if(anchor.active){
        disk.vx *= Math.max(0, 1 - PULL_DAMPING * remaining);
        disk.vy *= Math.max(0, 1 - PULL_DAMPING * remaining);
      }
      disk.x = xE;
      disk.y = yE;
      break;
    }

    // Binary search — 16 fixed bisection steps.
    let tLo = 0, tHi = remaining;
    for(let step = 0; step < 16; step++){
      const tMid = (tLo + tHi) * 0.5;
      if(intersectorsAt(x0 + vx0 * tMid, y0 + vy0 * tMid).length === 0)
        tLo = tMid;
      else
        tHi = tMid;
    }

    // Continue bisecting until exactly 1 intersector (or safety limit).
    let hitObjs = intersectorsAt(x0 + vx0 * tHi, y0 + vy0 * tHi);
    for(let extra = 0; extra < 32 && hitObjs.length > 1; extra++){
      if(tHi - tLo < 1e-12) break;
      const tMid = (tLo + tHi) * 0.5;
      const mids = intersectorsAt(x0 + vx0 * tMid, y0 + vy0 * tMid);
      if(mids.length === 0) tLo = tMid;
      else { tHi = tMid; hitObjs = mids; }
    }

    // tHi ≈ 0 means disk is stationary at the boundary — nothing to do.
    if(tHi < 1e-9) break;

    // Commit to contact point.
    disk.vx = vx0 + sax * tHi;
    disk.vy = vy0 + say * tHi;
    if(anchor.active){
      disk.vx *= Math.max(0, 1 - PULL_DAMPING * tHi);
      disk.vy *= Math.max(0, 1 - PULL_DAMPING * tHi);
    }
    disk.x = x0 + vx0 * tHi;
    disk.y = y0 + vy0 * tHi;

    // Analytic reflection off the single hit object.
    const kind = hitObjs[0];
    const bs   = applyReflection(kind);

    if(USE_TRAIL && !anchor.active) tickTrail();

    if(kind === 'bumper'){
      notifyBumperHit();
      nowBumperContact = true;
    } else if(kind === 'floor'){
      nowBarContact = true;
    } else {
      if(bs > 0){
        const intensity = Math.min(bs / MAX_BOUNCE_SPEED, 1);
        if(USE_CHIMES) playChime(intensity, noteFromY());
        else           playKnock(intensity);
      }
    }

    remaining -= tHi;
  }

  // Sound: rising-edge for bar and bumper.
  if(nowBarContact && !wasBarContact){
    const approach = Math.max(Math.abs(disk.vy), Math.abs(bar.vy));
    const intensity = Math.max(0.15, Math.min(approach / MAX_BOUNCE_SPEED, 1));
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else           playKnock(intensity);
  }
  if(nowBumperContact && !wasBumperContact){
    const intensity = Math.max(0.15, Math.min(Math.hypot(disk.vx, disk.vy) / MAX_BOUNCE_SPEED, 1));
    playKnock(intensity);
  }
  wasBarContact    = nowBarContact;
  wasBumperContact = nowBumperContact;

  const bumperEvents = USE_BUMPER
    ? tickBumper()
    : { firstHit: false, placed: false, removed: false, removedAfterHit: false };

  if(USE_TARGETS) tickTargets(dt);

  if(USE_TRAIL){
    if(justGrabbed) pauseTrail();
    if(flung || barMoved || bumperEvents.firstHit || bumperEvents.removedAfterHit) resetTrail();
    if(!anchor.active) tickTrail();
  }

  if(USE_IDLE_RESET){
    const userInteracting = anchor.active || bar.dragging || bumperEvents.placed || bumperEvents.removed;
    if(userInteracting) idleTime = 0;
    else idleTime += dt;
    if(idleTime >= IDLE_TIMEOUT){ disk.vx = 0; disk.vy = 0; idleTime = 0; }
  }
}
