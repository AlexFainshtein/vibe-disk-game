import { canvas, params, disk, bar, anchor } from './state.js';
import { playKnock, playChime } from './sound.js';

const MAX_BOUNCE_SPEED = 1200;
const SPRING_K = 200; // was 40;     // spring stiffness (higher = snappier)
const SPRING_DAMP = 4;   // damping (higher = less oscillation)

const USE_CHIMES = true; // pentatonic chime on bounce instead of knock

// Map disk vertical position at bounce time to one of 5 pentatonic notes.
// Touching the bar → 0 (lowest), touching the ceiling → 4 (highest);
// the middle band of height (H - 2R) is split into 3 equal stripes for 1, 2, 3.
function noteFromY(){
  const physY = bar.y - disk.y; // height of disk center above the bar
  const H = bar.y;
  const R = disk.r;
  const eps = 0.5;
  if(physY <= R + eps) return 0;
  if(physY >= H - R - eps) return 4;
  const t = (physY - R - eps) / (H - 2*R - 2*eps); // 0..1 across middle band
  if(t < 1/3) return 1;
  if(t < 2/3) return 2;
  return 3;
}

export function update(dt){
  // compute bar velocity from position change
  bar.vy = (bar.y - bar.prevY) / dt;
  bar.prevY = bar.y;

  const friction = params.friction; // 0..1 fractional braking
  const frameMultiplier = params.frameMultiplier;

  // damped spring toward anchor
  if(anchor.active){
    const dx = anchor.x - disk.x;
    const dy = anchor.y - disk.y;
    disk.vx += (SPRING_K * dx - SPRING_DAMP * disk.vx) * dt;
    disk.vy += (SPRING_K * dy - SPRING_DAMP * disk.vy) * dt;
  }

  // friction (only when spring is not active)
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

  disk.x += disk.vx * dt;
  disk.y += disk.vy * dt;

  const W = canvas.width, H = canvas.height;
  let bounced = false, bounceSpeed = 0;
  if(disk.x - disk.r < 0){ disk.x = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  if(disk.x + disk.r > W){ disk.x = W - disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vx)); disk.vx *= -params.bounce; bounced = true; }
  if(disk.y - disk.r < 0){ disk.y = disk.r; bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy)); disk.vy *= -params.bounce; bounced = true; }
  // bar collision: disk bounces off bar top with relative velocity
  if(disk.y + disk.r > bar.y){
    disk.y = bar.y - disk.r;
    bounceSpeed = Math.max(bounceSpeed, Math.abs(disk.vy));
    disk.vy = -Math.abs(disk.vy) * params.bounce + 2 * bar.vy;
    bounced = true;
  }
  if(bounced){
    const intensity = Math.min(bounceSpeed / MAX_BOUNCE_SPEED, 1);
    if(USE_CHIMES) playChime(intensity, noteFromY());
    else playKnock(intensity);
  }
}
