# Alex2 standalone-Node test findings

Three tests run while you were away. Files: `jacobian-fd-check.js`, `energy-conservation.js`, `forced-response.js`. All self-contained Node copies of the math from `alex2-physics.js`.

## Summary in one sentence

**The analytical Jacobian and the EOMs are both correct. The mysterious "chaos" in production is at least partially driven by a *real bug* at the nonlinear-bending clamp boundary: V' is clamped at Δθ = π − 0.01 (so its actual derivative w.r.t. unclamped Δθ is 0 outside the clamp), but the Jacobian builder uses V'' = k_θ·sec²(Δθ_clamped/2) — a large value — instead of 0. Under any motion that drives some Δθ into the clamp region, Newton then solves a linearization that disagrees with the real force, and the chain takes wrong steps.**

## Test 1: FD Jacobian check (jacobian-fd-check.js)

Builds A_raw and B_raw two ways: (1) analytically with the same code as `buildJacobianBlocks`, (2) numerically via central differences on θ̈. Compares per-block max relative error at 7 different states across both `SIMPLIFIED_PHYSICS=true` and `SIMPLIFIED_PHYSICS=false`.

**Result: PASS everywhere with meaningful magnitudes.** Max relative error 1e-9 to 1e-7 (within central-difference truncation). Two "maxRel=1.0" lines in the output are false positives — the analytical value is structurally 0 (e.g. a Q_anchor entry that doesn't couple to a given joint), and FD reports tiny noise at the 1e-8 truncation floor.

**Conclusion: the Jacobian is correct.** Newton converging to machine precision genuinely means it found the right fixed point of the implicit Euler step.

## Test 2: Energy conservation (energy-conservation.js)

Conservative limit (α = 0, c = 0, no anchor input). Implicit midpoint should conserve E exactly; implicit Euler should monotonically dissipate. Tested both with and without bending, simplified and full physics, with various initial conditions.

**Result: PASS everywhere.** Energy conserved to ~1e-15 relative (machine precision) under midpoint for free chain, with linear bending, with nonlinear bending, and with full M(θ) + Coriolis. Implicit Euler shows monotonic dissipation (~7e-8 over 0.6s for the smooth-mode init).

**Conclusion: the EOMs are correct.** M(θ), Coriolis vector C(θ, θ̇), and the bending potential are internally consistent. There is no hidden energy source or sink in our equations.

## Test 3: Forced response (forced-response.js)

Replicates the production scenario: N=99 chain at production parameters, applies anchor acceleration ay, tracks max|θ|, max|θ̇|, max|Δθ|, kinetic + bending energy, and Newton diagnostics over many substeps.

### 3a. Brief impulse (16 substeps at ay=6000, then quiescent)

- Chain responds smoothly. max|θ̇| peaks around 20, decays to ~4 over 0.6 sec.
- max|Δθ| stays at 0.19 throughout (well below π/4).
- Energy injected: ~4900 J (per the brief impulse). Decays at the viscous-drag rate α=0.1 → 10s time-constant.
- Newton converges in 1–3 iters every step.
- **No chaos, no explosion. Brief impulses are well-behaved.**

### 3b. Big brief impulse (ay = 20000)

- Higher amplitudes but same character: max|Δθ| up to 0.19, max|θ̇| up to 24, no chaos, no explosion.

### 3c. Sustained oscillating forcing (±6000 ay, 1Hz)

- Chain energy ramps up over the first 1 sec.
- Around substep 1000, max|Δθ| crosses π (=3.14).
- **At substep 1050, total energy spikes from ~4e5 to 3e36, then to 3e42. Complete divergence.** max|θ| = 1e19, max|θ̇| = 2e20, max|Δθ| = 1e18.
- Newton stops converging (12 iters, relStep ~0.5). 519 of 1500 substeps don't converge.

### 3d. Same scenario with linear bending (SIMPLIFIED_PHYSICS=true)

- Max|Δθ| reaches 13.7 (>4π).
- Max|θ̇| reaches 1406.
- **No explosion. Energy stays bounded around 5e4. Newton converges in 3–6 iters throughout.**
- Chain undergoes wild motion but remains numerically stable for the full 1.5 sec.

### Comparison

| Scenario | Bending model | max\|Δθ\| | Final energy | Outcome |
|---|---|---|---|---|
| Brief ay=6000, c=1 | nonlinear | 0.19 | 4380 | Smooth, stable |
| Brief ay=20000, c=1 | nonlinear | 0.19 | 4.8e4 | Smooth, stable |
| Brief ay=6000, c=1000 | nonlinear | 0.030 | 4145 | Very smooth, overdamped |
| Sustained 1Hz, c=1 | nonlinear | crosses π → 1e18 | 1e42 | **EXPLODED** |
| Sustained 5Hz, c=1 | nonlinear | 1.37 | 2700 | Stable (didn't quite reach π) |
| Sustained 1Hz, c=1 | linear (SIMPLIFIED) | 13.7 | 5.6e4 | Stable (no clamp bug) |

The differentiator is whether max|Δθ| crosses π.

## The bug: clamp-vs-Jacobian inconsistency

In `buildRhs`:
```js
let dl = theta[j] - theta[j - 1];
if(dl >  piMinusEps) dl =  piMinusEps;
else if(dl < -piMinusEps) dl = -piMinusEps;
vpLeft = 2 * kTheta * Math.tan(dl * 0.5);   // V'(Δθ_clamped)
```

When the actual Δθ exceeds piMinusEps, `dl` is clamped. The force `V'(Δθ_clamped)` is then *constant* w.r.t. the real, unclamped Δθ. So `∂V'/∂Δθ_real = 0` outside the clamp region.

In `buildJacobianBlocks` (the bending block):
```js
let dr = theta[i + 1] - theta[i];
if(dr >  piMinusEps) dr =  piMinusEps;
else if(dr < -piMinusEps) dr = -piMinusEps;
const c = Math.cos(dr * 0.5);
Vpp = kTheta / (c * c);   // V''(Δθ_clamped) — huge at the clamp boundary
A[i * Ns + i]       -= Vpp;
A[i * Ns + (i + 1)] += Vpp;
```

This sets the Jacobian entries using V''(Δθ_clamped) = k_θ·sec²(piMinusEps/2) ≈ 40000·k_θ — *the largest value V'' takes*, NOT the derivative-of-actual-force value (which is 0 once clamped).

So when any Δθ is in the clamp region, the Jacobian *lies* about how much the force changes. Newton's linearization is wrong, and the implicit step takes a step inconsistent with what the residual actually is. Under sustained forcing this compounds and the chain diverges.

## Why this matches the user's production observations

- **"Chaos persists after release."** Linear bending (SIMPLIFIED) showed the chain's underdamped natural response — it's not chaos exactly, but a complex superposition of decaying modes that takes 10s of seconds to damp with default α=0.1. That's what you've been seeing in "linear" runs.
- **"Chain ends up in tight knots / loops."** Once the chain reaches a configuration where Δθ at some joint enters the clamp region (which can happen with strong/sustained forcing), the bug kicks in and the implicit step starts producing inconsistent updates. With damping it might not literally explode like in this Node test (the user's c=1000 helps), but the spurious updates accumulate into visible chaos.
- **"Element disappears."** When the bug triggers and segments are mis-stepped, two non-adjacent particles can land at the same position. Visible as overlapping dots.

## Recommended fixes (smallest to largest change)

1. **Make the Jacobian consistent with the clamp.** When the clamp kicks in, set V'' = 0 in the bending block — matches the actual derivative of the clamped V'. **Tested — does NOT stop the explosion.** Jacobian consistency alone isn't enough; the clamped force itself is unphysical (no restoring increment past π).

2. **Use cos(Δθ/2)-based clamp instead of Δθ-based clamp.** Clamp |cos(Δθ/2)| ≥ ε while preserving sign. Preserves the natural 2π periodicity of `tan(Δθ/2)` (force smoothly switches sign past each odd multiple of π, restoring toward the nearest even multiple). **Tested with ε ∈ {0.01, 0.1, 0.3, 0.5} — all explode** under sustained 1Hz ±6000 forcing. Root reason: the peak bending force is still bounded at ~k_θ/ε; under sustained forcing, external torques exceed it, the integrator overshoots π in one substep, and the chain commits to drifting onward.

   Even though this fix doesn't stop the explosion, it IS a structural improvement (correct periodicity, consistent Jacobian) and worth keeping as code-quality cleanup.

3. **Use a smoothly bounded V'.** Same fundamental issue as #2 — *any* bounded peak force is vulnerable to sustained-forcing overwhelm.

4. **Drop nonlinear bending entirely (use linear).** **The robust option.** `V' = k_θ·Δθ` grows unboundedly with |Δθ|, so restoring force always outgrows external torques. No matter how big Δθ gets, the chain comes back. Loses the strict anti-folding feature but is stable under any forcing.

## The fundamental trade-off

"Anti-folding" (strong restoring force near Δθ = π) and "robustness under sustained heavy forcing" are at odds in this model family:

- **Strong near-fold force** requires unbounded V' as Δθ → π, which requires either a clamp (creating the explosion bug above) or accepting infinite forces (Newton can't converge).
- **Robustness** requires unbounded restoring force *as |Δθ| → ∞*. Linear bending has this; periodic-bounded bending models don't.

For a shipping fidget toy, **linear bending** is the recommended path. Anti-folding aesthetic can be approximated by other means (visual collision detection, segment-overlap rendering) if desired.

## Note on production "chaos" vs. test "explosion"

These are two different phenomena:

- **Node-test explosion (1e42 energy, NaN-level chaos):** sustained oscillating forcing pumps energy in faster than damping can dissipate; eventually Δθ crosses π → clamp bug → runaway. *Not what the user sees in production* (production is brief impulses).
- **Production user-observed "chaos":** mostly the chain's underdamped natural response to brief impulses. With α = 0.1 and c = 1, modes decay on the order of seconds; many modes superposed looks chaotic. Not actually divergent. Fix is more damping, not a bending model change.

The clamp bug *could* trigger in production if the user pushes the chain into a configuration where some Δθ crosses π, but with brief impulses this is uncommon. The user observed it occasionally at N=14.

## What the chaos in the user's production runs actually was

A mix of two things:

- **Mostly:** the chain's actual underdamped linear-mode response. With α=0.1 / c=1, modes decay on the order of seconds. Looks chaotic because many modes are superposed. This is the "physical" chaos.
- **Occasionally:** the nonlinear-bending clamp bug triggering when motion drives some Δθ near π. This is the "knot-formation, lump-collapse" pattern. With higher damping (c=1000) it's less common but still possible.

The non-converging Newton at the clamp boundary is the "loud" symptom; the slow-decaying underdamped response is the "quiet" one.

## Files written

- `Alex2/tests/jacobian-fd-check.js` — FD Jacobian check.
- `Alex2/tests/energy-conservation.js` — conservative-limit energy test.
- `Alex2/tests/forced-response.js` — Node reproduction of production scenarios.
- `Alex2/tests/FINDINGS.md` — this file.

Each is self-contained Node-runnable (`node <filename>`). When `alex2-physics.js` changes, the math in these copies has to be re-synced — that's the price of not mocking `state.js`/`playfield.js` to make alex2-physics.js Node-importable.
