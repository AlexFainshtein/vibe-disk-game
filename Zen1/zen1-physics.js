import { canvas, params, renderExtras } from '../state.js';
import { disk, bar, anchor } from '../playfield.js';
import { playKnock, playChime } from '../sound.js';
import { tickTargets } from './zen1-targets.js';
import { tickBumper, bumper, notifyBumperHit } from './zen1-bumper.js';
import { tickTrail, pauseTrail, resetTrail, setTrailColor, resetTrailColor } from './zen1-trail.js';
import { clearPause } from './zen1-pause.js';
import { createSpringDragController } from '../controller-spring-drag.js';

disk.color     = '#888888';
disk.highlight = '#e8e8e8';
bar.color      = '#3a4a66';
const SPRING_COLOR = '#aaaaaa';

// Bar is the floor near the bottom; disk lives in the upper 95%.
bar.layout = 'bottom';

function zen1InitialBarY(){
  return canvas.height * 0.95 - bar.height;
}
bar.y = zen1InitialBarY();
bar.prevY = bar.y;


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

const MAX_BOUNCE_SPEED = 1200;

const USE_CHIMES = true;
const USE_TARGETS = false;
const USE_BUMPER = true;
const USE_TRAIL = true;
const USE_IDLE_RESET = false;
const IDLE_TIMEOUT = 60;

const springDrag = createSpringDragController({
  springK: 200,
  springDamp: 4,
  flingThreshold: 200,
});

let idleTime = 0;

let wasBarContact = false;
let wasBumperContact = false;

function noteFromY(){
  // Bar is the floor; top wall is the ceiling. Higher position = higher note.
  const R = disk.r;
  const eps = 0.5;
  if(disk.y <= R + eps) return 4;             // touching top wall → highest
  if(disk.y >= bar.y - R - eps) return 0;    // touching bar (floor) → lowest
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
    // top wall
    const t = (disk.r - disk.y) / disk.vy;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'top'; }
  }
  if(disk.vy > 0){
    // bar is the floor
    const t = (bar.y - disk.r - disk.y) / disk.vy;
    if(t >= 0 && t < bestT){ bestT = t; bestKind = 'floor'; }
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
  const a = vx*vx + vy*vy;
  const b = 2 * (dx*vx + dy*vy);
  const c = dx*dx + dy*dy - R*R;
  if(c < 0) return b < 0 ? 0 : Infinity;
  if(a < 1e-12) return Infinity;
  if(b >= 0)    return Infinity;
  const disc = b*b - 4*a*c;
  if(disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2*a);
  if(t < 0 || t > dtRemaining) return Infinity;
  return t;
}

function reflectAtWall(kind){
  let bs = 0;
  if(kind === 'left' || kind === 'right'){
    bs = Math.abs(disk.vx);
    disk.vx *= -params.bounce;
  } else if(kind === 'floor' || kind === 'top'){
    bs = Math.abs(disk.vy);
    disk.vy *= -params.bounce;
  }
  return bs;
}

function reflectAtBumper(){
  const dx = disk.x - bumper.x;
  const dy = disk.y - bumper.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const vDotN = disk.vx * nx + disk.vy * ny;
  if(vDotN >= 0) return 0;
  const factor = (1 + params.bounce) * vDotN;
  disk.vx -= factor * nx;
  disk.vy -= factor * ny;
  return Math.abs(vDotN);
}

export function update(dt){
  bar.vy = (bar.y - bar.prevY) / dt;
  const barMoved = bar.y !== bar.prevY;
  bar.prevY = bar.y;

  const friction = params.friction;
  const frameMultiplier = params.frameMultiplier;

  const ctrl = springDrag(disk, anchor, dt);
  if(ctrl.grabbed) clearPause();

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

  let nowBarContact = false;
  let nowBumperContact = false;

  // Static-overlap snap (bar as floor): push disk up if it's inside the bar.
  if(disk.y + disk.r > bar.y){
    disk.y = bar.y - disk.r;
    if(disk.y - disk.r < 0) disk.y = disk.r;
    nowBarContact = true;
  }

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
        nx = 0; ny = -1;
      }
      disk.x = bumper.x + nx * Rsum;
      disk.y = bumper.y + ny * Rsum;
      const minX = disk.r;
      const maxX = canvas.width - disk.r;
      const minY = disk.r;
      const maxY = bar.y - disk.r;
      disk.x = Math.max(minX, Math.min(maxX, disk.x));
      disk.y = Math.max(minY, Math.min(maxY, disk.y));
      const fdx = disk.x - bumper.x;
      const fdy = disk.y - bumper.y;
      const fd2 = fdx*fdx + fdy*fdy;
      if(fd2 < Rsum * Rsum){
        const fd = Math.sqrt(fd2) || 1;
        bumper.x = disk.x - (fdx / fd) * Rsum;
        bumper.y = disk.y - (fdy / fd) * Rsum;
      }
      nowBumperContact = true;
      notifyBumperHit();
    }
  }

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

    if(USE_TRAIL && !anchor.active) tickTrail();

    let bs;
    if(kind === 'bumper'){
      bs = reflectAtBumper();
      notifyBumperHit();
      nowBumperContact = true;
    } else if(kind === 'floor'){
      // floor = bar — defer sound to rising-edge logic
      bs = reflectAtWall(kind);
      nowBarContact = true;
    } else {
      // left, right, top — play immediately
      bs = reflectAtWall(kind);
      if(bs > 0){
        const intensity = Math.min(bs / MAX_BOUNCE_SPEED, 1);
        if(USE_CHIMES) playChime(intensity, noteFromY());
        else playKnock(intensity);
      }
    }
  }

  // Bar-carries-disk pin: when bar moves up fast, keep disk flush against it.
  if(nowBarContact && bar.vy < 0 && disk.vy > bar.vy){
    disk.y = bar.y - disk.r;
    if(disk.y - disk.r < 0) disk.y = disk.r;
  }

  // Defensive final overlap correction.
  if(disk.y + disk.r > bar.y){ disk.y = bar.y - disk.r; nowBarContact = true; }
  if(disk.y - disk.r < 0) disk.y = disk.r;
  if(disk.x - disk.r < 0) disk.x = disk.r;
  if(disk.x + disk.r > canvas.width) disk.x = canvas.width - disk.r;

  if(nowBarContact && !wasBarContact){
    const approach = Math.max(Math.abs(disk.vy), Math.abs(bar.vy));
    const intensity = Math.max(0.15, Math.min(approach / MAX_BOUNCE_SPEED, 1));
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else playKnock(intensity);
  }
  if(nowBumperContact && !wasBumperContact){
    const approach = Math.hypot(disk.vx, disk.vy);
    const intensity = Math.max(0.15, Math.min(approach / MAX_BOUNCE_SPEED, 1));
    playKnock(intensity);
  }
  wasBarContact = nowBarContact;
  wasBumperContact = nowBumperContact;

  const bumperEvents = USE_BUMPER ? tickBumper() : { firstHit: false, placed: false, removed: false, removedAfterHit: false };

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
      disk.vx = 0;
      disk.vy = 0;
      idleTime = 0;
    }
  }
}
