import { canvas, renderExtras, inputHooks } from '../state.js';
import { bar } from '../playfield.js';

const BUMPER_RADIUS_FRACTION = 1/6;

function computeRadius(){
  return Math.min(canvas.width, canvas.height) * BUMPER_RADIUS_FRACTION;
}

function defaultPositions(){
  const r = computeRadius();
  const y = canvas.height + bar.height / 2 - r;  // bar overlaps top half-bar-height; bottom extends half-bar-height below screen
  return [
    { x: r,                    y },
    { x: canvas.width / 2,    y },
    { x: canvas.width - r,    y },
  ];
}

// Gesture constants — declared before resize listener that references them
const RESIZE_BLOCK_MS      = 150;   // ignore curvature for this long after grab
const RESIZE_AREA_THRESH   = 800;   // signed-area threshold to enter resize mode
const RESIZE_RATE          = 6;     // radius px change per unit of normalized area
export const MIN_RADIUS_FRAC = 1/20;  // smallest bumper as fraction of short canvas side
export const MAX_RADIUS_FRAC = 1;     // largest bumper as fraction of short canvas side
const TRAIL_DURATION_MS    = 250;   // how long trail points are kept (like WhirlZoomMap)

const BUMPER_DEFS = [
  { color: '#c0392b' },  // red
  { color: '#2471a3' },  // blue
  { color: '#27ae60' },  // green
];

const r = computeRadius();
const pos = defaultPositions();
export const bumpers = BUMPER_DEFS.map((def, i) => ({
  active: true,
  x: pos[i].x,
  y: pos[i].y,
  r,
  color: def.color,
}));


window.addEventListener('resize', () => {
  const shortSide = Math.min(canvas.width, canvas.height);
  const minR = shortSide * MIN_RADIUS_FRAC;
  const maxR = shortSide * MAX_RADIUS_FRAC;
  bumpers.forEach((b) => {
    b.r = Math.max(minR, Math.min(maxR, b.r));
    b.x = Math.max(b.r, Math.min(canvas.width  - b.r, b.x));
    b.y = Math.max(b.r, Math.min(canvas.height - b.r, b.y));
  });
}, { passive: true });

document.getElementById('resetDisk')?.addEventListener('click', () => {
  const defaultR = computeRadius();
  const pos = defaultPositions();
  bumpers.forEach((b, i) => { b.x = pos[i].x; b.y = pos[i].y; b.r = defaultR; });
});

const firstHitPending       = bumpers.map(() => true);
const firstHitSinceLastTick = bumpers.map(() => false);

export function notifyBumperHit(index){
  if(firstHitPending[index]){
    firstHitPending[index]       = false;
    firstHitSinceLastTick[index] = true;
  }
}

function lighten(hex, t){
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgb(${Math.round(r+(255-r)*t)},${Math.round(g+(255-g)*t)},${Math.round(b+(255-b)*t)})`;
}
function darken(hex, t){
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgb(${Math.round(r*(1-t))},${Math.round(g*(1-t))},${Math.round(b*(1-t))})`;
}

function drawBumpers(c){
  bumpers.forEach(b => {
    const { x, y, r } = b;

    // drop shadow
    c.beginPath();
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.ellipse(x+6, y+8, r*0.95, r*0.5, 0, 0, Math.PI*2);
    c.fill();

    // shaded ball: light spot upper-left fading to base color at edge — same as disk
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI*2);
    const grad = c.createRadialGradient(x - r*0.4, y - r*0.4, r*0.05, x, y, r);
    grad.addColorStop(0.0, darken(b.color, -0.15));
//    grad.addColorStop(0, b.color);
    grad.addColorStop(0.5, darken(b.color, 0.10));
    grad.addColorStop(0.7, darken(b.color, 0.25));
    grad.addColorStop(1, darken(b.color, 0.5));
    c.fillStyle = grad;
    c.fill();

    // specular ellipse
    c.beginPath();
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.ellipse(x - r*0.25, y - r*0.35, r*0.45, r*0.25, -0.5, 0, Math.PI*2);
    c.fill();
  });
}
renderExtras.push(drawBumpers);

// Signed area of triangles formed by consecutive trail pairs and current point.
// Same algorithm as WhirlZoomMap: sum 0.5*(p2-p1)x(p3-p1) cross products.
function computeSignedArea(trail, cx, cy){
  if(trail.length < 2) return 0;
  let total = 0;
  for(let i = 0; i < trail.length - 1; i++){
    const p1 = trail[i], p2 = trail[i + 1];
    total += (p2.x - p1.x) * (cy - p1.y) - (cx - p1.x) * (p2.y - p1.y);
  }
  return total * 0.5;
}

let onBumperGrabbed = null;
export function setOnBumperGrabbed(fn){ onBumperGrabbed = fn; }

let draggingIndex  = -1;
let grabOffsetX    = 0;
let grabOffsetY    = 0;
let initialized    = false;

// Per-drag gesture state
let trail          = [];
let dragStartTime  = 0;
let resizeMode     = false;

function init(){
  if(initialized) return;
  initialized = true;

  const prevDown = inputHooks.emptyDown;
  inputHooks.emptyDown = (x, y) => {
    for(let i = bumpers.length - 1; i >= 0; i--){
      const b = bumpers[i];
      const dx = x - b.x, dy = y - b.y;
      if(dx*dx + dy*dy <= b.r * b.r){
        draggingIndex = i;
        grabOffsetX   = b.x - x;
        grabOffsetY   = b.y - y;
        dragStartTime = performance.now();
        trail         = [];
        resizeMode    = false;
        if(onBumperGrabbed) onBumperGrabbed(i);
        return true;
      }
    }
    if(prevDown) return prevDown(x, y);
    return false;
  };

  const prevMove = inputHooks.emptyMove;
  inputHooks.emptyMove = (x, y) => {
    if(draggingIndex >= 0){
      const b   = bumpers[draggingIndex];
      const now = performance.now();

      // Expire trail points older than TRAIL_DURATION_MS (like WhirlZoomMap).
      // This keeps area bounded and reflects only recent curvature.
      while(trail.length > 0 && now - trail[0].t > TRAIL_DURATION_MS) trail.shift();

      // Area uses the time-windowed trail as history; (x,y) is the live tip.
      // Compute BEFORE pushing so current point is the apex, not in the trail.
      const area = computeSignedArea(trail, x, y);

      const elapsed = now - dragStartTime;
      if(!resizeMode && elapsed > RESIZE_BLOCK_MS){
        if(Math.abs(area) > RESIZE_AREA_THRESH) resizeMode = true;
      }

      // Add current point to trail after area computation
      trail.push({ x, y, t: now });

      b.x = x + grabOffsetX;
      b.y = y + grabOffsetY;

      if(resizeMode){
        const shortSide = Math.min(canvas.width, canvas.height);
        const norm      = Math.sqrt(Math.abs(area)) / shortSide * Math.sign(area);
        const minR      = shortSide * MIN_RADIUS_FRAC;
        const maxR      = shortSide * MAX_RADIUS_FRAC;
        b.r = Math.max(minR, Math.min(maxR, b.r + norm * RESIZE_RATE));
      }
    } else if(prevMove) prevMove(x, y);
  };

  const prevUp = inputHooks.emptyUp;
  inputHooks.emptyUp = () => {
    draggingIndex = -1;
    trail         = [];
    resizeMode    = false;
    if(prevUp) prevUp();
  };
}

export function tickBumper(){
  if(!initialized) init();
  const anyFirstHit = firstHitSinceLastTick.some(Boolean);
  firstHitSinceLastTick.fill(false);
  return {
    firstHit:        anyFirstHit,
    placed:          false,
    removed:         false,
    removedAfterHit: false,
  };
}
