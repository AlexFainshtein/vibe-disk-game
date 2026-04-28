import { renderExtras } from '../state.js';
import { disk } from '../playfield.js';

const TRAIL_COLOR = 'rgba(255, 255, 255, 0.28)';
const TRAIL_WIDTH = 1.5;

const trail = [];
let currentSegment = null;
let nextSegmentColor = TRAIL_COLOR;
let nextSegmentComposite = 'source-over';
let nextSegmentWidth = TRAIL_WIDTH;
let initialized = false;

function drawTrail(c){
  for(const segment of trail){
    if(segment.points.length < 2) continue;
    c.strokeStyle = segment.color;
    c.globalCompositeOperation = segment.composite || 'source-over';
    c.lineWidth = segment.width || TRAIL_WIDTH;
    c.beginPath();
    c.moveTo(segment.points[0].x, segment.points[0].y);
    for(let i = 1; i < segment.points.length; i++){
      c.lineTo(segment.points[i].x, segment.points[i].y);
    }
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
}

function init(){
  if(initialized) return;
  initialized = true;
  renderExtras.push(drawTrail);
  document.getElementById('resetDisk')?.addEventListener('click', resetTrail);
}

export function tickTrail(){
  if(!initialized) init();
  if(!currentSegment){
    currentSegment = { color: nextSegmentColor, composite: nextSegmentComposite, width: nextSegmentWidth, points: [] };
    trail.push(currentSegment);
  }
  currentSegment.points.push({ x: disk.x, y: disk.y });
}

export function pauseTrail(){
  currentSegment = null;
}

export function resetTrail(){
  trail.length = 0;
  currentSegment = null;
}

export function setTrailColor(color, composite = 'source-over', width = TRAIL_WIDTH){
  nextSegmentColor = color;
  nextSegmentComposite = composite;
  nextSegmentWidth = width;
  currentSegment = null;
}

export function resetTrailColor(){
  nextSegmentColor = TRAIL_COLOR;
  nextSegmentComposite = 'source-over';
  nextSegmentWidth = TRAIL_WIDTH;
  currentSegment = null;
}
