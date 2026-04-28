import { disk } from '../playfield.js';

let paused = false;
let savedVx = 0;
let savedVy = 0;

const buttonRef = document.getElementById('pauseBtn');

function setLabel(){
  if(buttonRef) buttonRef.textContent = paused ? '▶ Resume' : '⏸ Pause';
}

function togglePause(){
  if(!paused){
    savedVx = disk.vx;
    savedVy = disk.vy;
    disk.vx = 0;
    disk.vy = 0;
    paused = true;
  } else {
    disk.vx = savedVx;
    disk.vy = savedVy;
    paused = false;
  }
  setLabel();
}

if(buttonRef){
  buttonRef.addEventListener('pointerdown', (e) => e.stopPropagation());
  buttonRef.addEventListener('click', togglePause);
}

export function clearPause(){
  if(!paused) return;
  paused = false;
  setLabel();
}

export function isPaused(){
  return paused;
}
