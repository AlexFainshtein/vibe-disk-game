import { canvas, ctx, disk, bar } from './state.js';

export function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#071018'); g.addColorStop(1,'#07141a');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // bar
  ctx.fillStyle = bar.color;
  ctx.fillRect(0, bar.y, W, bar.height);

  // shadow
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.ellipse(disk.x+6,disk.y+8,disk.r*0.95,disk.r*0.5,0,0,Math.PI*2);
  ctx.fill();

  // disk
  ctx.beginPath();
  ctx.fillStyle = disk.color;
  ctx.arc(disk.x,disk.y,disk.r,0,Math.PI*2);
  ctx.fill();

  // highlight
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.ellipse(disk.x - disk.r*0.25, disk.y - disk.r*0.35, disk.r*0.45, disk.r*0.25, -0.5, 0, Math.PI*2);
  ctx.fill();
}
