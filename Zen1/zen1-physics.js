import { canvas, params, renderExtras } from '../state.js';
import { disk, bar } from '../playfield.js';
import { playKnock, playChime } from '../sound.js';
import { tickTargets } from './zen1-targets.js';
import { tickBumper, bumper, notifyBumperHit } from './zen1-bumper.js';
import { tickTrail, pauseTrail, resetTrail, setTrailColor, resetTrailColor } from './zen1-trail.js';
import { clearPause } from './zen1-pause.js';
import './zen1-bar.js';

window.ZEN1_VERSION = 'planck-1';

disk.color     = '#888888';
disk.highlight = '#e8e8e8';
bar.color      = '#3a4a66';
const SPRING_COLOR = '#aaaaaa';

bar.layout = 'bottom';

function drawSpringLine(c){
  if(!springJoint) return;
  const ap = anchorBody.getPosition();
  const dp = diskBody.getPosition();
  c.beginPath();
  c.moveTo(toPx(ap.x), toPx(ap.y));
  c.lineTo(toPx(dp.x), toPx(dp.y));
  c.strokeStyle = SPRING_COLOR;
  c.lineWidth = 2;
  c.stroke();
  c.beginPath();
  c.arc(toPx(ap.x), toPx(ap.y), 5, 0, Math.PI*2);
  c.fillStyle = SPRING_COLOR;
  c.fill();
}
renderExtras.push(drawSpringLine);

const REVERSE_TRAIL_COLOR = '#071018';
const REVERSE_TRAIL_WIDTH = 3;
let reverseToggleOn = false;
function doReverse(){
  const vel = diskBody.getLinearVelocity();
  diskBody.setLinearVelocity(Vec2(-vel.x, -vel.y));
  diskBody.setAwake(true);
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
  diskBody.setPosition(Vec2(toM(canvas.width / 2), toM(canvas.height / 2)));
  diskBody.setLinearVelocity(Vec2(0, 0));
  diskBody.setAwake(true);
  if(springJoint) destroySpringJoint();
  resetTrailColor();
  reverseToggleOn = false;
});

const uiHint = document.getElementById('ui');
if(uiHint){
  canvas.addEventListener('pointerdown', () => uiHint.classList.add('hidden'), { once: true });
}

// ─── Physics constants ────────────────────────────────────────────────────────
const MAX_BOUNCE_SPEED  = 1200;
const SPRING_FREQ_HZ    = 4;
const SPRING_DAMP_RATIO = 0.7;
const FLING_THRESHOLD   = 200;
const ANCHOR_BOUNCE     = 0.5;
const HOLD_DAMPING      = 5;

const USE_CHIMES     = true;
const USE_TARGETS    = false;
const USE_BUMPER     = true;
const USE_TRAIL      = true;
const USE_IDLE_RESET = false;
const IDLE_TIMEOUT   = 60;

// ─── Planck.js setup ─────────────────────────────────────────────────────────
const { World, Vec2, Box, Circle, Edge, DistanceJoint } = planck;

export const PPM  = 64;
export const toM  = px => px / PPM;
export const toPx = m  => m  * PPM;

export let diskBody, anchorBody;
let world, barBody, bumperBody;
let springJoint = null;
let wallTop, wallLeft, wallRight;

let nowBarContact    = false;
let nowBumperContact = false;
let preStepSpeed     = 0;

function makeEdgeWall(x1, y1, x2, y2){
  const b = world.createBody({ type: 'static' });
  b.createFixture(Edge(Vec2(toM(x1), toM(y1)), Vec2(toM(x2), toM(y2))), {
    restitution: 0,
    friction:    0,
  });
  return b;
}

function barCentroidM(){
  const cx = canvas.width  / 2;
  const cy = (bar.y1 + bar.y2) / 2 + bar.height / 2;
  return Vec2(toM(cx), toM(cy));
}

function initWorld(){
  const W = canvas.width, H = canvas.height;

  world = World({ gravity: Vec2(0, 0) });

  wallTop   = makeEdgeWall(0, 0, W, 0);
  wallLeft  = makeEdgeWall(0, 0, 0, H);
  wallRight = makeEdgeWall(W, 0, W, H);

  barBody = world.createBody({ type: 'kinematic', position: barCentroidM() });
  barBody.createFixture(Box(toM(W / 2 + 4), toM(bar.height / 2 + 1)), {
    restitution: 0,
    friction:    0,
  });

  bumperBody = world.createBody({
    type:     'kinematic',
    position: Vec2(toM(bumper.x), toM(bumper.y)),
  });
  bumperBody.createFixture(Circle(toM(bumper.r)), {
    restitution: 0,
    friction:    0,
  });

  diskBody = world.createBody({
    type:          'dynamic',
    position:      Vec2(toM(canvas.width / 2), toM(canvas.height / 2)),
    bullet:        true,
    linearDamping: 0,
    fixedRotation: true,
  });
  diskBody.createFixture(Circle(toM(disk.r)), {
    restitution: params.bounce,
    density:     1,
    friction:    0,
  });

  anchorBody = world.createBody({ type: 'static', position: Vec2(0, 0) });

  world.on('begin-contact', handleContact);
}

function handleContact(contact){
  const bA = contact.getFixtureA().getBody();
  const bB = contact.getFixtureB().getBody();
  if(bA !== diskBody && bB !== diskBody) return;
  const other = (bA === diskBody) ? bB : bA;

  const intensity = Math.min(preStepSpeed / MAX_BOUNCE_SPEED, 1);

  if(other === barBody){
    nowBarContact = true;
  } else if(other === bumperBody){
    if(USE_BUMPER){
      notifyBumperHit();
      nowBumperContact = true;
    }
  } else {
    if(intensity > 0){
      if(USE_CHIMES) playChime(Math.max(0.15, intensity), noteFromY());
      else           playKnock(intensity);
    }
  }
}

initWorld();

window.addEventListener('resize', () => {
  const prevPos = diskBody?.getPosition();
  const prevVel = diskBody?.getLinearVelocity();
  springJoint = null;
  initWorld();
  if(prevPos){
    diskBody.setPosition(prevPos);
    diskBody.setLinearVelocity(prevVel);
    diskBody.setAwake(true);
  }
}, { passive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function barFloorY(x){
  if(bar.y2 === undefined) return bar.y;
  return bar.y1 + (bar.y2 - bar.y1) * (x / canvas.width);
}

function noteFromY(){
  const pos = diskBody.getPosition();
  const x = toPx(pos.x), y = toPx(pos.y);
  const R = disk.r, eps = 0.5;
  if(y <= R + eps)                  return 4;
  if(y >= barFloorY(x) - R - eps)   return 0;
  const t = (y - R - eps) / (bar.y - 2*R - 2*eps);
  if(t < 1/3) return 3;
  if(t < 2/3) return 2;
  return 1;
}

function destroySpringJoint(){
  if(springJoint){ world.destroyJoint(springJoint); springJoint = null; }
}

// ─── Spring lifecycle (called from zen1-input.js) ─────────────────────────────

export function grab(x, y){
  clearPause();
  disk.glass = false;
  const ap = Vec2(toM(x), toM(y));
  anchorBody.setPosition(ap);
  springJoint = world.createJoint(DistanceJoint({
    frequencyHz:  SPRING_FREQ_HZ,
    dampingRatio: SPRING_DAMP_RATIO,
    length:       0,
  }, anchorBody, diskBody, ap, diskBody.getPosition()));
  if(USE_TRAIL) pauseTrail();
}

export function release(){
  const vel   = diskBody.getLinearVelocity();
  const speed = Math.hypot(toPx(vel.x), toPx(vel.y));
  const flung = speed > FLING_THRESHOLD;
  if(!flung) diskBody.setLinearVelocity(Vec2(0, 0));
  destroySpringJoint();
  if(USE_TRAIL && flung) resetTrail();
}

export function moveAnchor(x, y){
  if(springJoint) anchorBody.setPosition(Vec2(toM(x), toM(y)));
}

function updateBarBody(){
  const target = barCentroidM();
  const angle  = Math.atan2(bar.y2 - bar.y1, canvas.width);
  barBody.setPosition(target);
  barBody.setAngle(angle);
  barBody.setLinearVelocity(Vec2(0, 0));
}

function updateBumperBody(){
  if(!USE_BUMPER || !bumper.active) return;
  bumperBody.setPosition(Vec2(toM(bumper.x), toM(bumper.y)));
  bumperBody.setLinearVelocity(Vec2(0, 0));
}

// ─── State between frames ─────────────────────────────────────────────────────
let wasBarContact    = false;
let wasBumperContact = false;
let idleTime         = 0;

// ─── Main update ─────────────────────────────────────────────────────────────
export function update(dt){
  // 1. Bar velocity bookkeeping (for sound intensity).
  const diskPos   = diskBody.getPosition();
  const diskX     = toPx(diskPos.x);
  const floorNow  = barFloorY(diskX);
  const floorPrev = (bar.prevY1 ?? bar.y1) +
                    ((bar.prevY2 ?? bar.y2) - (bar.prevY1 ?? bar.y1)) * (diskX / canvas.width);
  bar.vy = (floorNow - floorPrev) / dt;
  const barMoved = bar.y1 !== bar.prevY1 || bar.y2 !== bar.prevY2;
  bar.prevY1 = bar.y1;
  bar.prevY2 = bar.y2;

  // 2. Per-frame restitution and damping.
  const held = springJoint !== null;
  diskBody.getFixtureList().setRestitution(held ? ANCHOR_BOUNCE : params.bounce);
  diskBody.setLinearDamping(held ? HOLD_DAMPING : params.friction * params.frameMultiplier);

  // 3. Move kinematic bodies.
  updateBarBody();
  updateBumperBody();

  // 4. Cache pre-step speed for sound intensity (handleContact reads this).
  const vel = diskBody.getLinearVelocity();
  preStepSpeed     = Math.hypot(toPx(vel.x), toPx(vel.y));
  nowBarContact    = false;
  nowBumperContact = false;

  // 5. Physics step.
  world.step(dt, 8, 3);

  // 6. Rising-edge sounds for bar and bumper.
  if(nowBarContact && !wasBarContact){
    const diskVy   = toPx(diskBody.getLinearVelocity().y);
    const approach  = Math.max(Math.abs(diskVy), Math.abs(bar.vy));
    const intensity = Math.max(0.15, Math.min(approach / MAX_BOUNCE_SPEED, 1));
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else           playKnock(intensity);
  }
  if(nowBumperContact && !wasBumperContact){
    const intensity = Math.max(0.15, Math.min(preStepSpeed / MAX_BOUNCE_SPEED, 1));
    playKnock(intensity);
  }
  wasBarContact    = nowBarContact;
  wasBumperContact = nowBumperContact;

  // 7. Bumper / targets / trail / idle.
  const bumperEvents = USE_BUMPER
    ? tickBumper()
    : { firstHit: false, placed: false, removed: false, removedAfterHit: false };

  if(USE_TARGETS) tickTargets(dt);

  if(USE_TRAIL){
    if(barMoved || bumperEvents.firstHit || bumperEvents.removedAfterHit) resetTrail();
    if(!held) tickTrail();
  }

  if(USE_IDLE_RESET){
    const userInteracting = held || bar.dragging || bumperEvents.placed || bumperEvents.removed;
    if(userInteracting) idleTime = 0;
    else idleTime += dt;
    if(idleTime >= IDLE_TIMEOUT){
      diskBody.setLinearVelocity(Vec2(0, 0));
      idleTime = 0;
    }
  }
}
