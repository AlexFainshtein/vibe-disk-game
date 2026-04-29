let paused   = false;
let savedVx  = 0;
let savedVy  = 0;
let _diskBody = null;
let _Vec2     = null;

const buttonRef = document.getElementById('pauseBtn');

function setLabel(){
  if(buttonRef) buttonRef.textContent = paused ? '▶ Resume' : '⏸ Pause';
}

function togglePause(){
  if(!_diskBody) return;
  if(!paused){
    const v = _diskBody.getLinearVelocity();
    savedVx = v.x;
    savedVy = v.y;
    _diskBody.setLinearVelocity(_Vec2(0, 0));
    paused = true;
  } else {
    _diskBody.setLinearVelocity(_Vec2(savedVx, savedVy));
    _diskBody.setAwake(true);
    paused = false;
  }
  setLabel();
}

if(buttonRef){
  buttonRef.addEventListener('pointerdown', (e) => e.stopPropagation());
  buttonRef.addEventListener('click', togglePause);
}

export function initPause(diskBody, Vec2){
  _diskBody = diskBody;
  _Vec2     = Vec2;
}

export function clearPause(){
  if(!paused) return;
  paused = false;
  setLabel();
}
