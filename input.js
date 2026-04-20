import { canvas, disk, input, bar } from './state.js';
import { playGrab, playRelease, playScrape } from './sound.js';

function eventPos(e){
  if(e.touches && e.touches.length) e = e.touches[0];
  return {x: e.clientX, y: e.clientY, t: performance.now()};
}

function distance(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx,dy);
}

export function setupInput(){
  let grabOffsetX = 0, grabOffsetY = 0;
  let barGrabOffset = 0;
  let prevDivergence = 0;

  canvas.addEventListener('pointerdown', (ev)=>{
    const p = eventPos(ev);
    // Check bar hit (must click directly on the bar)
    if(p.y >= bar.y && p.y <= bar.y + bar.height){
      bar.dragging = true;
      barGrabOffset = bar.y - p.y;
      playGrab();
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if(distance(p, disk) <= disk.r){
      input.dragging = true;
      prevDivergence = 0;
      grabOffsetX = disk.x - p.x;
      grabOffsetY = disk.y - p.y;
      disk.vx = 0; disk.vy = 0;
      input.mouseBuf = [p];
      playGrab();
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (ev)=>{
    const p = eventPos(ev);
    if(bar.dragging){
      const minBarY = disk.r * 2;
      let newBarY = p.y + barGrabOffset;
      bar.y = Math.max(minBarY, Math.min(canvas.height - bar.height, newBarY));

      // auto-release if pointer leaves the bar due to clamping
      if(p.y < bar.y || p.y > bar.y + bar.height){
        bar.dragging = false;
        playRelease();
        try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      }
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

    // scrape pip: only when pointer pushes further into the wall
    const divergence = Math.hypot(newX - clampedX, newY - clampedY);
    const divergenceIncrease = divergence - prevDivergence;
    if(divergenceIncrease > 1){
      const intensity = Math.min(divergenceIncrease / 50, 1);
      playScrape(intensity);
    }
    prevDivergence = divergence;

    // if pointer left the disk due to clamping, auto-release
    if(distance(p, disk) > disk.r){
      input.dragging = false;
      playRelease();
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
