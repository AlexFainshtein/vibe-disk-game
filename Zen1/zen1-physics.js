import { canvas, params, renderExtras } from '../state.js';
import { disk, bar, anchor } from '../playfield.js';
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

// ─── Physics constants ────────────────────────────────────────────────────────
const MAX_BOUNCE_SPEED  = 1200;  // px/s — caps sound intensity normalisation
const SPRING_FREQ_HZ    = 4;     // DistanceJoint spring frequency (higher = stiffer)
const SPRING_DAMP_RATIO = 0.7;   // DistanceJoint damping ratio (0 = oscillates, 1 = critical)
const FLING_THRESHOLD   = 200;   // px/s — below this, release freezes disk
const ANCHOR_BOUNCE     = 0.5;   // restitution while spring is active (softer)

const USE_CHIMES     = true;
const USE_TARGETS    = false;
const USE_BUMPER     = true;
const USE_TRAIL      = true;
const USE_IDLE_RESET = false;
const IDLE_TIMEOUT   = 60;

// ─── Planck.js setup ─────────────────────────────────────────────────────────
// planck is loaded as a UMD global via the <script> tag in zen1.html.
const { World, Vec2, Box, Circle, Edge, DistanceJoint } = planck;

// Unit conversion: Planck/Box2D works in metres; the game works in pixels.
const PPM    = 64;                  // pixels per metre
const toM    = px => px / PPM;
const toPx   = m  => m  * PPM;

let world, diskBody, barBody, bumperBody, anchorBody;
let springJoint = null;
let wallTop, wallLeft, wallRight;

// Contact flags set inside the begin-contact listener (which fires during world.step).
// preStepSpeed is written just before world.step so the listener can use it.
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

  // Walls: four infinitely-thin edge bodies.  No tunneling risk regardless of speed.
  wallTop   = makeEdgeWall(0, 0, W, 0);
  wallLeft  = makeEdgeWall(0, 0, 0, H);
  wallRight = makeEdgeWall(W, 0, W, H);
  // Bottom "wall" is the bar — see barBody below.

  // Bar: kinematic box.  Width is padded so the disk can never escape around the ends.
  barBody = world.createBody({ type: 'kinematic', position: barCentroidM() });
  barBody.createFixture(Box(toM(W / 2 + 4), toM(bar.height / 2 + 1)), {
    restitution: 0,
    friction:    0,
  });

  // Bumper: kinematic circle (active flag checked each frame).
  bumperBody = world.createBody({
    type:     'kinematic',
    position: Vec2(toM(bumper.x), toM(bumper.y)),
  });
  bumperBody.createFixture(Circle(toM(bumper.r)), {
    restitution: 0,
    friction:    0,
  });

  // Disk: dynamic bullet circle (CCD enabled).
  diskBody = world.createBody({
    type:           'dynamic',
    position:       Vec2(toM(disk.x), toM(disk.y)),
    bullet:         true,     // CCD — no tunneling at high speeds
    linearDamping:  0,        // friction applied manually each frame
    fixedRotation:  true,     // disk never visually rotates
  });
  diskBody.createFixture(Circle(toM(disk.r)), {
    restitution: params.bounce,
    density:     1,
    friction:    0,
  });

  // Ghost body for the spring anchor — no fixture, just a joint endpoint.
  anchorBody = world.createBody({ type: 'static', position: Vec2(0, 0) });

  // Collision sound listener.
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
    // Wall hit — play sound immediately (walls don't need rising-edge debounce).
    if(intensity > 0){
      if(USE_CHIMES) playChime(Math.max(0.15, intensity), noteFromY());
      else           playKnock(intensity);
    }
  }
}

// Initialise the world once at module load.
// zen1-bar.js (imported above) sets bar.y1 / bar.y2 synchronously, so the
// bar geometry is ready by the time initWorld() runs.
initWorld();

// Re-create the world on resize (edge shapes cannot be repositioned after creation).
window.addEventListener('resize', () => {
  springJoint = null;  // joint belongs to the old world — just forget it
  initWorld();
  syncDiskToBody();
}, { passive: true });

// ─── Helpers used by update() ─────────────────────────────────────────────────

function barFloorY(x){
  if(bar.y2 === undefined) return bar.y;
  return bar.y1 + (bar.y2 - bar.y1) * (x / canvas.width);
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

// Push the game's authoritative disk state into the Planck body.
// Called at the start of each update() to pick up external changes
// (pause restore, reverse, reset, fling-freeze).
function syncDiskToBody(){
  diskBody.setPosition(Vec2(toM(disk.x), toM(disk.y)));
  diskBody.setLinearVelocity(Vec2(toM(disk.vx), toM(disk.vy)));
  diskBody.setAwake(true);
}


function createSpringJoint(){
  const ap = Vec2(toM(anchor.x), toM(anchor.y));
  anchorBody.setPosition(ap);
  springJoint = world.createJoint(DistanceJoint({
    frequencyHz:  SPRING_FREQ_HZ,
    dampingRatio: SPRING_DAMP_RATIO,
    length:       0,
  }, anchorBody, diskBody, ap, diskBody.getPosition()));
}

function destroySpringJoint(){
  if(springJoint){ world.destroyJoint(springJoint); springJoint = null; }
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
  // Teleport only — bumper is a static obstacle, not a launcher.
  // Giving it a velocity caused the solver to inject huge energy when dragged fast.
  bumperBody.setPosition(Vec2(toM(bumper.x), toM(bumper.y)));
  bumperBody.setLinearVelocity(Vec2(0, 0));
}

function readBackDisk(){
  const pos = diskBody.getPosition();
  const vel = diskBody.getLinearVelocity();
  disk.x  = toPx(pos.x);
  disk.y  = toPx(pos.y);
  disk.vx = toPx(vel.x);
  disk.vy = toPx(vel.y);
}

// ─── State between frames ─────────────────────────────────────────────────────
let wasAnchorActive  = false;
let wasBarContact    = false;
let wasBumperContact = false;
let idleTime         = 0;

// ─── Main update ─────────────────────────────────────────────────────────────
export function update(dt){
  // 1. Bar velocity at disk's x (for sound intensity; kept in pixel-space).
  const floorNow  = barFloorY(disk.x);
  const floorPrev = (bar.prevY1 ?? bar.y1) +
                    ((bar.prevY2 ?? bar.y2) - (bar.prevY1 ?? bar.y1)) * (disk.x / canvas.width);
  bar.vy = (floorNow - floorPrev) / dt;
  const barMoved = bar.y1 !== bar.prevY1 || bar.y2 !== bar.prevY2;
  bar.prevY1 = bar.y1;
  bar.prevY2 = bar.y2;

  // 2. Grab / release detection.
  const justGrabbed  = anchor.active && !wasAnchorActive;
  const justReleased = !anchor.active && wasAnchorActive;
  wasAnchorActive = anchor.active;
  if(justGrabbed){ clearPause(); createSpringJoint(); }
  if(justReleased) destroySpringJoint();

  // 3. Fling / freeze on release.
  let flung = false;
  if(justReleased){
    const speed = Math.hypot(disk.vx, disk.vy);
    if(speed <= FLING_THRESHOLD){ disk.vx = 0; disk.vy = 0; }
    else flung = true;
  }

  // 4. Push game state (including any external changes) into Planck body.
  syncDiskToBody();

  // 5. Per-frame restitution: softer while spring is active.
  diskBody.getFixtureList().setRestitution(anchor.active ? ANCHOR_BOUNCE : params.bounce);

  // 6. Friction via Planck's native linearDamping (equivalent to params.friction per second).
  diskBody.setLinearDamping(params.friction * params.frameMultiplier);

  // 7. Move kinematic bar.
  updateBarBody();

  // 8. Move kinematic bumper.
  updateBumperBody();

  // 9. Move spring anchor to follow the finger.
  if(anchor.active) anchorBody.setPosition(Vec2(toM(anchor.x), toM(anchor.y)));

  // 10. Cache pre-step speed for sound intensity (handleContact reads this).
  preStepSpeed     = Math.hypot(disk.vx, disk.vy);
  nowBarContact    = false;
  nowBumperContact = false;

  // 11. Physics step — Planck advances positions, resolves collisions.
  //     8 velocity iterations + 3 position iterations is the Box2D recommendation.
  world.step(dt, 8, 3);

  // 12. Read Planck results back into shared disk state.
  readBackDisk();

  // 13. Rising-edge sounds for bar and bumper.
  if(nowBarContact && !wasBarContact){
    const approach  = Math.max(Math.abs(disk.vy), Math.abs(bar.vy));
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

  // 16. Bumper events / targets / trail / idle — unchanged from original.
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
