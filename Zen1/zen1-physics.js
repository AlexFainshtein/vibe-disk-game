import { canvas, params, renderExtras } from '../state.js';
import { disk, bar } from '../playfield.js';
import { playKnock, playChime, playChimeFreq } from '../sound.js';
import { tickTargets } from './zen1-targets.js';
import { tickBumper, bumper, notifyBumperHit } from './zen1-bumper.js';
import { tickTrail, pauseTrail, resetTrail, cycleTrailColor, notifyContact, addContactPoint } from './zen1-trail.js';
import { initPause, clearPause } from './zen1-pause.js';
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

const colorBtn = document.getElementById('colorBtn');
colorBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
colorBtn?.addEventListener('click', cycleTrailColor);
document.getElementById('resetDisk')?.addEventListener('click', () => {
  diskBody.setPosition(Vec2(toM(canvas.width / 2), toM(canvas.height / 2)));
  diskBody.setLinearVelocity(Vec2(0, 0));
  diskBody.setAwake(true);
  if(springJoint) destroySpringJoint();
});

const INITIAL_SPEED_PX = 300;  // px/s given to a static disk on ± press
const SPEED_FACTOR     = 1.2;
const ANGLE_RAD        = 37 * Math.PI / 180;

function adjustSpeed(factor){
  const vel = diskBody.getLinearVelocity();
  const spd = Math.hypot(vel.x, vel.y);
  if(spd < 0.01){
    const initSpd = toM(INITIAL_SPEED_PX) * factor;
    diskBody.setLinearVelocity(Vec2(
      initSpd * Math.cos(ANGLE_RAD),
      initSpd * Math.sin(ANGLE_RAD),
    ));
  } else {
    diskBody.setLinearVelocity(Vec2(vel.x * factor, vel.y * factor));
  }
  diskBody.setAwake(true);
}

document.getElementById('speedUp')?.addEventListener('pointerdown', (e) => e.stopPropagation());
document.getElementById('speedUp')?.addEventListener('click', () => adjustSpeed(SPEED_FACTOR));
document.getElementById('speedDown')?.addEventListener('pointerdown', (e) => e.stopPropagation());
document.getElementById('speedDown')?.addEventListener('click', () => adjustSpeed(1 / SPEED_FACTOR));

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
const { World, Vec2, Box, Circle, Edge, Polygon, DistanceJoint } = planck;

export const PPM  = 64;
export const toM  = px => px / PPM;
export const toPx = m  => m  * PPM;

export let diskBody, anchorBody;
let world, barBody, bumperBody;
let barFixture = null;
let springJoint = null;
let wallTop, wallLeft, wallRight, wallBottom;

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


function initWorld(){
  const W = canvas.width, H = canvas.height;

  world = World({ gravity: Vec2(0, 0) });

  wallTop    = makeEdgeWall(0, 0, W, 0);
  wallLeft   = makeEdgeWall(0, 0, 0, H);
  wallRight  = makeEdgeWall(W, 0, W, H);
  wallBottom = makeEdgeWall(0, H, W, H);

  // Bar: static body at origin — fixture is a polygon matching the visual trapezoid
  // exactly. Rebuilt via updateBarBody() whenever y1/y2 change.
  barBody = world.createBody({ type: 'static', position: Vec2(0, 0) });
  barFixture = null;

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

  updateBarBody();  // build initial bar fixture
}

function handleContact(contact){
  const bA = contact.getFixtureA().getBody();
  const bB = contact.getFixtureB().getBody();
  if(bA !== diskBody && bB !== diskBody) return;
  const other = (bA === diskBody) ? bB : bA;

  const intensity = Math.min(preStepSpeed / MAX_BOUNCE_SPEED, 1);

  let surface = null;
  if(other === barBody){
    nowBarContact = true;
    surface = 'bar';
  } else if(other === bumperBody){
    if(USE_BUMPER){
      notifyBumperHit();
      nowBumperContact = true;
      surface = 'bumper';
    }
  } else {
    surface = other === wallTop ? 'wallTop' : other === wallLeft ? 'wallLeft' : other === wallRight ? 'wallRight' : 'wallBottom';
    if(intensity > 0){
      if(USE_CHIMES) playSurface(surface, Math.max(0.15, intensity));
      else           playKnock(intensity);
    }
  }
  if(USE_TRAIL && surface){
    notifyContact(surface);
    const p = diskBody.getPosition();
    addContactPoint(toPx(p.x), toPx(p.y));
  }
}

initWorld();
initPause(diskBody, Vec2);

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

// getnote(name, octave=0) — converts solfège name to a frequency (Hz).
// Reference: A3 = 220 Hz. Octave shifts by that many octaves.
// Append '#' for a sharp, e.g. getnote('sol#').
//   la=A  si=B  do=C  re=D  mi=E  fa=F  sol=G   (semitones above A3)
const NOTE_SEMITONES = { la: 0, si: 2, do: 3, re: 5, mi: 7, fa: 8, sol: 10 };
function getnote(name, octave = 0){
  const sharp = name.endsWith('#');
  const base  = sharp ? name.slice(0, -1) : name;
  const semi  = NOTE_SEMITONES[base] + (sharp ? 1 : 0) + octave * 12;
  return { freq: 220 * Math.pow(2, semi / 12) };
}

// Sound table — one entry per surface.
// Chime entries: { type: 'chime', ...getnote('name', octave) }
// Knock entries: { type: 'knock' }
const SURFACE_SOUND = {
  bar:        { type: 'chime', ...getnote('do')      },
  wallLeft:   { type: 'chime', ...getnote('mi')      },
  wallTop:    { type: 'chime', ...getnote('sol')     },
  wallRight:  { type: 'chime', ...getnote('do', +1)  },
  wallBottom: { type: 'chime', ...getnote('do', -1)  },
  bumper:     { type: 'chime', ...getnote('la', +1)  },
//  bumper:     { type: 'knock'                        },
};

function playSurface(surface, intensity){
  const s = SURFACE_SOUND[surface];
  if(!s) return;
  if(s.type === 'knock') playKnock(intensity);
  else                   playChimeFreq(intensity, s.freq);
}

function destroySpringJoint(){
  if(springJoint){ world.destroyJoint(springJoint); springJoint = null; }
}

// ─── Spring lifecycle (called from zen1-input.js) ─────────────────────────────

export function grab(x, y){
  clearPause();
  disk.glass = false;
  diskBody.setAwake(true);
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
  // Rebuild the polygon fixture to exactly match the visual trapezoid.
  // Extend 10 px past each wall along the same slope so the tilt matches exactly.
  if(barFixture) barBody.destroyFixture(barFixture);
  const W  = canvas.width;
  const s  = (bar.y2 - bar.y1) / W;  // slope px/px — same as visual
  const mg = 10;                       // margin px past each wall
  const tl = toM(bar.y1           - s * mg);
  const tr = toM(bar.y2           + s * mg);
  const bl = toM(bar.y1 + bar.height - s * mg);
  const br = toM(bar.y2 + bar.height + s * mg);
  const l  = toM(-mg), r = toM(W + mg);
  barFixture = barBody.createFixture(
    Polygon([ Vec2(l, tl), Vec2(r, tr), Vec2(r, br), Vec2(l, bl) ]),
    { restitution: 0, friction: 0 }
  );
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

  // 3. Rebuild bar fixture if the bar moved; always sync bumper.
  if(barMoved) updateBarBody();
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
    if(USE_CHIMES) playSurface('bar', intensity);
    else           playKnock(intensity);
  }
  if(nowBumperContact && !wasBumperContact){
    const intensity = Math.max(0.15, Math.min(preStepSpeed / MAX_BOUNCE_SPEED, 1));
    if(USE_CHIMES) playSurface('bumper', intensity);
    else           playKnock(intensity);
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
