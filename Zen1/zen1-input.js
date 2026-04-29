import { canvas, inputHooks } from '../state.js';
import { disk, bar, clampBarY } from '../playfield.js';
import { playGrab, playRelease } from '../sound.js';
import { diskBody, toPx, grab, release, moveAnchor } from './zen1-physics.js';

function eventPos(e){
  if(e.touches && e.touches.length) e = e.touches[0];
  return { x: e.clientX, y: e.clientY };
}

export function setupInput(){
  let barGrabOffset = 0;
  let emptyEngaged  = false;
  let diskHeld      = false;

  let lastTouchEnd = 0;
  canvas.addEventListener('touchend',   () => { lastTouchEnd = Date.now(); }, { passive: true });
  canvas.addEventListener('touchstart', (e) => { if(Date.now() - lastTouchEnd <= 500) e.preventDefault(); }, { passive: false });

  canvas.addEventListener('pointerdown', (ev) => {
    const p = eventPos(ev);

    const barBottom = (bar.y2 != null ? Math.max(bar.y1, bar.y2) : bar.y) + bar.height;
    const inBarBounds = p.y >= bar.y && p.y <= barBottom;
    if(inBarBounds && inputHooks.barDown && inputHooks.barDown(p.x, p.y) === true){
      emptyEngaged = true;
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if(!bar.hidden && inBarBounds){
      bar.dragging = true;
      barGrabOffset = bar.y - p.y;
      playGrab();
      canvas.setPointerCapture(ev.pointerId);
      return;
    }

    // Disk hit detection directly from the Planck body position.
    const bodyPos = diskBody.getPosition();
    const cx = toPx(bodyPos.x), cy = toPx(bodyPos.y);
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if(dist <= disk.r && inputHooks.diskGrab !== false){
      grab(p.x, p.y);
      diskHeld = true;
      playGrab();
      canvas.setPointerCapture(ev.pointerId);
    } else if(inputHooks.emptyDown){
      emptyEngaged = inputHooks.emptyDown(p.x, p.y) === true;
      if(emptyEngaged) canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    const p = eventPos(ev);
    if(bar.dragging){
      bar.y = clampBarY(p.y + barGrabOffset);
      if(p.y < bar.y || p.y > bar.y + bar.height){
        bar.dragging = false;
        playRelease();
        try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      }
      return;
    }
    if(diskHeld){
      moveAnchor(p.x, p.y);
      return;
    }
    if(emptyEngaged && inputHooks.emptyMove){
      inputHooks.emptyMove(p.x, p.y);
    }
  });

  canvas.addEventListener('pointerup', (ev) => {
    if(bar.dragging){
      bar.dragging = false;
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      return;
    }
    if(diskHeld){
      diskHeld = false;
      release();
      playRelease();
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
      return;
    }
    if(emptyEngaged){
      emptyEngaged = false;
      if(inputHooks.emptyUp) inputHooks.emptyUp();
      try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
    }
  });
}
