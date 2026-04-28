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

export function playFanfare(){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();
  // Rising major arpeggio: C5 E5 G5 C6
  const notes = [523.25, 659.25, 783.99, 1046.50];
  const noteDur = 0.12;
  const gap = 0.10;
  notes.forEach((freq, i) => {
    const t = ac.currentTime + i * gap;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + noteDur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + noteDur + 0.02);
  });
}

export function playDing(){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();
  // Same pop as playShatter but one octave lower (highpass at 1400 Hz instead of 2800)
  const duration = 0.55;
  const bufSize = Math.ceil(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2800;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.55, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  source.start(ac.currentTime);
  source.stop(ac.currentTime + duration + 0.02);
}

export function playShatter(){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();
  // White noise burst through a highpass filter — actual glass-break character
  const duration = 0.55;
  const bufSize = Math.ceil(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 700;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.55, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  source.start(ac.currentTime);
  source.stop(ac.currentTime + duration + 0.02);
}

export function playGulp(){
  const ac = getCtx();
  if(ac.state === 'suspended') ac.resume();
  // Descending pitch from ~450 Hz to ~70 Hz over 200 ms with a fast attack and
  // a lowpass for a wet/throaty character — meant to evoke a swallow when the
  // disk passes through Eugene's hollow-shell mallet wall.
  const duration = 0.2;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(450, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(70, ac.currentTime + duration);
  gain.gain.setValueAtTime(0.0001, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.4, ac.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(700, ac.currentTime);
  filter.Q.setValueAtTime(3, ac.currentTime);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration + 0.02);
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
