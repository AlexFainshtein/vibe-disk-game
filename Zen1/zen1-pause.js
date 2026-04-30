import { inputHooks } from '../state.js';

let paused    = false;
let savedVx   = 0;
let savedVy   = 0;
let _diskBody = null;
let _Vec2     = null;

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
}

export function initPause(diskBody, Vec2){
  _diskBody = diskBody;
  _Vec2     = Vec2;

  const prevDown = inputHooks.emptyDown;
  inputHooks.emptyDown = (x, y) => {
    if(prevDown && prevDown(x, y) === true) return true;
    togglePause();
    return true;
  };
}

export function clearPause(){
  if(!paused) return;
  paused = false;
  savedVx = savedVy = 0;
}
