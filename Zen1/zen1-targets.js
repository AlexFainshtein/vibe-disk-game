import { canvas, renderExtras } from '../state.js';
import { disk, bar } from '../playfield.js';
import { playChime } from '../sound.js';
import { diskBody, toPx } from './zen1-physics.js';

const NUM_TARGETS = 5;
const TARGET_RADIUS = 24;
const REGEN_DELAY = 3.0;
const FADE_DURATION = 0.5;
const HIT_INTENSITY = 0.7;
const HIT_OCTAVE_SHIFT = 1;

const TARGET_COLORS = ['#9ec5b3', '#9eb5c5', '#c5b59e', '#c59eb5', '#b59ec5'];

const targets = [];
let initialized = false;

function tryFindSpawnPoint(){
  const margin = TARGET_RADIUS + 10;
  const W = canvas.width;
  const yTop = margin;
  const yBottom = bar.y - margin;
  const minDistFromOthers = TARGET_RADIUS * 3;
  const minDistFromDisk = disk.r + TARGET_RADIUS + 20;
  for(let i = 0; i < 50; i++){
    const x = margin + Math.random() * (W - 2*margin);
    const y = yTop + Math.random() * (yBottom - yTop);
    let ok = true;
    for(const t of targets){
      const dx = t.x - x, dy = t.y - y;
      if(dx*dx + dy*dy < minDistFromOthers*minDistFromOthers){ ok = false; break; }
    }
    if(ok){
      const dp = diskBody.getPosition();
      const ddx = toPx(dp.x) - x, ddy = toPx(dp.y) - y;
      if(ddx*ddx + ddy*ddy < minDistFromDisk*minDistFromDisk) ok = false;
    }
    if(ok) return { x, y };
  }
  return {
    x: margin + Math.random() * (W - 2*margin),
    y: yTop + Math.random() * (yBottom - yTop)
  };
}

function makeTarget(noteIndex){
  const pos = tryFindSpawnPoint();
  return {
    x: pos.x,
    y: pos.y,
    noteIndex,
    alpha: 0,
    state: 'appearing',
    timer: FADE_DURATION
  };
}

function drawTargets(c){
  for(const t of targets){
    if(t.alpha <= 0) continue;
    c.globalAlpha = t.alpha;
    c.beginPath();
    c.fillStyle = TARGET_COLORS[t.noteIndex];
    c.arc(t.x, t.y, TARGET_RADIUS, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

function init(){
  if(initialized) return;
  initialized = true;
  for(let i = 0; i < NUM_TARGETS; i++) targets.push(makeTarget(i));
  renderExtras.push(drawTargets);
}

function updateLifecycle(dt){
  for(const t of targets){
    if(t.state === 'fading'){
      t.timer -= dt;
      t.alpha = Math.max(0, t.timer / FADE_DURATION);
      if(t.timer <= 0){
        t.state = 'hidden';
        t.timer = REGEN_DELAY;
        t.alpha = 0;
      }
    } else if(t.state === 'hidden'){
      t.timer -= dt;
      if(t.timer <= 0){
        t.state = 'appearing';
        t.timer = FADE_DURATION;
      }
    } else if(t.state === 'appearing'){
      t.timer -= dt;
      t.alpha = Math.min(1, 1 - Math.max(0, t.timer) / FADE_DURATION);
      if(t.timer <= 0){
        t.state = 'visible';
        t.alpha = 1;
      }
    }
  }
}

function checkCollisions(){
  const dp = diskBody.getPosition();
  const diskPx = toPx(dp.x), diskPy = toPx(dp.y);
  for(const t of targets){
    if(t.state !== 'visible') continue;
    const dx = diskPx - t.x;
    const dy = diskPy - t.y;
    const r = disk.r + TARGET_RADIUS;
    if(dx*dx + dy*dy < r*r){
      t.state = 'fading';
      t.timer = FADE_DURATION;
      playChime(HIT_INTENSITY, t.noteIndex, HIT_OCTAVE_SHIFT);
    }
  }
}

export function tickTargets(dt){
  if(!initialized) init();
  updateLifecycle(dt);
  checkCollisions();
}
