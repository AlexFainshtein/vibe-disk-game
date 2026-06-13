// Long-duration energy + Newton-convergence test that mirrors current
// production: linear bending, full M(θ) + Coriolis + viscous drag +
// strain-rate damping, implicit midpoint (γ=0.5).
//
// Scenario: spin the chain up with a brief intense ay impulse, then
// release (no anchor input) and run for many seconds.  Track energy
// and Newton convergence to see whether:
//   (A) energy decays smoothly (chain reaches rest)
//   (B) energy stays flat (integrator violating dissipation)
//   (C) Newton fails to converge in the chaotic regime
//
// Run: node energy-long-midpoint.js

'use strict';

// === Constants (match production alex2-physics.js) ===
const BENDING_EI         = 100;
const DAMPING_BEND       = 1;
const VISCOUS_DRAG       = 0.1;
const NEWTON_MAX_ITERS   = 12;
const NEWTON_TOL         = 1e-8;

// === Math (1:1 copy of current production code) ===

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
  const Ns = rope.Ns, L = rope.segmentLength, m = rope.particleMass, M = rope.M, L2 = L * L;
  for(let j = 0; j < Ns; j++){
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      M[j * Ns + k] = L2 * Math.cos(theta[j] - theta[k]) * mu;
    }
  }
}

function buildRhs(rope, theta, thetaDot, ax, ay){
  const Ns = rope.Ns, L = rope.segmentLength, m = rope.particleMass;
  const muDiag = rope.muDiag, rhs = rope.rhs, L2 = L * L;
  const kTheta = BENDING_EI / L;
  for(let j = 0; j < Ns; j++){
    let qAnchor = L * muDiag[j] * (Math.sin(theta[j]) * ax - Math.cos(theta[j]) * ay);
    let cj = 0;
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      cj += L2 * mu * Math.sin(theta[j] - theta[k]) * thetaDot[k] * thetaDot[k];
    }
    let qDamp = 0;
    if(Ns >= 2){
      let lapThetaDot;
      if(j === 0) lapThetaDot = thetaDot[1] - thetaDot[0];
      else if(j === Ns - 1) lapThetaDot = thetaDot[Ns - 2] - thetaDot[Ns - 1];
      else lapThetaDot = thetaDot[j - 1] - 2 * thetaDot[j] + thetaDot[j + 1];
      qDamp = DAMPING_BEND * lapThetaDot;
    }
    let qBend = 0;
    if(Ns >= 2 && BENDING_EI !== 0){
      let lapTheta;
      if(j === 0) lapTheta = theta[1] - theta[0];
      else if(j === Ns - 1) lapTheta = theta[Ns - 2] - theta[Ns - 1];
      else lapTheta = theta[j - 1] - 2 * theta[j] + theta[j + 1];
      qBend = kTheta * lapTheta;
    }
    rhs[j] = qAnchor - cj + qBend + qDamp;
  }
}

function gaussSolve(N, A, b, x){
  for(let p = 0; p < N; p++){
    let pivotRow = p, pivotMag = Math.abs(A[p * N + p]);
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
    if(Math.abs(pivot) < 1e-12){ for(let i = 0; i < N; i++) x[i] = 0; return; }
    for(let r = p + 1; r < N; r++){
      const factor = A[r * N + p] / pivot;
      if(factor === 0) continue;
      for(let c = p; c < N; c++) A[r * N + c] -= factor * A[p * N + c];
      b[r] -= factor * b[p];
    }
  }
  for(let i = N - 1; i >= 0; i--){
    let sum = b[i];
    for(let c = i + 1; c < N; c++) sum -= A[i * N + c] * x[c];
    x[i] = sum / A[i * N + i];
  }
}

function buildJacobianBlocks(rope, theta, thetaDot, ddt, ax, ay){
  const Ns = rope.Ns, L = rope.segmentLength, m = rope.particleMass;
  const muDiag = rope.muDiag, L2 = L * L, kTheta = BENDING_EI / L;
  const A = rope.A_raw, B = rope.B_raw, M = rope.M_snap;
  const w = rope.tmpNs, S = rope.tmpNs2;
  A.fill(0); B.fill(0);
  for(let i = 0; i < Ns; i++) w[i] = VISCOUS_DRAG * thetaDot[i] + ddt[i];
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++){
      const mu = (Ns - Math.max(i, j)) * m;
      s += L2 * mu * Math.sin(theta[i] - theta[j]) * w[j];
    }
    S[i] = s;
  }
  for(let k = 0; k < Ns; k++){
    const tdk2 = thetaDot[k] * thetaDot[k];
    A[k * Ns + k] += L * muDiag[k] * (Math.cos(theta[k]) * ax + Math.sin(theta[k]) * ay);
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
  if(BENDING_EI !== 0 && Ns >= 2){
    for(let i = 0; i < Ns; i++){
      if(i < Ns - 1){
        A[i * Ns + i] -= kTheta;
        A[i * Ns + (i + 1)] += kTheta;
      }
      if(i > 0){
        A[i * Ns + i] -= kTheta;
        A[i * Ns + (i - 1)] += kTheta;
      }
    }
  }
  for(let j = 0; j < Ns; j++){
    for(let mm = 0; mm < Ns; mm++){
      const muJM = (Ns - Math.max(j, mm)) * m;
      B[j * Ns + mm] -= 2 * L2 * muJM * Math.sin(theta[j] - theta[mm]) * thetaDot[mm];
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

function implicitStep(rope, h, ax, ay, gamma){
  const Ns = rope.Ns, theta = rope.theta, thetaDot = rope.thetaDot;
  const thetaN = rope.thetaN, thetaDotN = rope.thetaDotN;
  const thetaNew = rope.thetaNew, thetaDotNew = rope.thetaDotNew;
  const thetaEval = rope.thetaEval, thetaDotEval = rope.thetaDotEval;
  const ddtEval = rope.ddtEval, F_theta = rope.F_theta, F_thetaDot = rope.F_thetaDot;
  const dTheta = rope.dTheta, dThetaDot = rope.dThetaDot;
  const A = rope.A_raw, B = rope.B_raw, K = rope.K, Krhs = rope.Krhs;
  const Msnap = rope.M_snap;
  thetaN.set(theta); thetaDotN.set(thetaDot);
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
    thetaNew[i] = thetaN[i] + h * thetaDotN[i];
    thetaDotNew[i] = thetaDotN[i] + h * rope.accel[i];
  }
  const oneMinusGamma = 1 - gamma, hg = h * gamma, hg2 = hg * hg, invHg = 1 / hg;
  let converged = false, iters = 0, lastRel = 0;
  for(let iter = 0; iter < NEWTON_MAX_ITERS; iter++){
    iters = iter + 1;
    for(let i = 0; i < Ns; i++){
      thetaEval[i] = oneMinusGamma * thetaN[i] + gamma * thetaNew[i];
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
      F_theta[i] = thetaNew[i] - thetaN[i] - h * thetaDotEval[i];
      F_thetaDot[i] = thetaDotNew[i] - thetaDotN[i] - h * ddtEval[i];
    }
    buildJacobianBlocks(rope, thetaEval, thetaDotEval, ddtEval, ax, ay);
    const Ns2 = Ns * Ns;
    for(let i = 0; i < Ns2; i++) K[i] = Msnap[i] - hg * B[i] - hg2 * A[i];
    for(let i = 0; i < Ns; i++){
      let mTheta = 0, mThetaDot = 0, bTheta = 0;
      for(let j = 0; j < Ns; j++){
        mTheta += Msnap[i * Ns + j] * (-F_theta[j]);
        mThetaDot += Msnap[i * Ns + j] * (-F_thetaDot[j]);
        bTheta += B[i * Ns + j] * (-F_theta[j]);
      }
      Krhs[i] = mTheta + hg * mThetaDot - hg * bTheta;
    }
    gaussSolve(Ns, K, Krhs, dTheta);
    let dNorm2 = 0, yNorm2 = 0;
    for(let i = 0; i < Ns; i++){
      dThetaDot[i] = invHg * (dTheta[i] + F_theta[i]);
      thetaNew[i] += dTheta[i];
      thetaDotNew[i] += dThetaDot[i];
      dNorm2 += dTheta[i] * dTheta[i] + dThetaDot[i] * dThetaDot[i];
      yNorm2 += thetaNew[i] * thetaNew[i] + thetaDotNew[i] * thetaDotNew[i];
    }
    const denom = Math.max(Math.sqrt(yNorm2), 1);
    lastRel = Math.sqrt(dNorm2) / denom;
    if(lastRel < NEWTON_TOL){ converged = true; break; }
  }
  theta.set(thetaNew); thetaDot.set(thetaDotNew);
  return { converged, iters, lastRel };
}

// === Energy ===

function computeEnergy(rope){
  const Ns = rope.Ns;
  buildMassMatrix(rope, rope.theta);
  let Ek = 0;
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++) s += rope.M[i * Ns + j] * rope.thetaDot[j];
    Ek += rope.thetaDot[i] * s;
  }
  Ek *= 0.5;
  let V = 0;
  const L = rope.segmentLength, kTheta = BENDING_EI / L;
  if(BENDING_EI !== 0 && Ns >= 2){
    for(let j = 0; j < Ns - 1; j++){
      const dx = rope.theta[j + 1] - rope.theta[j];
      V += 0.5 * kTheta * dx * dx;
    }
  }
  return { Ek, V, total: Ek + V };
}

function chainStats(rope){
  const Ns = rope.Ns;
  let maxTheta = 0, maxThetaDot = 0, maxDtheta = 0;
  for(let j = 0; j < Ns; j++){
    if(Math.abs(rope.theta[j]) > maxTheta) maxTheta = Math.abs(rope.theta[j]);
    if(Math.abs(rope.thetaDot[j]) > maxThetaDot) maxThetaDot = Math.abs(rope.thetaDot[j]);
  }
  for(let j = 0; j < Ns - 1; j++){
    const d = Math.abs(rope.theta[j + 1] - rope.theta[j]);
    if(d > maxDtheta) maxDtheta = d;
  }
  return { maxTheta, maxThetaDot, maxDtheta };
}

// === Scenarios ===

function runScenario(label, Ns, L, m, gamma, h_sub, forcingFn, totalFrames, snapshotEvery){
  const rope = makeRope(Ns, L, m);
  console.log(`\n=== ${label} ===`);
  console.log(`  Ns=${Ns}, L=${L.toFixed(3)}, m=${m.toFixed(4)}, h_sub=${h_sub.toFixed(6)}, γ=${gamma}`);
  console.log(`  Total substeps: ${totalFrames}, total time: ${(totalFrames * h_sub).toFixed(2)}s`);
  console.log(`  Damping: BEND=${DAMPING_BEND}, MASS=${VISCOUS_DRAG}, BENDING_EI=${BENDING_EI}`);
  console.log(`\n  ${'substep'.padStart(8)} ${'time(s)'.padStart(8)} ${'maxθ'.padStart(10)} ${'maxθ̇'.padStart(12)} ${'maxΔθ'.padStart(10)} ${'Ek'.padStart(11)} ${'V'.padStart(11)} ${'E_total'.padStart(11)} ${'iters'.padStart(6)} ${'relStep'.padStart(10)} ${'conv'.padStart(5)}`);
  let totalIters = 0, nonConvergeCount = 0, maxIterSeen = 0;
  for(let s = 0; s < totalFrames; s++){
    const [ax, ay] = forcingFn(s, h_sub);
    const r = implicitStep(rope, h_sub, ax, ay, gamma);
    totalIters += r.iters;
    if(r.iters > maxIterSeen) maxIterSeen = r.iters;
    if(!r.converged) nonConvergeCount++;
    if(s % snapshotEvery === 0 || s === totalFrames - 1){
      const E = computeEnergy(rope);
      const stats = chainStats(rope);
      console.log(`  ${String(s).padStart(8)} ${(s*h_sub).toFixed(3).padStart(8)} ${stats.maxTheta.toExponential(3).padStart(10)} ${stats.maxThetaDot.toExponential(3).padStart(12)} ${stats.maxDtheta.toExponential(3).padStart(10)} ${E.Ek.toExponential(3).padStart(11)} ${E.V.toExponential(3).padStart(11)} ${E.total.toExponential(3).padStart(11)} ${String(r.iters).padStart(6)} ${r.lastRel.toExponential(2).padStart(10)} ${(r.converged ? 'Y' : 'N').padStart(5)}`);
    }
  }
  console.log(`\n  Summary: max iters=${maxIterSeen}, non-converged=${nonConvergeCount}/${totalFrames}, avg iters=${(totalIters/totalFrames).toFixed(2)}`);
  const E_final = computeEnergy(rope);
  console.log(`           E_final: Ek=${E_final.Ek.toExponential(3)}  V=${E_final.V.toExponential(3)}  total=${E_final.total.toExponential(3)}`);
}

// === Main ===

const W = 550;
const h_sub = 1 / 60 / 16;

console.log('================================================================');
console.log('Alex2 long-duration energy + Newton test (γ=0.5 midpoint, prod physics)');
console.log('================================================================');

// Scenario 1: N=14 chain (matches user's chaos N=13 + anchor), spin up
// with brief intense ay impulse, then quiescent for 30s.  Watch energy and
// Newton convergence.
{
  const Ns = 13;
  const L = W * 0.45 / Ns;
  const m = 1 / Ns;
  runScenario('N=14 chain, brief 16-substep impulse ay=8000, then 30s quiescent',
    Ns, L, m, 0.5, h_sub,
    (s) => s < 16 ? [0, 8000] : [0, 0],
    Math.round(30 / h_sub),  // 30 seconds
    Math.round(1 / h_sub));  // snapshot once per second
}

// Scenario 2: Same N=14 but with HEAVY sustained forcing to drive into
// chaotic regime, then release at 1s.  Watch what happens over next 30s.
{
  const Ns = 13;
  const L = W * 0.45 / Ns;
  const m = 1 / Ns;
  const releaseAt = Math.round(1 / h_sub);
  const totalSteps = Math.round(30 / h_sub);
  runScenario('N=14 chain, 1s of sustained oscillating ay (±6000, 5Hz), then 29s quiescent',
    Ns, L, m, 0.5, h_sub,
    (s) => {
      if(s >= releaseAt) return [0, 0];
      const halfPeriod = Math.round(1 / 60 / 16 * 16 * 6);  // ~5 Hz
      return [0, (Math.floor(s / halfPeriod) % 2 === 0) ? 6000 : -6000];
    },
    totalSteps,
    Math.round(1 / h_sub));
}

// Scenario 3: N=99 (production size), same kind of spin-up.
{
  const Ns = 99;
  const L = W * 0.45 / Ns;
  const m = 1 / Ns;
  runScenario('N=100 chain, brief 16-substep impulse ay=6000, then 10s quiescent',
    Ns, L, m, 0.5, h_sub,
    (s) => s < 16 ? [0, 6000] : [0, 0],
    Math.round(10 / h_sub),
    Math.round(1 / h_sub));
}

console.log('\n================================================================');
console.log('Done.');
console.log('================================================================');
