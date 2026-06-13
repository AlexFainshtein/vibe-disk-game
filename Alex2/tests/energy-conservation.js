// Energy-conservation test for Alex2's EOMs.
//
// Runs the implicit-midpoint integrator (energy-conserving in the
// conservative limit) on the chain with: damping off, anchor input off,
// bending off (then again with bending on, which is conservative too).
// Records E = ½ θ̇ᵀ M(θ) θ̇ at every frame.  In the conservative limit
// E must be constant — any drift > 1e-8 over hundreds of frames means
// there's an inconsistency in M, C, or how the residual is assembled.
//
// Three test runs:
//   (a) Free chain, no bending, small θ̇ initial: E should be flat.
//   (b) Free chain, with bending, small θ initial offset: E (kinetic +
//       elastic) should be flat.
//   (c) For comparison, same as (a) but with implicit Euler: E should
//       decay monotonically (numerical dissipation), never grow.
//
// Run: node energy-conservation.js

'use strict';

// ----------------------------------------------------------------------
// Constants — knobs the test will sweep
// ----------------------------------------------------------------------

let BENDING_EI         = 100;       // overridden per test
let DAMPING_BEND       = 0;         // conservative: 0
let VISCOUS_DRAG       = 0;         // conservative: 0
let SIMPLIFIED_PHYSICS = false;

const NEWTON_MAX_ITERS = 12;
const NEWTON_TOL       = 1e-12;

// ----------------------------------------------------------------------
// Math (same as jacobian-fd-check.js — keeping the files self-contained)
// ----------------------------------------------------------------------

function makeRope(Ns, segmentLength, particleMass){
  const muDiag = new Float64Array(Ns);
  for(let j = 0; j < Ns; j++) muDiag[j] = (Ns - j) * particleMass;
  return {
    Ns, segmentLength, particleMass, muDiag,
    theta:        new Float64Array(Ns),
    thetaDot:     new Float64Array(Ns),
    M:            new Float64Array(Ns * Ns),
    M_snap:       new Float64Array(Ns * Ns),
    A_raw:        new Float64Array(Ns * Ns),
    B_raw:        new Float64Array(Ns * Ns),
    K:            new Float64Array(Ns * Ns),
    rhs:          new Float64Array(Ns),
    accel:        new Float64Array(Ns),
    thetaN:       new Float64Array(Ns),
    thetaDotN:    new Float64Array(Ns),
    thetaNew:     new Float64Array(Ns),
    thetaDotNew:  new Float64Array(Ns),
    thetaEval:    new Float64Array(Ns),
    thetaDotEval: new Float64Array(Ns),
    ddtEval:      new Float64Array(Ns),
    F_theta:      new Float64Array(Ns),
    F_thetaDot:   new Float64Array(Ns),
    dTheta:       new Float64Array(Ns),
    dThetaDot:    new Float64Array(Ns),
    Krhs:         new Float64Array(Ns),
    tmpNs:        new Float64Array(Ns),
    tmpNs2:       new Float64Array(Ns),
  };
}

function buildMassMatrix(rope, theta){
  const Ns = rope.Ns;
  const L  = rope.segmentLength;
  const m  = rope.particleMass;
  const M  = rope.M;
  const L2 = L * L;
  if(SIMPLIFIED_PHYSICS){
    for(let j = 0; j < Ns; j++){
      for(let k = 0; k < Ns; k++){
        const mu = (Ns - Math.max(j, k)) * m;
        M[j * Ns + k] = L2 * mu;
      }
    }
    return;
  }
  for(let j = 0; j < Ns; j++){
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      M[j * Ns + k] = L2 * Math.cos(theta[j] - theta[k]) * mu;
    }
  }
}

function buildRhs(rope, theta, thetaDot, ax, ay){
  const Ns      = rope.Ns;
  const L       = rope.segmentLength;
  const m       = rope.particleMass;
  const muDiag  = rope.muDiag;
  const rhs     = rope.rhs;
  const L2      = L * L;
  const kTheta  = BENDING_EI / L;
  for(let j = 0; j < Ns; j++){
    let qAnchor = L * muDiag[j] * (Math.sin(theta[j]) * ax - Math.cos(theta[j]) * ay);
    let cj = 0;
    if(!SIMPLIFIED_PHYSICS){
      for(let k = 0; k < Ns; k++){
        const mu = (Ns - Math.max(j, k)) * m;
        cj += L2 * mu * Math.sin(theta[j] - theta[k]) * thetaDot[k] * thetaDot[k];
      }
    }
    let qDamp = 0;
    if(DAMPING_BEND !== 0 && Ns >= 2){
      let lapThetaDot;
      if(j === 0){
        lapThetaDot = thetaDot[1] - thetaDot[0];
      } else if(j === Ns - 1){
        lapThetaDot = thetaDot[Ns - 2] - thetaDot[Ns - 1];
      } else {
        lapThetaDot = thetaDot[j - 1] - 2 * thetaDot[j] + thetaDot[j + 1];
      }
      qDamp = DAMPING_BEND * lapThetaDot;
    }
    let qBend = 0;
    if(Ns >= 2 && BENDING_EI !== 0){
      if(SIMPLIFIED_PHYSICS){
        let lapTheta;
        if(j === 0){
          lapTheta = theta[1] - theta[0];
        } else if(j === Ns - 1){
          lapTheta = theta[Ns - 2] - theta[Ns - 1];
        } else {
          lapTheta = theta[j - 1] - 2 * theta[j] + theta[j + 1];
        }
        qBend = kTheta * lapTheta;
      } else {
        const piMinusEps = Math.PI - 0.01;
        let vpLeft = 0;
        if(j > 0){
          let dl = theta[j] - theta[j - 1];
          if(dl >  piMinusEps) dl =  piMinusEps;
          else if(dl < -piMinusEps) dl = -piMinusEps;
          vpLeft = 2 * kTheta * Math.tan(dl * 0.5);
        }
        let vpRight = 0;
        if(j < Ns - 1){
          let dr = theta[j + 1] - theta[j];
          if(dr >  piMinusEps) dr =  piMinusEps;
          else if(dr < -piMinusEps) dr = -piMinusEps;
          vpRight = 2 * kTheta * Math.tan(dr * 0.5);
        }
        qBend = vpRight - vpLeft;
      }
    }
    rhs[j] = qAnchor - cj + qBend + qDamp;
  }
}

function gaussSolve(N, A, b, x){
  for(let p = 0; p < N; p++){
    let pivotRow = p;
    let pivotMag = Math.abs(A[p * N + p]);
    for(let r = p + 1; r < N; r++){
      const mag = Math.abs(A[r * N + p]);
      if(mag > pivotMag){ pivotMag = mag; pivotRow = r; }
    }
    if(pivotRow !== p){
      for(let c = p; c < N; c++){
        const tmp = A[p * N + c];
        A[p * N + c] = A[pivotRow * N + c];
        A[pivotRow * N + c] = tmp;
      }
      const tmp = b[p]; b[p] = b[pivotRow]; b[pivotRow] = tmp;
    }
    const pivot = A[p * N + p];
    if(Math.abs(pivot) < 1e-12){
      for(let i = 0; i < N; i++) x[i] = 0;
      return;
    }
    for(let r = p + 1; r < N; r++){
      const factor = A[r * N + p] / pivot;
      if(factor === 0) continue;
      for(let c = p; c < N; c++){
        A[r * N + c] -= factor * A[p * N + c];
      }
      b[r] -= factor * b[p];
    }
  }
  for(let i = N - 1; i >= 0; i--){
    let sum = b[i];
    for(let c = i + 1; c < N; c++){
      sum -= A[i * N + c] * x[c];
    }
    x[i] = sum / A[i * N + i];
  }
}

function buildJacobianBlocks(rope, theta, thetaDot, ddt, ax, ay){
  const Ns         = rope.Ns;
  const L          = rope.segmentLength;
  const m          = rope.particleMass;
  const muDiag     = rope.muDiag;
  const L2         = L * L;
  const kTheta     = BENDING_EI / L;
  const piMinusEps = Math.PI - 0.01;
  const A          = rope.A_raw;
  const B          = rope.B_raw;
  const M          = rope.M_snap;
  const w          = rope.tmpNs;
  const S          = rope.tmpNs2;

  A.fill(0);
  B.fill(0);

  if(!SIMPLIFIED_PHYSICS){
    for(let i = 0; i < Ns; i++) w[i] = VISCOUS_DRAG * thetaDot[i] + ddt[i];
    for(let i = 0; i < Ns; i++){
      let s = 0;
      for(let j = 0; j < Ns; j++){
        const mu = (Ns - Math.max(i, j)) * m;
        s += L2 * mu * Math.sin(theta[i] - theta[j]) * w[j];
      }
      S[i] = s;
    }
  }

  for(let k = 0; k < Ns; k++){
    A[k * Ns + k] += L * muDiag[k] * (Math.cos(theta[k]) * ax + Math.sin(theta[k]) * ay);

    if(!SIMPLIFIED_PHYSICS){
      const tdk2 = thetaDot[k] * thetaDot[k];
      for(let i = 0; i < Ns; i++){
        const muIK = (Ns - Math.max(i, k)) * m;
        A[i * Ns + k] += L2 * muIK * Math.cos(theta[i] - theta[k]) * tdk2;
      }
      let sumC = 0;
      for(let l = 0; l < Ns; l++){
        const muKL = (Ns - Math.max(k, l)) * m;
        sumC += L2 * muKL * Math.cos(theta[k] - theta[l]) * thetaDot[l] * thetaDot[l];
      }
      A[k * Ns + k] -= sumC;

      for(let i = 0; i < Ns; i++){
        const muIK = (Ns - Math.max(i, k)) * m;
        A[i * Ns + k] -= L2 * muIK * Math.sin(theta[i] - theta[k]) * w[k];
      }
      A[k * Ns + k] += S[k];
    }
  }

  if(BENDING_EI !== 0 && Ns >= 2){
    for(let i = 0; i < Ns; i++){
      if(i < Ns - 1){
        let Vpp;
        if(SIMPLIFIED_PHYSICS){
          Vpp = kTheta;
        } else {
          let dr = theta[i + 1] - theta[i];
          if(dr >  piMinusEps) dr =  piMinusEps;
          else if(dr < -piMinusEps) dr = -piMinusEps;
          const c = Math.cos(dr * 0.5);
          Vpp = kTheta / (c * c);
        }
        A[i * Ns + i]       -= Vpp;
        A[i * Ns + (i + 1)] += Vpp;
      }
      if(i > 0){
        let Vpp;
        if(SIMPLIFIED_PHYSICS){
          Vpp = kTheta;
        } else {
          let dl = theta[i] - theta[i - 1];
          if(dl >  piMinusEps) dl =  piMinusEps;
          else if(dl < -piMinusEps) dl = -piMinusEps;
          const c = Math.cos(dl * 0.5);
          Vpp = kTheta / (c * c);
        }
        A[i * Ns + i]       -= Vpp;
        A[i * Ns + (i - 1)] += Vpp;
      }
    }
  }

  for(let j = 0; j < Ns; j++){
    for(let mm = 0; mm < Ns; mm++){
      if(!SIMPLIFIED_PHYSICS){
        const muJM = (Ns - Math.max(j, mm)) * m;
        B[j * Ns + mm] -= 2 * L2 * muJM * Math.sin(theta[j] - theta[mm]) * thetaDot[mm];
      }
      B[j * Ns + mm] -= VISCOUS_DRAG * M[j * Ns + mm];
    }
  }

  if(DAMPING_BEND !== 0 && Ns >= 2){
    const c = DAMPING_BEND;
    B[0 * Ns + 0] -= c;
    B[0 * Ns + 1] += c;
    for(let j = 1; j < Ns - 1; j++){
      B[j * Ns + (j - 1)] += c;
      B[j * Ns + j]       -= 2 * c;
      B[j * Ns + (j + 1)] += c;
    }
    B[(Ns - 1) * Ns + (Ns - 2)] += c;
    B[(Ns - 1) * Ns + (Ns - 1)] -= c;
  }
}

// ----------------------------------------------------------------------
// One implicit step, parametrized by gamma (0.5 = midpoint, 1.0 = Euler).
// Same structure as alex2-physics.js.
// ----------------------------------------------------------------------

function implicitStep(rope, h, ax, ay, gamma){
  const Ns          = rope.Ns;
  const theta       = rope.theta;
  const thetaDot    = rope.thetaDot;
  const thetaN      = rope.thetaN;
  const thetaDotN   = rope.thetaDotN;
  const thetaNew    = rope.thetaNew;
  const thetaDotNew = rope.thetaDotNew;
  const thetaEval   = rope.thetaEval;
  const thetaDotEval= rope.thetaDotEval;
  const ddtEval     = rope.ddtEval;
  const F_theta     = rope.F_theta;
  const F_thetaDot  = rope.F_thetaDot;
  const dTheta      = rope.dTheta;
  const dThetaDot   = rope.dThetaDot;
  const A           = rope.A_raw;
  const B           = rope.B_raw;
  const K           = rope.K;
  const Krhs        = rope.Krhs;
  const Msnap       = rope.M_snap;

  thetaN.set(theta);
  thetaDotN.set(thetaDot);

  buildMassMatrix(rope, thetaN);
  Msnap.set(rope.M);
  buildRhs(rope, thetaN, thetaDotN, ax, ay);
  if(VISCOUS_DRAG !== 0){
    for(let i = 0; i < Ns; i++){
      let s = 0;
      for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotN[j];
      rope.rhs[i] -= VISCOUS_DRAG * s;
    }
  }
  gaussSolve(Ns, rope.M, rope.rhs, rope.accel);
  for(let i = 0; i < Ns; i++){
    thetaNew[i]    = thetaN[i]    + h * thetaDotN[i];
    thetaDotNew[i] = thetaDotN[i] + h * rope.accel[i];
  }

  const oneMinusGamma = 1 - gamma;
  const hg   = h * gamma;
  const hg2  = hg * hg;
  const invHg = 1 / hg;

  let converged = false;
  let iters = 0;
  let lastRel = 0;
  for(let iter = 0; iter < NEWTON_MAX_ITERS; iter++){
    iters = iter + 1;
    for(let i = 0; i < Ns; i++){
      thetaEval[i]    = oneMinusGamma * thetaN[i]    + gamma * thetaNew[i];
      thetaDotEval[i] = oneMinusGamma * thetaDotN[i] + gamma * thetaDotNew[i];
    }
    buildMassMatrix(rope, thetaEval);
    Msnap.set(rope.M);
    buildRhs(rope, thetaEval, thetaDotEval, ax, ay);
    if(VISCOUS_DRAG !== 0){
      for(let i = 0; i < Ns; i++){
        let s = 0;
        for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotEval[j];
        rope.rhs[i] -= VISCOUS_DRAG * s;
      }
    }
    gaussSolve(Ns, rope.M, rope.rhs, rope.accel);
    ddtEval.set(rope.accel);

    for(let i = 0; i < Ns; i++){
      F_theta[i]    = thetaNew[i]    - thetaN[i]    - h * thetaDotEval[i];
      F_thetaDot[i] = thetaDotNew[i] - thetaDotN[i] - h * ddtEval[i];
    }

    buildJacobianBlocks(rope, thetaEval, thetaDotEval, ddtEval, ax, ay);

    const Ns2 = Ns * Ns;
    for(let i = 0; i < Ns2; i++){
      K[i] = Msnap[i] - hg * B[i] - hg2 * A[i];
    }

    for(let i = 0; i < Ns; i++){
      let mTheta = 0, mThetaDot = 0, bTheta = 0;
      for(let j = 0; j < Ns; j++){
        mTheta    += Msnap[i * Ns + j] * (-F_theta[j]);
        mThetaDot += Msnap[i * Ns + j] * (-F_thetaDot[j]);
        bTheta    += B[i * Ns + j]     * (-F_theta[j]);
      }
      Krhs[i] = mTheta + hg * mThetaDot - hg * bTheta;
    }
    gaussSolve(Ns, K, Krhs, dTheta);

    let dNorm2 = 0, yNorm2 = 0;
    for(let i = 0; i < Ns; i++){
      dThetaDot[i]    = invHg * (dTheta[i] + F_theta[i]);
      thetaNew[i]    += dTheta[i];
      thetaDotNew[i] += dThetaDot[i];
      dNorm2 += dTheta[i] * dTheta[i] + dThetaDot[i] * dThetaDot[i];
      yNorm2 += thetaNew[i] * thetaNew[i] + thetaDotNew[i] * thetaDotNew[i];
    }
    const denom = Math.max(Math.sqrt(yNorm2), 1);
    lastRel = Math.sqrt(dNorm2) / denom;
    if(lastRel < NEWTON_TOL){ converged = true; break; }
  }
  theta.set(thetaNew);
  thetaDot.set(thetaDotNew);
  return { converged, iters, lastRel };
}

// ----------------------------------------------------------------------
// Energy: E = ½ θ̇ᵀ M(θ) θ̇  (kinetic) + V_bend(θ) (elastic potential)
// ----------------------------------------------------------------------

function computeKinetic(rope){
  const Ns = rope.Ns;
  const theta = rope.theta;
  const thetaDot = rope.thetaDot;
  buildMassMatrix(rope, theta);
  let E = 0;
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++) s += rope.M[i * Ns + j] * thetaDot[j];
    E += thetaDot[i] * s;
  }
  return 0.5 * E;
}

// Linear bending potential V = ½ k_θ Σ (Δθ)² (j-1, j+1 pairs), with free ends.
// Nonlinear bending potential V_pair(Δθ) = -4 k_θ log(cos(Δθ/2)).
function computeBendingPotential(rope){
  const Ns = rope.Ns;
  const theta = rope.theta;
  const L = rope.segmentLength;
  const kTheta = BENDING_EI / L;
  if(BENDING_EI === 0 || Ns < 2) return 0;
  let V = 0;
  for(let j = 0; j < Ns - 1; j++){
    const dx = theta[j + 1] - theta[j];
    if(SIMPLIFIED_PHYSICS){
      V += 0.5 * kTheta * dx * dx;
    } else {
      // -4 k_θ log(cos(Δθ/2))
      const cd = Math.cos(dx * 0.5);
      V += -4 * kTheta * Math.log(Math.max(cd, 1e-12));
    }
  }
  return V;
}

function computeEnergy(rope){
  return computeKinetic(rope) + computeBendingPotential(rope);
}

// ----------------------------------------------------------------------
// Test runners
// ----------------------------------------------------------------------

function runEnergyTest(label, Ns, L, m, integrator, gamma, h, nFrames, initFn, opts){
  const rope = makeRope(Ns, L, m);
  initFn(rope);
  const E0 = computeEnergy(rope);
  let Emax = E0, Emin = E0;
  let maxIter = 0;
  let failedConverges = 0;
  for(let f = 0; f < nFrames; f++){
    const r = implicitStep(rope, h, 0, 0, gamma);
    if(!r.converged) failedConverges++;
    if(r.iters > maxIter) maxIter = r.iters;
    const E = computeEnergy(rope);
    if(E > Emax) Emax = E;
    if(E < Emin) Emin = E;
  }
  const E_final = computeEnergy(rope);
  const drift_max = Math.max(Math.abs(Emax - E0), Math.abs(Emin - E0));
  const drift_final = Math.abs(E_final - E0);
  const drift_rel = drift_max / Math.max(Math.abs(E0), 1e-12);
  console.log(`\n=== ${label} ===`);
  console.log(`  integrator=${integrator} (gamma=${gamma}), h=${h}, frames=${nFrames}, total time=${(h*nFrames).toFixed(3)}s`);
  console.log(`  E_initial = ${E0.toExponential(6)}`);
  console.log(`  E_final   = ${E_final.toExponential(6)}`);
  console.log(`  E_min, E_max = [${Emin.toExponential(4)}, ${Emax.toExponential(4)}]`);
  console.log(`  max drift = ${drift_max.toExponential(3)}  (relative: ${drift_rel.toExponential(3)})`);
  console.log(`  final drift = ${drift_final.toExponential(3)}`);
  console.log(`  Newton: max iters across step = ${maxIter}, frames with non-converged = ${failedConverges}/${nFrames}`);
  if(opts && opts.expected){
    console.log(`  EXPECTATION: ${opts.expected}`);
  }
  return { E0, E_final, Emin, Emax, drift_max, drift_rel, drift_final, maxIter, failedConverges };
}

function initSmallVelocityKick(rope){
  // Straight chain, tiny θ̇ on joint 0 only.
  rope.theta.fill(0);
  rope.thetaDot.fill(0);
  rope.thetaDot[0] = 0.01;
}

function initThetaOffset(rope){
  // Single bent joint, no velocity.
  rope.theta.fill(0);
  rope.theta[Math.floor(rope.Ns / 2)] = 0.1;
  rope.thetaDot.fill(0);
}

function initSmoothMode(rope){
  // Sinusoidal θ across joints, no velocity.  Excites a mid-frequency
  // bending mode cleanly.
  const Ns = rope.Ns;
  for(let j = 0; j < Ns; j++){
    rope.theta[j] = 0.05 * Math.sin((Math.PI * (j + 0.5)) / Ns);
  }
  rope.thetaDot.fill(0);
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

const Ns_test = 10;
const L_test  = (550 * 0.45) / Ns_test;
const m_test  = 1 / Ns_test;
const h_test  = 1 / 60 / 16;        // matches alex2-physics.js production h_sub

console.log('================================================================');
console.log('Alex2 Energy-Conservation Test');
console.log('================================================================');
console.log('Conservative limit: α=0, c=0, no anchor input.  Implicit midpoint');
console.log('(γ=0.5) should conserve E to machine precision; implicit Euler');
console.log('(γ=1.0) should monotonically dissipate.  Any growth is a bug.');
console.log('================================================================');

console.log('\n############ Pass 1: SIMPLIFIED_PHYSICS = true ############');
SIMPLIFIED_PHYSICS = true;
DAMPING_BEND = 0;
VISCOUS_DRAG = 0;

BENDING_EI = 0;
runEnergyTest(
  'Free chain (no bending), midpoint, small velocity kick',
  Ns_test, L_test, m_test, 'midpoint', 0.5, h_test, 600,
  initSmallVelocityKick,
  { expected: 'E flat to machine precision (purely kinetic, conserved exactly under midpoint).' }
);

BENDING_EI = 100;
runEnergyTest(
  'With bending, midpoint, single θ offset',
  Ns_test, L_test, m_test, 'midpoint', 0.5, h_test, 600,
  initThetaOffset,
  { expected: 'E flat (kinetic + linear bending potential, midpoint conserves).' }
);

runEnergyTest(
  'With bending, midpoint, smooth mode init',
  Ns_test, L_test, m_test, 'midpoint', 0.5, h_test, 600,
  initSmoothMode,
  { expected: 'E flat (mid-frequency mode, kinetic + linear bending).' }
);

runEnergyTest(
  'With bending, EULER (for contrast), smooth mode init',
  Ns_test, L_test, m_test, 'euler', 1.0, h_test, 600,
  initSmoothMode,
  { expected: 'E monotonically decreases (implicit Euler is L-stable, dissipates).' }
);

console.log('\n############ Pass 2: SIMPLIFIED_PHYSICS = false (full M(θ) + Coriolis + nonlinear bending) ############');
SIMPLIFIED_PHYSICS = false;
DAMPING_BEND = 0;
VISCOUS_DRAG = 0;

BENDING_EI = 0;
runEnergyTest(
  'Free chain (no bending), midpoint, small velocity kick',
  Ns_test, L_test, m_test, 'midpoint', 0.5, h_test, 600,
  initSmallVelocityKick,
  { expected: 'E flat to machine precision.  Tests M(θ) + Coriolis consistency.' }
);

BENDING_EI = 100;
runEnergyTest(
  'With nonlinear bending, midpoint, single θ offset',
  Ns_test, L_test, m_test, 'midpoint', 0.5, h_test, 600,
  initThetaOffset,
  { expected: 'E flat.  Tests M(θ) + Coriolis + nonlinear bending potential consistency.' }
);

runEnergyTest(
  'With nonlinear bending, midpoint, smooth mode init',
  Ns_test, L_test, m_test, 'midpoint', 0.5, h_test, 600,
  initSmoothMode,
  { expected: 'E flat (mid-frequency mode, full physics).' }
);

runEnergyTest(
  'With nonlinear bending, EULER, smooth mode init',
  Ns_test, L_test, m_test, 'euler', 1.0, h_test, 600,
  initSmoothMode,
  { expected: 'E monotonically decreases (Euler dissipation).' }
);

console.log('\n================================================================');
console.log('Done.');
console.log('================================================================');
