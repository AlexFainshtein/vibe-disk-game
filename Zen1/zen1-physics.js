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

// ─── Physics constants ────────────────────────────────────────────────────────
const MAX_BOUNCE_SPEED = 1200;   // px/s — caps sound intensity normalisation
const SPRING_K         = 200;    // spring acceleration strength, px/s² per px
const PULL_DAMPING     = 8;      // viscous damping coefficient while spring active
const FLING_THRESHOLD  = 200;    // px/s — below this, release freezes disk
const ANCHOR_BOUNCE    = 0.5;    // restitution while spring is active (softer)

const USE_CHIMES     = true;
const USE_TARGETS    = false;
const USE_BUMPER     = true;
const USE_TRAIL      = true;
const USE_IDLE_RESET = false;
const IDLE_TIMEOUT   = 60;

// ─── Planck.js setup ─────────────────────────────────────────────────────────
// planck is loaded as a UMD global via the <script> tag in zen1.html.
const { World, Vec2, Box, Circle, Edge } = planck;

// Unit conversion: Planck/Box2D works in metres; the game works in pixels.
const PPM    = 64;                  // pixels per metre
const toM    = px => px / PPM;
const toPx   = m  => m  * PPM;

// Spring constant in SI: same Hooke's-law stiffness expressed in m/s² per m.
// a = SPRING_K * Δpx  →  a = (SPRING_K * PPM) * Δm  (same acceleration, different units)
const SPRING_K_M = SPRING_K * PPM;

let world, diskBody, barBody, bumperBody;
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

function applyFriction(dt){
  const speed = Math.hypot(disk.vx, disk.vy);
  if(speed > 1e-6 && params.friction > 0){
    const newSpeed = Math.max(0, speed - speed * params.friction * dt * params.frameMultiplier);
    disk.vx *= newSpeed / speed;
    disk.vy *= newSpeed / speed;
  }
}

function applySpring(){
  const pos  = diskBody.getPosition();
  const vel  = diskBody.getLinearVelocity();
  const mass = diskBody.getMass();
  const dx   = toM(anchor.x) - pos.x;
  const dy   = toM(anchor.y) - pos.y;
  const fx   = mass * (SPRING_K_M * dx - PULL_DAMPING * vel.x);
  const fy   = mass * (SPRING_K_M * dy - PULL_DAMPING * vel.y);
  diskBody.applyForce(Vec2(fx, fy), pos, true);
}

function updateBarBody(dt){
  const prevPos = barBody.getPosition();
  const target  = barCentroidM();
  const angle   = Math.atan2(bar.y2 - bar.y1, canvas.width);

  // Velocity tells the solver how fast the surface is moving → correct impulse on disk.
  const vx = (target.x - prevPos.x) / dt;
  const vy = (target.y - prevPos.y) / dt;

  barBody.setPosition(target);
  barBody.setAngle(angle);
  barBody.setLinearVelocity(Vec2(vx, vy));
}

function updateBumperBody(dt){
  if(!USE_BUMPER || !bumper.active) return;
  const prevPos = bumperBody.getPosition();
  const tx = toM(bumper.x), ty = toM(bumper.y);
  const vx = (tx - prevPos.x) / dt;
  const vy = (ty - prevPos.y) / dt;
  bumperBody.setPosition(Vec2(tx, ty));
  bumperBody.setLinearVelocity(Vec2(vx, vy));
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
  if(justGrabbed) clearPause();

  // 3. Fling / freeze on release.
  let flung = false;
  if(justReleased){
    const speed = Math.hypot(disk.vx, disk.vy);
    if(speed <= FLING_THRESHOLD){ disk.vx = 0; disk.vy = 0; }
    else flung = true;
  }

  // 4. Apply friction to game-side velocity before handing off to Planck.
  applyFriction(dt);

  // 5. Push game state (including any external changes) into Planck body.
  syncDiskToBody();

  // 6. Per-frame restitution: softer while spring is active.
  diskBody.getFixtureList().setRestitution(anchor.active ? ANCHOR_BOUNCE : params.bounce);

  // 7. Move kinematic bar.
  updateBarBody(dt);

  // 8. Move kinematic bumper.
  updateBumperBody(dt);

  // 9. Spring force (applied before the step).
  if(anchor.active) applySpring();

  // 10. Cache pre-step speed for sound intensity (handleContact reads this).
  preStepSpeed     = Math.hypot(disk.vx, disk.vy);
  nowBarContact    = false;
  nowBumperContact = false;

  // 11. Physics step — Planck advances positions, resolves collisions.
  //     8 velocity iterations + 3 position iterations is the Box2D recommendation.
  world.step(dt, 8, 3);

  // 12. Read Planck results back into shared disk state.
  readBackDisk();

  // 13. Apply friction again post-step (prevents energy re-injection from solver).
  applyFriction(dt);

  // 14. Push post-friction velocity back so the next step starts from the right value.
  diskBody.setLinearVelocity(Vec2(toM(disk.vx), toM(disk.vy)));

  // 15. Rising-edge sounds for bar and bumper.
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
