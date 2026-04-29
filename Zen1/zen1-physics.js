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

function timeToWalls(dtRemaining){
  let bestT = Infinity, bestKind = null;
  if(disk.vx < 0){
    const t = (disk.r - disk.x) / disk.vx;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'left'; }
  }
  if(disk.vx > 0){
    const t = (canvas.width - disk.r - disk.x) / disk.vx;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'right'; }
  }
  if(disk.vy < 0){
    const t = (disk.r - disk.y) / disk.vy;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'top'; }
  }
  {
    const { nx, ny } = barNormal();
    const vDotN = disk.vx * nx + disk.vy * ny;
    if(vDotN < 0){
      const dist = barSignedDist(disk.x, disk.y);
      if(dist > disk.r){
        const t = (dist - disk.r) / (-vDotN);
        if(t >= 0 && t < bestT){ bestT = t; bestKind = 'floor'; }
      }
    }
  }
  if(bestT > dtRemaining) return { t: Infinity, kind: null };
  return { t: bestT, kind: bestKind };
}

function timeToBumper(dtRemaining){
  if(!bumper.active) return Infinity;
  const dx = disk.x - bumper.x, dy = disk.y - bumper.y;
  const vx = disk.vx, vy = disk.vy;
  const R = disk.r + bumper.r;
  const a = vx*vx + vy*vy;
  const b = 2*(dx*vx + dy*vy);
  const c = dx*dx + dy*dy - R*R;
  if(c < 0) return b < 0 ? 0 : Infinity;
  if(a < 1e-12 || b >= 0) return Infinity;
  const disc = b*b - 4*a*c;
  if(disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2*a);
  if(t < 0 || t > dtRemaining) return Infinity;
  return t;
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

  // Spring acceleration — computed once per frame, applied proportionally per CCD sub-step.
  const ax = anchor.active ? SPRING_K * (anchor.x - disk.x) : 0;
  const ay = anchor.active ? SPRING_K * (anchor.y - disk.y) : 0;

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

  // Static overlap snap: bar.
  {
    const dist = barSignedDist(disk.x, disk.y);
    if(dist < disk.r){
      const { nx, ny } = barNormal();
      disk.x += (disk.r - dist)*nx;
      disk.y += (disk.r - dist)*ny;
      // Contact constraint: zero velocity into the surface so it can't accumulate.
      const vDotN = disk.vx*nx + disk.vy*ny;
      if(vDotN < 0){ disk.vx -= vDotN*nx; disk.vy -= vDotN*ny; }
      nowBarContact = true;
    }
  }

  // Static overlap snap: bumper.
  if(USE_BUMPER && bumper.active){
    const ddx = disk.x - bumper.x, ddy = disk.y - bumper.y;
    const Rsum = disk.r + bumper.r;
    const d2 = ddx*ddx + ddy*ddy;
    if(d2 < Rsum*Rsum){
      let nx, ny;
      if(d2 > 1e-9){ const d = Math.sqrt(d2); nx = ddx/d; ny = ddy/d; }
      else { nx = 0; ny = -1; }
      disk.x = bumper.x + nx*Rsum;
      disk.y = bumper.y + ny*Rsum;
      disk.x = Math.max(disk.r, Math.min(canvas.width - disk.r, disk.x));
      disk.y = Math.max(disk.r, Math.min(barFloorY(disk.x) - disk.r, disk.y));
      const fdx = disk.x - bumper.x, fdy = disk.y - bumper.y;
      const fd2 = fdx*fdx + fdy*fdy;
      if(fd2 < Rsum*Rsum){
        const fd = Math.sqrt(fd2) || 1;
        bumper.x = disk.x - (fdx/fd)*Rsum;
        bumper.y = disk.y - (fdy/fd)*Rsum;
      }
      // Contact constraint: zero velocity into the bumper.
      const vDotN = disk.vx*nx + disk.vy*ny;
      if(vDotN < 0){ disk.vx -= vDotN*nx; disk.vy -= vDotN*ny; }
      nowBumperContact = true;
      notifyBumperHit();
    }
  }

  // CCD: find earliest collision, integrate to it, reflect, repeat.
  let remaining = dt;
  for(let iter = 0; iter < 4 && remaining > 0; iter++){
    const wallHit = timeToWalls(remaining);
    const bumperT = USE_BUMPER ? timeToBumper(remaining) : Infinity;

    let t = remaining, kind = null;
    if(wallHit.t < t){ t = wallHit.t; kind = wallHit.kind; }
    if(bumperT  < t){ t = bumperT;   kind = 'bumper'; }

    // Apply spring + damping for exactly this sub-step's duration.
    disk.vx += ax * t;
    disk.vy += ay * t;
    if(anchor.active){
      disk.vx *= Math.max(0, 1 - PULL_DAMPING * t);
      disk.vy *= Math.max(0, 1 - PULL_DAMPING * t);
    }

    disk.x += disk.vx * t;
    disk.y += disk.vy * t;
    remaining -= t;

    if(kind === null) break;

    if(USE_TRAIL && !anchor.active) tickTrail();

    let bs = 0;
    if(kind === 'bumper'){
      bs = reflectAtBumper();
      notifyBumperHit();
      nowBumperContact = true;
    } else if(kind === 'floor'){
      bs = reflectAtBar();
      nowBarContact = true;
    } else {
      if(kind === 'left' || kind === 'right'){
        bs = Math.abs(disk.vx);
        disk.vx *= -params.bounce;
      } else {
        bs = Math.abs(disk.vy);
        disk.vy *= -params.bounce;
      }
      if(bs > 0){
        const intensity = Math.min(bs / MAX_BOUNCE_SPEED, 1);
        if(USE_CHIMES) playChime(intensity, noteFromY());
        else           playKnock(intensity);
      }
    }
  }

  // Bar carries disk upward when bar sweeps up.
  if(nowBarContact && bar.vy < 0 && disk.vy > bar.vy){
    disk.y = barFloorY(disk.x) - disk.r;
    if(disk.y < disk.r) disk.y = disk.r;
  }

  // Defensive final overlap corrections.
  {
    const dist = barSignedDist(disk.x, disk.y);
    if(dist < disk.r){
      const { nx, ny } = barNormal();
      disk.x += (disk.r - dist)*nx;
      disk.y += (disk.r - dist)*ny;
      const vDotN = disk.vx*nx + disk.vy*ny;
      if(vDotN < 0){ disk.vx -= vDotN*nx; disk.vy -= vDotN*ny; }
      nowBarContact = true;
    }
  }
  if(disk.y < disk.r)                disk.y = disk.r;
  if(disk.x < disk.r)                disk.x = disk.r;
  if(disk.x + disk.r > canvas.width) disk.x = canvas.width - disk.r;

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
