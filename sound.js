let ctx = null;

function getCtx(){
  if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

export function playKnock(intensity){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();

  const vol = 0.15 + 0.55 * intensity;
  const freq = 120 + 180 * intensity;
  const duration = 0.04 + 0.03 * intensity;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ac.currentTime + duration);
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800 + 600 * intensity, ac.currentTime);
  filter.Q.setValueAtTime(1.5, ac.currentTime);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration + 0.01);
}

const PENTATONIC_FREQS = [220.00, 261.63, 293.66, 329.63, 392.00]; // A minor pentatonic: A3, C4, D4, E4, G4

export function playChime(intensity, noteIndex, octaveShift = 0){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();

  const freq = PENTATONIC_FREQS[noteIndex] * Math.pow(2, octaveShift);
  const vol = 0.15 + 0.45 * intensity;
  const duration = 0.4;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);

  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration + 0.01);
}

export function playGrab(){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, ac.currentTime);
  gain.gain.setValueAtTime(0.2, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.1);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.11);
}

export function playRelease(){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, ac.currentTime);
  gain.gain.setValueAtTime(0.2, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.1);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.11);
}

const scrapePips = [
  { freq: 180, type: 'square' },
  { freq: 220, type: 'sawtooth' },
  { freq: 160, type: 'square' },
  { freq: 250, type: 'sawtooth' },
  { freq: 140, type: 'square' },
  { freq: 200, type: 'sawtooth' },
];
let scrapeIndex = 0;

export function playScrape(intensity){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();
  const pip = scrapePips[scrapeIndex];
  scrapeIndex = (scrapeIndex + 1) % scrapePips.length;

  const vol = 0.06 + 0.12 * intensity;
  const duration = 0.025 + 0.015 * intensity;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = pip.type;
  osc.frequency.setValueAtTime(pip.freq, ac.currentTime);
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration + 0.01);
}
