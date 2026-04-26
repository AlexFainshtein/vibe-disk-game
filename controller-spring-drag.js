// Spring-drag controller: a damped spring pulls a controllable entity toward an
// anchor point while the anchor is active. Classifies the release gesture as a
// fling (speed above threshold → entity keeps its velocity) or a place (at or
// below threshold → entity is frozen in place).
//
// Pure controller: knows nothing about walls, bricks, sounds, or any other game
// concern. Operates only on the entity (anything with x,y,vx,vy) and the anchor
// (anything with x,y,active). The owning game module decides what to do with the
// returned events.
//
// Usage:
//   const springDrag = createSpringDragController({ springK, springDamp, flingThreshold });
//   const ev = springDrag(disk, anchor, dt);
//   if (ev.grabbed) ...; if (ev.flung) ...;

export function createSpringDragController({
  springK = 200,
  springDamp = 4,
  flingThreshold = 200,
} = {}){
  let prevActive = false;

  return function tick(entity, anchor, dt){
    const grabbed  =  anchor.active && !prevActive;
    const released = !anchor.active &&  prevActive;
    prevActive = anchor.active;

    // Damped spring toward anchor while held.
    if(anchor.active){
      const dx = anchor.x - entity.x;
      const dy = anchor.y - entity.y;
      entity.vx += (springK * dx - springDamp * entity.vx) * dt;
      entity.vy += (springK * dy - springDamp * entity.vy) * dt;
    }

    // Fling-vs-place classification at release. A place zeros velocity so the
    // entity freezes wherever the user let go; a fling lets inertia carry it.
    let flung = false, placed = false;
    if(released){
      const speed = Math.hypot(entity.vx, entity.vy);
      if(speed > flingThreshold){
        flung = true;
      } else {
        entity.vx = 0;
        entity.vy = 0;
        placed = true;
      }
    }

    return { grabbed, released, flung, placed, active: anchor.active };
  };
}
