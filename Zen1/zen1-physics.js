import { canvas, params, renderExtras } from '../state.js';
import { disk, bar } from '../playfield.js';
import { playKnock, playChime, playChimeFreq } from '../sound.js';
import { tickTargets } from './zen1-targets.js';
import { tickBumper, bumpers, notifyBumperHit, setOnBumperGrabbed, MIN_RADIUS_FRAC, MAX_RADIUS_FRAC } from './zen1-bumper.js';
import { tickTrail, pauseTrail, resetTrail, cycleTrailColor, getTrailColorMode, notifyContact, addContactPoint } from './zen1-trail.js';
import { initPause, clearPause } from './zen1-pause.js';
import { setBarDownSound, snapAngle } from './zen1-bar.js';

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

// ─── Moon mode ────────────────────────────────────────────────────────────────
// Each row: [baseFreq, freq1, freq2, freq3]
// baseFreq → bar; freq1/2/3 cycle across wallLeft,wallTop,wallRight,bumper1,bumper2,bumper3,wallBottom
// Format: [baseFreq, freq1, freq2, freq3, repeat]
// repeat: how many bar-hits this row stays active (equivalent to duplicating the row that many times)
const MOON_TABLE_RAW = [
  [69.30, 207.65, 277.18, 329.63, 4], // m1
  [123.47, 207.65, 277.18,329.63, 4], // m2
  [55.00, 220.00, 277.18, 329.63, 2], // m3
  [46.25, 220.00, 293.66, 369.99, 2], // m4
  [51.91, 207.65, 261.63, 369.99, 2], // m5
  [51.91, 207.65, 277.18, 329.63, 2], // m6
  [51.91, 207.65, 277.18, 311.13, 2], // m7
  [51.91, 185.00, 261.63, 311.13, 2], // m8
  [69.30, 164.81, 207.65, 277.18, 4], // m9
  [69.30, 207.65, 277.18, 329.63, 4], // m10
  [65.41, 207.65, 311.13, 369.99, 4], // m11
  [69.30, 207.65, 277.18, 329.63, 2], // m12
  [46.25, 220.00, 277.18, 369.99, 2], // m13
  [61.74, 207.65, 246.94, 329.63, 2], // m14
  [61.74, 220.00, 246.94, 311.13, 2], // m15
  [82.41, 207.65, 246.94, 329.63, 4], // m16
  [82.41, 196.00, 246.94, 329.63, 4], // m17
  [73.42, 196.00, 246.94, 349.23, 4], // m18
  [65.41, 196.00, 261.63, 329.63, 2], // m19
  [61.74, 196.00, 246.94, 329.63, 2], // m20
  [58.27, 196.00, 277.18, 329.63, 2], // m21
  [58.27, 185.00, 277.18, 329.63, 2], // m22
  [61.74, 185.00, 246.94, 293.66, 2], // m23
  [82.41, 196.00, 246.94, 277.18, 2], // m24
  [98.00, 329.63, 246.94, 277.18, 2], // m25
  [92.50, 369.99, 246.94, 293.66, 1], // m26
  [92.50, 185.00, 246.94, 293.66, 1], // m27
  [46.25, 185.00, 233.08, 277.18, 2], // m28
  [61.74, 146.83, 185.00, 246.94, 4], // m29
  [61.74, 1, 1, 1, 4], // m30? 0
  //[69.30, 1, 1, 1, 4], // m30? 0

  /*
  // Memo to Claude: don't erase this commented-out table!
  [69.30, 207.65, 277.18, 329.63, 4], // m1
  [123.47, 207.65, 277.18,329.63, 4], // m2
  [55.00, 220.00, 277.18, 329.63, 2], // m3
  [46.25, 220.00, 293.66, 369.99, 2], // m4
  [51.91, 207.65, 261.63, 369.99, 1], // m5
  [51.91, 207.65, 277.18, 329.63, 1], // m6
  [51.91, 207.65, 277.18, 311.13, 1], // m7
  [51.91, 185.00, 261.63, 311.13, 1], // m8
  [69.30, 164.81, 207.65, 277.18, 2], // m9
  [69.30, 207.65, 277.18, 329.63, 2], // m10
  [65.41, 207.65, 311.13, 369.99, 4], // m11
  [69.30, 207.65, 277.18, 329.63, 2], // m12
  [46.25, 220.00, 277.18, 369.99, 2], // m13
  [61.74, 207.65, 246.94, 329.63, 2], // m14
  [61.74, 220.00, 246.94, 311.13, 2], // m15
  [82.41, 207.65, 246.94, 329.63, 4], // m16
  [82.41, 196.00, 246.94, 329.63, 4], // m17
  [73.42, 196.00, 246.94, 349.23, 4], // m18
  [65.41, 196.00, 261.63, 329.63, 1], // m19
  [61.74, 196.00, 246.94, 329.63, 1], // m20
  [58.27, 196.00, 277.18, 329.63, 1], // m21
  [58.27, 185.00, 277.18, 329.63, 1], // m22
  [61.74, 185.00, 246.94, 293.66, 2], // m23
  [82.41, 196.00, 246.94, 277.18, 1], // m24
  [98.00, 329.63, 246.94, 277.18, 1], // m25
  [92.50, 369.99, 246.94, 293.66, 1], // m26
  [92.50, 185.00, 246.94, 293.66, 1], // m27
  [46.25, 185.00, 233.08, 277.18, 2], // m28
  [61.74, 146.83, 185.00, 246.94, 8], // m29
*/  
];
const MOON_TABLE = MOON_TABLE_RAW.flatMap(
  ([b, f1, f2, f3, repeat]) => Array.from({ length: repeat }, () => [b, f1, f2, f3])
);
const MOON_BASE_DECAY        = 4.0;  // seconds
const MOON_OCTAVE_SHIFT      = 1;    // octaves above base for the doubled note
const MOON_BASE_INTENSITY    = 0.15;  // intensity multiplier for the base note
const MOON_OCTAVE_INTENSITY  = 0.35;  // intensity multiplier for the octave-shifted note
const MOON_BUMPER_INTENSITY  = 0.50;  // intensity multiplier for bumper notes in mode 1

let moonMode     = 0;  // 0 = off, 1 = surface-mapped
let moonRowIndex = 0;

function moonFreqForSurface(surface){
  const row = MOON_TABLE[moonRowIndex];
  switch(surface){
    case 'wallLeft':   return row[1];
    case 'wallTop':    return row[2];
    case 'wallRight':  return row[3];
    case 'bumper1':    return row[1] / 2;  // one octave down
    case 'bumper2':    return row[2] / 2;
    case 'bumper3':    return row[3] / 2;
    case 'wallBottom': return row[0] * 2;  // base note, one octave up
    default:           return null;
  }
}

function updateButtonLabels(){
  if(colorBtn) colorBtn.textContent = `◐ Color ${getTrailColorMode()}`;
  if(moonBtn)  moonBtn.textContent  = `☽ Moon ${moonMode}`;
}

const moonBtn = document.getElementById('moonBtn');
moonBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
moonBtn?.addEventListener('click', () => {
  moonMode = (moonMode + 1) % 2;
  moonRowIndex = 0;
  updateButtonLabels();
});
colorBtn?.addEventListener('click', () => { cycleTrailColor(); updateButtonLabels(); });
updateButtonLabels();

function randomizeBumpers(){
  const shortSide = Math.min(canvas.width, canvas.height);
  const minR = shortSide * MIN_RADIUS_FRAC;
  const maxR = shortSide * MAX_RADIUS_FRAC;
  const MIN_WALL_CLEAR = 3 * disk.r;
  const MIN_BUMPER_GAP = 3 * disk.r;

  const dp = diskBody.getPosition();
  const diskX = toPx(dp.x), diskY = toPx(dp.y);

  const MAX_ATTEMPTS = 10000;
  for(let attempt = 0; attempt < MAX_ATTEMPTS; attempt++){
    const candidates = bumpers.map(() => {
      const r = minR + Math.random() * (maxR - minR);
      const x = r + Math.random() * (canvas.width  - 2 * r);
      const y = r + Math.random() * (canvas.height - 2 * r);
      return { r, x, y };
    });

    // Each bumper edge is at least MIN_WALL_CLEAR from at least one of left/right walls
    const wallOk = candidates.every(b =>
      Math.max(b.x - b.r, canvas.width - (b.x + b.r)) >= MIN_WALL_CLEAR
    );
    if(!wallOk) continue;

    // Edge-to-edge gap between every bumper pair >= MIN_BUMPER_GAP
    let pairOk = true;
    for(let i = 0; i < candidates.length && pairOk; i++)
      for(let j = i + 1; j < candidates.length && pairOk; j++){
        const c1 = candidates[i], c2 = candidates[j];
        if(Math.hypot(c1.x - c2.x, c1.y - c2.y) - c1.r - c2.r < MIN_BUMPER_GAP) pairOk = false;
      }
    if(!pairOk) continue;

    // No bumper intersects the disk
    const diskOk = candidates.every(b =>
      Math.hypot(b.x - diskX, b.y - diskY) >= b.r + disk.r
    );
    if(!diskOk) continue;

    candidates.forEach((c, i) => { bumpers[i].x = c.x; bumpers[i].y = c.y; bumpers[i].r = c.r; });
    resetTrail();
    return;
  }
}

function barVisibleArea(y1, y2){
  const h = bar.height, H = canvas.height, W = canvas.width;
  const slope = y2 - y1;

  // x values where the top or bottom edge crosses y=0 or y=H
  const xs = [0, W];
  if(slope !== 0){
    const add = x => { if(x > 0 && x < W) xs.push(x); };
    add(-y1 * W / slope);            // top edge crosses y=0
    add((H - y1) * W / slope);       // top edge crosses y=H
    add((-y1 - h) * W / slope);      // bottom edge crosses y=0
    add((H - y1 - h) * W / slope);   // bottom edge crosses y=H
  }
  xs.sort((a, b) => a - b);

  // visH is piecewise-linear between these breakpoints — trapezoid rule is exact per segment
  const visH = x => {
    const top = y1 + slope * x / W;
    return Math.max(0, Math.min(top + h, H) - Math.max(top, 0));
  };
  let area = 0;
  for(let i = 0; i < xs.length - 1; i++)
    area += (xs[i + 1] - xs[i]) * (visH(xs[i]) + visH(xs[i + 1])) / 2;
  return area;
}

function randomizeBar(){
  const dp    = diskBody.getPosition();
  const diskX = toPx(dp.x), diskY = toPx(dp.y);

  const MAX_ATTEMPTS = 10000;
  for(let attempt = 0; attempt < MAX_ATTEMPTS; attempt++){
    // Pick a random raw angle in [-PI/3, PI/3] and snap to the nearest valid 360/N angle.
    const rawAngle = (Math.random() * 2 - 1) * Math.PI / 3;
    const angle    = snapAngle(rawAngle);
    const dy       = canvas.width * Math.tan(angle);  // y2 - y1

    // Pick a random midpoint y — wide range, visibility checked below.
    const absDy = Math.abs(dy);
    const yMin  = -absDy / 2 - bar.height;
    const yMax  = canvas.height + absDy / 2;
    const yMid  = yMin + Math.random() * (yMax - yMin);

    const y1 = yMid - dy / 2;
    const y2 = yMid + dy / 2;

    // At least half the bar's area must be visible on screen (exact analytical check).
    if(barVisibleArea(y1, y2) < 0.5 * canvas.width * bar.height) continue;

    // Bar top at the disk's x must be below the disk's bottom edge.
    const barTopAtDisk = y1 + (y2 - y1) * (diskX / canvas.width);
    if(barTopAtDisk < diskY + disk.r) continue;

    bar.y1 = y1;
    bar.y2 = y2;
    bar.y  = Math.min(y1, y2);
    bar.prevY1 = null;
    bar.prevY2 = null;
    return;
  }
}

document.getElementById('randomBtn')?.addEventListener('pointerdown', (e) => e.stopPropagation());
document.getElementById('randomBtn')?.addEventListener('click', () => {
  randomizeBumpers();
  randomizeBar();
});
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
  const hideHint = () => uiHint.classList.add('hidden');
  canvas.addEventListener('pointerdown', hideHint, { once: true });
  document.getElementById('speedUp')?.addEventListener('click', hideHint, { once: true });
}

// ─── Physics constants ────────────────────────────────────────────────────────
const MAX_BOUNCE_SPEED   = 1200;
const SPRING_FREQ_HZ     = 4;
const SPRING_DAMP_RATIO  = 0.7;
const FLING_THRESHOLD    = 0; //200;
const ANCHOR_BOUNCE      = 0.5;
const HOLD_DAMPING       = 5;
const WALL_SEPARATION_PX = 1;  // px gap injected when ball rests against a wall with zero normal velocity

const USE_CHIMES     = true;
const USE_TARGETS    = false;
const USE_BUMPER     = true;
const USE_TRAIL      = true;
const USE_IDLE_RESET = false;
const IDLE_TIMEOUT   = 60;

// ─── Planck.js setup ─────────────────────────────────────────────────────────
const { World, Vec2, Box, Circle, Edge, Polygon, DistanceJoint, Settings } = planck;
Settings.velocityThreshold = 0;

export const PPM  = 64;
export const toM  = px => px / PPM;
export const toPx = m  => m  * PPM;

export let diskBody, anchorBody;
let world, barBody, bumperBodies = [], bumperFixtures = [], bumperPrevR = [];
let barFixture = null;
let springJoint = null;
let wallTop, wallLeft, wallRight, wallBottom;

let nowBarContact     = false;
let nowBumperContact  = bumpers.map(() => false);
let preStepSpeed      = 0;
let diskHeld          = false;  // set each frame before world.step so handleContact can read it

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

  bumperFixtures = [];
  bumperPrevR    = [];
  bumperBodies = bumpers.map(b => {
    const body    = world.createBody({ type: 'kinematic', position: Vec2(toM(b.x), toM(b.y)) });
    const fixture = body.createFixture(Circle(toM(b.r)), { restitution: 0, friction: 0 });
    bumperFixtures.push(fixture);
    bumperPrevR.push(b.r);
    return body;
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
  } else if(USE_BUMPER && (bumperBodies.indexOf(other) >= 0)){
    const bi = bumperBodies.indexOf(other);
    notifyBumperHit(bi);
    nowBumperContact[bi] = true;
    surface = 'bumper' + (bi + 1);
  } else {
    surface = other === wallTop ? 'wallTop' : other === wallLeft ? 'wallLeft' : other === wallRight ? 'wallRight' : 'wallBottom';
    if(intensity > 0){
      if(USE_CHIMES) playSurface(surface, Math.max(0.15, intensity));
      else           playKnock(intensity);
    }
  }
  if(USE_TRAIL && surface && !diskHeld){
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
// Octave 0 = C4..B4 (261.63..493.88 Hz). Octave boundary is at "do" (C).
// Append '#' for a sharp, e.g. getnote('sol#').
//   do=C  re=D  mi=E  fa=F  sol=G  la=A  si=B
const NOTE_SEMITONES = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
const C4_HZ = 261.63;
const TRANSPOSE = 0;  // semitones — positive = up, negative = down
function getnote(name, octave = 0){
  const sharp = name.endsWith('#');
  const base  = sharp ? name.slice(0, -1) : name;
  const semi  = NOTE_SEMITONES[base] + (sharp ? 1 : 0) + octave * 12;
  return { freq: C4_HZ * Math.pow(2, semi / 12), semi };
}
function transposedFreq(entry){
  return C4_HZ * Math.pow(2, (entry.semi + TRANSPOSE) / 12);
}

// Sound table — one entry per surface.
// Chime entries: { type: 'chime', ...getnote('name', octave) }
// Knock entries: { type: 'knock' }
const SURFACE_SOUND = {
  /*
    wallLeft:   { type: 'chime', ...getnote('mi',  0)  },
    bar:        { type: 'chime', ...getnote('do',  0)  },
    wallTop:    { type: 'chime', ...getnote('sol', 0)  },
    wallRight:  { type: 'chime', ...getnote('do', +1)  },
    wallBottom: { type: 'chime', ...getnote('do', -1)  },
    bumper1:    { type: 'chime', ...getnote('re', 0)  },  // red
    bumper2:    { type: 'chime', ...getnote('fa' , 0)  },  // blue
    bumper3:    { type: 'chime', ...getnote('la',  0)  },  // green
*/
//    bar:        { type: 'knock'  },
    bar:        { type: 'chime', ...getnote('re',  -1)  },

    wallLeft:   { type: 'chime', ...getnote('re',  0)  },
    wallTop:    { type: 'chime', ...getnote('fa', 0)  },
    wallRight:  { type: 'chime', ...getnote('si',  0)  },
    bumper1:    { type: 'chime', ...getnote('la', -1)  },  // red
    bumper2:    { type: 'chime', ...getnote('sol' , 0)  },  // blue
    bumper3:    { type: 'chime', ...getnote('la',  0)  },  // green

    wallBottom: { type: 'chime', ...getnote('do', -1)  },

//  bumper1:    { type: 'chime', ...getnote('re#', 0)  },  // red
  //bumper2:    { type: 'chime', ...getnote('la' , 0)  },  // blue
  //bumper3:    { type: 'chime', ...getnote('si',  0)  },  // green
};

function playSurface(surface, intensity){
  if(surface !== 'bar'){
    if(moonMode === 1){
      const freq = moonFreqForSurface(surface);
      if(freq){
        const vol      = surface.startsWith('bumper') ? intensity * MOON_BUMPER_INTENSITY : intensity;
        const duration = surface === 'wallBottom' ? MOON_BASE_DECAY / 2 : 0.4;
        playChimeFreq(vol, freq, duration);
      }
      return;
    }

  }
  const s = SURFACE_SOUND[surface];
  if(!s) return;
  if(s.type === 'knock') playKnock(intensity);
  else                   playChimeFreq(intensity, transposedFreq(s));
}

setOnBumperGrabbed((i) => playSurface('bumper' + (i + 1), 0.4));
setBarDownSound(() => playSurface('bar', 0.4));

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

function updateBumperBodies(){
  if(!USE_BUMPER) return;
  bumpers.forEach((b, i) => {
    bumperBodies[i].setPosition(Vec2(toM(b.x), toM(b.y)));
    bumperBodies[i].setLinearVelocity(Vec2(0, 0));
    if(b.r !== bumperPrevR[i]){
      bumperBodies[i].destroyFixture(bumperFixtures[i]);
      bumperFixtures[i] = bumperBodies[i].createFixture(
        Circle(toM(b.r)), { restitution: 0, friction: 0 }
      );
      bumperPrevR[i] = b.r;
    }
  });
}

// ─── State between frames ─────────────────────────────────────────────────────
let wasBarContact    = false;
let wasBumperContact = bumpers.map(() => false);
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

  // 3. Rebuild bar fixture if the bar moved; always sync bumpers.
  if(barMoved) updateBarBody();
  updateBumperBodies();

  // 4. Cache pre-step state for handleContact (fires during world.step).
  const vel = diskBody.getLinearVelocity();
  preStepSpeed = Math.hypot(toPx(vel.x), toPx(vel.y));
  diskHeld = held;
  nowBarContact = false;
  nowBumperContact.fill(false);

  // 5. Physics step.
  world.step(dt, 8, 3);

  // 5b. Break resting wall contacts by repositioning 1 px away from the wall
  // when the ball is touching it with zero normal velocity. This prevents Box2D
  // from treating it as a resting constraint that absorbs simultaneous contacts.
  {
    const p   = diskBody.getPosition();
    const r   = toM(disk.r);
    const W   = toM(canvas.width), H = toM(canvas.height);
    const v   = diskBody.getLinearVelocity();
    const gap   = toM(WALL_SEPARATION_PX);
    const touch = toM(4);   // within 4 px of wall counts as touching
    const vEps  = toM(0.1); // below 0.1 px/s normal velocity counts as resting
    let x = p.x, y = p.y;
    if(!diskHeld){
      if(p.x - r < touch       && Math.abs(v.x) < vEps) x = r + gap;
      if(p.x + r > W - touch   && Math.abs(v.x) < vEps) x = W - r - gap;
      if(p.y - r < touch       && Math.abs(v.y) < vEps) y = r + gap;
      if(p.y + r > H - touch   && Math.abs(v.y) < vEps) y = H - r - gap;
    }
    if(x !== p.x || y !== p.y) diskBody.setPosition(Vec2(x, y));
  }

  // 6. Rising-edge sounds for bar and bumper.
  if(nowBarContact && !wasBarContact){
    const diskVy   = toPx(diskBody.getLinearVelocity().y);
    const approach  = Math.max(Math.abs(diskVy), Math.abs(bar.vy));
    const intensity = Math.max(0.15, Math.min(approach / MAX_BOUNCE_SPEED, 1));
    if(moonMode){
      moonRowIndex = (moonRowIndex + 1) % MOON_TABLE.length;
      const baseFreq = MOON_TABLE[moonRowIndex][0];
      playChimeFreq(intensity * MOON_BASE_INTENSITY, baseFreq, MOON_BASE_DECAY);
      playChimeFreq(intensity * MOON_OCTAVE_INTENSITY, baseFreq * Math.pow(2, MOON_OCTAVE_SHIFT), MOON_BASE_DECAY);
    } else if(USE_CHIMES){
      playSurface('bar', intensity);
    } else {
      playKnock(intensity);
    }
  }
  bumpers.forEach((b, i) => {
    if(nowBumperContact[i] && !wasBumperContact[i]){
      const intensity = Math.max(0.15, Math.min(preStepSpeed / MAX_BOUNCE_SPEED, 1));
      if(USE_CHIMES) playSurface('bumper' + (i + 1), intensity);
      else           playKnock(intensity);
    }
    wasBumperContact[i] = nowBumperContact[i];
  });
  wasBarContact = nowBarContact;

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
