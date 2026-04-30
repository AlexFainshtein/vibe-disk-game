import { canvas, ctx, screen, renderExtras, renderOverlays } from '../state.js';
import { disk, bar } from '../playfield.js';
import { diskBody, toPx } from './zen1-physics.js';

export function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const bg = screen.backgrounds[screen.current];
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, bg.top); g.addColorStop(1, bg.bottom);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  for(const fn of renderExtras) fn(ctx);

  bar.overlay?.(ctx);

  const pos = diskBody.getPosition();
  const dx  = toPx(pos.x);
  const dy  = toPx(pos.y);

  if(disk.highlight){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.ellipse(dx+6, dy+8, disk.r*0.95, disk.r*0.5, 0, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(dx, dy, disk.r, 0, Math.PI*2);
  if(disk.glass){
    ctx.fillStyle = 'rgba(210,235,255,0.07)';
    ctx.fill();
    const rimGrad = ctx.createLinearGradient(
      dx - disk.r, dy - disk.r,
      dx + disk.r, dy + disk.r);
    rimGrad.addColorStop(0,    'rgba(255,120,220,0.85)');
    rimGrad.addColorStop(0.33, 'rgba(100,210,255,0.85)');
    rimGrad.addColorStop(0.66, 'rgba(180,255,120,0.85)');
    rimGrad.addColorStop(1,    'rgba(255,120,220,0.85)');
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else if(disk.highlight){
    const grad = ctx.createRadialGradient(
      dx - disk.r*0.4, dy - disk.r*0.4, disk.r*0.05,
      dx,              dy,              disk.r
    );
    grad.addColorStop(0, disk.highlight);
    grad.addColorStop(1, disk.color);
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    ctx.fillStyle = disk.color;
    ctx.fill();
  }

  if(disk.glass || disk.highlight){
    ctx.beginPath();
    ctx.fillStyle = disk.glass ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.06)';
    ctx.ellipse(dx - disk.r*0.25, dy - disk.r*0.35, disk.r*0.45, disk.r*0.25, -0.5, 0, Math.PI*2);
    ctx.fill();
  }

  for(const fn of renderOverlays) fn(ctx);
}
