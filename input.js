import { canvas, disk, input, bar } from './state.js';

function eventPos(e){
  if(e.touches && e.touches.length) e = e.touches[0];
  return {x: e.clientX, y: e.clientY, t: performance.now()};
}

function distance(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx,dy);
}

export function setupInput(){
  let grabOffsetX = 0, grabOffsetY = 0;

  canvas.addEventListener('pointerdown', (ev)=>{
    const p = eventPos(ev);
    // Check bar hit first (within grab zone)
    const barGrab = 24;
    if(Math.abs(p.y - bar.y) <= barGrab){
      bar.dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if(distance(p, disk) <= disk.r){
      input.dragging = true;
      grabOffsetX = disk.x - p.x;
      grabOffsetY = disk.y - p.y;
      disk.vx = 0; disk.vy = 0;
      input.mouseBuf = [p];
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (ev)=>{
    const p = eventPos(ev);
    if(bar.dragging){
      bar.y = Math.max(0, Math.min(canvas.height - bar.height, p.y));
      return;
    }
    if(!input.dragging) return;
    let newX = p.x + grabOffsetX;
    let newY = p.y + grabOffsetY;

    // clamp to walls and bar
    let clampedX = Math.max(disk.r, Math.min(canvas.width - disk.r, newX));
    let clampedY = Math.max(disk.r, Math.min(bar.y - disk.r, newY));

    disk.x = clampedX;
    disk.y = clampedY;

    // if pointer left the disk due to clamping, auto-release
    if(distance(p, disk) > disk.r){
      input.dragging = false;
      // compute velocity from mouse buffer, then zero the wall-facing component
      const buf = input.mouseBuf;
      if(buf.length >= 2){
        const a = buf[buf.length-2];
        const b = buf[buf.length-1];
        const dt = Math.max(1e-3, (b.t - a.t)/1000);
        disk.vx = (b.x - a.x)/dt;
        disk.vy = (b.y - a.y)/dt;
        const max = 1600;
        const speed = Math.hypot(disk.vx, disk.vy);
        if(speed > max){ disk.vx *= max/speed; disk.vy *= max/speed; }
        // zero velocity into the wall
        if(clampedX <= disk.r || clampedX >= canvas.width - disk.r) disk.vx = 0;
        if(clampedY <= disk.r || clampedY >= bar.y - disk.r) disk.vy = 0;
      }
      input.mouseBuf = [];
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      return;
    }

    input.mouseBuf.push(p);
    if(input.mouseBuf.length > 6) input.mouseBuf.shift();
  });

  canvas.addEventListener('pointerup', (ev)=>{
    if(bar.dragging){
      bar.dragging = false;
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      return;
    }
    if(!input.dragging) return;
    input.dragging = false;
    const buf = input.mouseBuf;
    if(buf.length >= 2){
      const a = buf[buf.length-2];
      const b = buf[buf.length-1];
      const dt = Math.max(1e-3, (b.t - a.t)/1000);
      disk.vx = (b.x - a.x)/dt;
      disk.vy = (b.y - a.y)/dt;
      const max = 1600;
      const speed = Math.hypot(disk.vx, disk.vy);
      if(speed > max){ disk.vx *= max/speed; disk.vy *= max/speed; }
    }
    input.mouseBuf = [];
    try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
  });
}
