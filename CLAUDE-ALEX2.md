# CLAUDE-ALEX2.md

Alex2's variant of the Vibe Disk Game — a **rope/chain physics sandbox** in reduced (joint-angle) coordinates. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls).

Alex2 is the second of Alex's chain experiments. The first variant (see git history — branch `Alex2: new variant — Verlet rope sandbox with adaptive XPBD constraint solver`) used Verlet + position-based dynamics. This one explores the *Lagrangian / reduced-coordinate* approach instead: each rope is parameterized by its N−1 joint angles, distance constraints are exact by construction, and the equations of motion come from analytical mechanics rather than constraint projection.

## Entry page

- [alex2.html](Alex2/alex2.html) — sets `<body data-player="alex2">` so [main.js](main.js) dynamically imports `alex2-physics.js`. Single button in `#panel`: Reset. The disk and bar are deliberately disabled (`bar.hidden = true`, `inputHooks.diskGrab = false`, `setDiskRadiusFraction(0)`); the playfield exists only as a backdrop for the chain.

## What Alex2 is

Drag the small anchor dot to whip the chain around. The chain hangs from the anchor; all motion in the chain comes from anchor motion plus the chain's own dynamics (no gravity in this variant — that's an obvious add-on, deliberately left off so the dynamics tester sees only the spring/Coriolis/bending behavior).

A single chain is drawn by default (`N = 100`). The factory `makeRope` and the array-of-ropes structure are kept so the variant can be extended to a multi-rope comparison view (e.g. N=50 vs N=100, same anchor input) by pushing additional `makeRope(...)` calls into the `ropes` array — useful for verifying N-invariance after future integrator changes.

Input:
- **Mouse drag** on the anchor dot — smooth continuous driving.
- **Arrow keys** — bounded velocity impulse (`ANCHOR_KEY_VELOCITY_STEP` px/s per press) delivered as an instantaneous angular-momentum kick to the chain.

## Physics model

Each chain is parameterized by N−1 joint angles `θ_k` (one per segment). The state vector is `[θ, θ̇]`, total 2(N−1) components. Distance constraints are exact: every segment has length L, no stretching is possible by construction.

The Lagrangian equations of motion are
```
M(θ) · θ̈ + C(θ, θ̇) = Q_anchor + Q_bend + Q_damp
```

with
```
M_{jk}(θ) = L² · cos(θ_j − θ_k) · μ_{jk}            (mass matrix, dense, SPD)
C_j(θ, θ̇) = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²  (Coriolis vector — see note below)
Q_anchor_j = L · μ_{jj} · (sin θ_j · ẍ_anchor − cos θ_j · ÿ_anchor)
μ_{jk}     = Σ_{i ≥ max(j,k)} m_i                   (lumped mass; uniform → (Ns − max(j,k))·m)
```

**Bending** is **linear**: V_pair(Δθ) = (1/2)·k_θ·Δθ², so `V'(Δθ) = k_θ·Δθ` with `k_θ = BENDING_EI / L`. The generalized bending force on θ_j is the discrete Laplacian `k_θ·(θ_{j−1} − 2·θ_j + θ_{j+1})` with Neumann (free-end) boundary conditions.

We previously had a nonlinear anti-folding model with `V'(Δθ) = 2·k_θ·tan(Δθ/2)` plus a Δθ-based clamp near ±π, intended to prevent the rope from passing through itself. It turned out to be **physically wrong** — the periodic tan(Δθ/2) form gave the bending force a sign-flip past every odd multiple of π (force "aiding" rather than "restoring"), which under sustained heavy forcing caused runaway in the integrator. Real bending energy isn't periodic in Δθ — winding around adds energy. Linear bending captures this correctly and is robust under any forcing. We accept that loops can form as a consequence; if anti-folding behavior is desired later, the right form is linear + a non-periodic soft barrier (e.g. `β·exp(c·(|Δθ| − π_max))`), NOT a periodic tan-based form. See [Alex2/tests/FINDINGS.md](Alex2/tests/FINDINGS.md) for the diagnosis.

**Strain-rate damping** is the linear discrete Laplacian on θ̇ (same Neumann BCs): pulls each joint's angular velocity toward its neighbors'. Zero effect on rigid rotation (all θ̇ equal → Laplacian = 0), suppresses high-frequency / alternating-sign modes exponentially. Coefficient `DAMPING_BEND`.

**Mass damping** subtracts `DAMPING_MASS · θ̇` from θ̈ each frame — slowly bleeds off bulk rotation. Set to 0 to coast indefinitely.

### Naming note: Coriolis vs centrifugal

We call the `C` vector "Coriolis" in the code, following the robotics/multibody-dynamics convention where the lumped `C(q,q̇)·q̇` vector is named that way. **Physically the term is centrifugal**, not Coriolis: it is quadratic in a *single* angular velocity at each k (`θ̇_k²`), and Coriolis forces are bilinear in *two distinct* velocities. The actual Coriolis-character coupling in this system lives in the cross term of the kinetic energy (`m·ȧ_anchor · L·R(θ_k)·θ̇_k`, bilinear in anchor velocity and segment angular velocity), where the anchor-velocity × segment-rotation pairing has the textbook Coriolis structure. In the 2D pure-translation case, the Euler-Lagrange algebra collapses that cross term into the `Q_anchor` acceleration coupling we have, so no explicit anchor-velocity term appears in the EOM — the Coriolis character is structural (which variables couple), not necessarily a separate surviving term. **Code keeps the conventional name; this note records the physical reading.**

## Integration

**Active integrator: implicit midpoint** (γ = 0.5), selected by `INTEGRATOR = 'implicit-midpoint'`. The scheme is γ-parametrized: γ = 0.5 gives the symplectic implicit midpoint (default — A-stable, symmetric, conserves quadratic invariants → bounded energy error), γ = 1.0 gives L-stable implicit Euler (adds artificial high-frequency damping). Explicit RK4 (`INTEGRATOR = 'rk4'`) is kept as the legacy path for comparison; it was the original default but is fragile to stiff forcing (see Known limitations).

Each substep solves the implicit update `F(y_{n+1}) = 0` for `y = [θ, θ̇]` with Newton's method (`NEWTON_MAX_ITERS = 8`, `NEWTON_TOL = 1e-6`). Each Newton iteration builds M, the Coriolis vector, and the Jacobian blocks at the evaluation state (O(N²)), then solves a dense Ns×Ns system by Gaussian elimination with partial pivoting (O(N³)). Cost is therefore (Newton iters) × (1 build + 1 solve) per substep. At N=100 with 32 substeps this is the dominant frame cost — **performance is borderline (~10–20 fps) and is the main open issue** (see Known limitations).

**Newton initial guess — warm start** (`NEWTON_WARM_START`, default true): each substep seeds Newton from the *previous converged substep's realized increment*, `y⁰ = yₙ + Δy_prev`, instead of one explicit-Euler step `y⁰ = yₙ + h·f(yₙ)`. Δy_prev is bounded physical motion, so it cannot overshoot Newton's convergence basin the way `h·θ̈` can once θ̈ is large — which is exactly the failure mechanism diagnosed below. Falls back to explicit Euler when no prior increment exists (first substep after Reset, an arrow-key impulse, or a non-converged step — all of which invalidate the stored increment). Bonus: the warm path skips the explicit-Euler build+solve, saving one O(N³) solve per substep.

**Internal substepping** (`IMPLICIT_SUBSTEPS_PER_FRAME = 32`): each real frame takes that many implicit substeps of size `h / 32`. Total physics time per real frame is unchanged (= h), so anchor and chain stay in lockstep — no anchor-vs-chain time mismatch. 32 is the smallest count that holds at N=100 under deliberate hard mouse-driving with warm-start on; **16 still fails** (Known limitations). Refining h (more substeps) is one robustness lever, but per project direction we are *not* pursuing smaller h or adaptive stepping — see Future directions. RK4 uses `RK4_SUBSTEPS_PER_FRAME` instead.

### Smooth anchor delivery

Mouse-drag velocity changes are converted to a smooth anchor acceleration:
```
ax = Δv_x / h,   ay = Δv_y / h
```
which is passed to `Q_anchor` during the per-substep Newton evaluations (constant across the internal substeps within one real frame). This delivers the same total angular-momentum impulse but spreads it across the chain's integration, so the quadratic Coriolis term doesn't see a Δv-induced velocity jump at every substep. Without this smoothing, mouse impulses caused the chain to explode much more easily.

Arrow-key kicks bypass this entirely: they apply an exact angular-momentum impulse `M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δv_x − cos θ_j · Δv_y)` directly inside the keydown handler. Cheap and stable.

## Tunables (top of [alex2-physics.js](Alex2/alex2-physics.js))

| Constant | Default | Role |
|---|---|---|
| `N` | 100 | Number of particles in the chain (joints = N − 1) |
| `ROPE_LENGTH_FRACTION` | 0.45 | Chain's total length as a fraction of canvas width |
| `M_ROPE` | 1 | Total chain mass (excluding anchor) |
| `INTEGRATOR` | `'implicit-midpoint'` | Active integrator: `'implicit-midpoint'` (γ=0.5), `'implicit-euler'` (γ=1.0), or legacy `'rk4'` |
| `IMPLICIT_SUBSTEPS_PER_FRAME` | 32 | Implicit substeps per real frame; 32 holds at N=100, 16 fails |
| `NEWTON_WARM_START` | true | Seed Newton from previous substep's increment vs. explicit Euler (see Integration) |
| `NEWTON_MAX_ITERS` / `NEWTON_TOL` | 8 / 1e-6 | Per-substep Newton iteration cap and convergence tolerance |
| `RK4_SUBSTEPS_PER_FRAME` | 16 | Substeps for the legacy RK4 path only |
| `ANCHOR_KEY_VELOCITY_STEP` | 50 px/s | Arrow-key impulse magnitude |
| `BENDING_EI` | 100 | Continuum flexural rigidity; `k_θ = BENDING_EI / L` |
| `DAMPING_BEND` | 1 | Strain-rate (discrete Laplacian on θ̇) damping coefficient |
| `DAMPING_MASS` | 0.1 | Mass-proportional damping coefficient |

### Diagnostic flags (flip individually to investigate)

| Flag | What it logs |
|---|---|
| `NEWTON_LOG_ENABLED` | Per-frame per-substep Newton (iters, relStep, converged). **Gated to print only problem frames** — any substep that fails to converge (`converged < substeps`) or strains near the iter cap (≥ `NEWTON_MAX_ITERS − 2`); healthy frames stay silent. The headline `converged=X/Y` distinguishes a numerical failure (Newton diverged) from a physical one |
| `ENERGY_MONITOR` | E = ½ θ̇ᵀ M θ̇ per frame; spike/NaN warnings when E_new / E_prev > `E_SPIKE_RATIO`. An energy spike *with* Newton converged = legitimate forcing; *with* Newton failed = numerical breakdown |
| `THETA_LOG_ENABLED` | Buffers θ at three fixed joints per frame (silent); `window.alex2.dumpThetaLog()` downloads a CSV. `window.alex2.dumpFullState(label)` dumps all θ/θ̇ to CSV + JSON |
| `TRACE_ENABLED` | Per-frame θ_j values (head + tail) for `TRACE_DURATION_FRAMES`; stops on NaN |
| `CONDITION_ESTIMATE` | Spectral κ₂(M) via power iteration (λ_max) + inverse power iteration (λ_min). Confirmed M conditioning is **not** the cause of explosions — κ stayed ~1.5e4 throughout failures |
| `SUBSTEP_LOG_ENABLED` | Per-substep RHS and θ̈ for the first `SUBSTEP_LOG_HEAD` joints. **RK4 only** — `captureSubstep` is wired into `rk4Step`, not the implicit path, so it records nothing under implicit midpoint |
| `INPUT_LOG_ENABLED` | Per-frame anchor position / velocity / acceleration in px-per-frame units (same scale as L ≈ 4 px), gated alongside the trace so frame indices align with the substep log |

Most outputs go to the console; the θ / substep / input logs download as CSV (substep/input dump when tracing stops; θ on demand).

## Known limitations

- **Blow-up mechanism (diagnosed 2026-06, implicit midpoint)** — under hard forcing the chain can still NaN. The cause is **numerical, not physical**: at the blow-up frame Newton stops converging (`converged < substeps`, relStep ~ O(1)) *before* energy explodes, and the energy jumps ~10³⁰× in one frame — impossible for the bounded-energy physical system. Root cause is **Newton's initial guess overshooting its convergence basin**: large M⁻¹ → large θ̈ → the explicit-Euler guess `yₙ + h·θ̈` lands outside the basin → Newton diverges → spurious energy → self-reinforcing collapse (no recovery once it starts). Confirmed across two substep counts; conditioning of M is *not* involved (κ stayed ~1.5e4). **Warm start (above) is the fix** — it raises the failure threshold dramatically by seeding from bounded realized motion. It is a strict improvement but not a total cure: at 16 substeps deliberate hammering can still cross the (now much higher) threshold; **32 substeps + warm start held under deliberate abuse**. *Caveat:* part of 32's apparent robustness is a frame-rate confound — at ~10–20 fps the anchor lags the mouse, throttling how hard the chain can actually be driven; 16 runs faster, so it can be driven harder, which is one reason it fails where 32 doesn't.
- **Performance at N=100** — the per-substep Newton solve (O(N³) × iters × 32 substeps) drives the frame to ~10–20 fps, which is borderline and causes the mouse-lag above. This, not blow-up, is now the headline limitation. Reducing damping for a livelier feel will also lower the blow-up threshold (faster motion → larger θ̈) — liveliness and stability trade off.
- **Long-persistent "chaos"** at default damping — brief mouse inputs can trigger a regime where the chain keeps moving for *much longer* than the mass-damping time-constant (~10 sec at `α = 0.1`) would predict. This is a *separate* phenomenon from the blow-up above and is most likely **genuine bounded Hamiltonian chaos** (an N−1 link chain is a generalized multi-pendulum with positive Lyapunov exponents), not a numerical artifact — sensitive, energy-conserving wandering that only decays on the slow damping timescale. Higher damping suppresses it at the cost of sluggish feel; not further pursued.
- **No gravity / no friction / no collisions** — by design. The point is to stress-test the integrator and bending, not to build a complete sandbox.

## Future directions

The next phase targets **feel and input-limiting**, not integrator robustness. Per project direction we are explicitly **not** pursuing smaller h, adaptive step-rejection, or line-search Newton — the blow-up is understood and warm-start + 32 substeps handles it; the open problems are performance/feel.

- **Mouse→anchor spring (preferred next step)** — connect the anchor to the mouse target by a spring+damper instead of pinning it to the cursor. This is a *physical low-pass filter* on the forcing: fast jerks become a **bounded anchor acceleration**, so `ax` (hence θ̈, hence the Newton-basin overshoot) is capped at the source. It (a) attacks the blow-up cause directly, (b) decouples the frame-rate confound (caps delivered acceleration regardless of fps), and (c) adds a weighty, springy fidget feel. Likely pairs well with **dropping back to 16 substeps** (≈2× faster, fixing the mouse lag) since the spring removes the hard-forcing that 16 couldn't survive.
- **Breakable rope** — the inverse idea: instead of preventing the stiff regime, let a joint *tear* when its θ̈ exceeds a limit. Embraces the failure as a game mechanic rather than suppressing it.
- **Performance** — the dense O(N³) solve per Newton iter dominates. A banded/sparse solver (M and the Jacobian are nearly banded for a chain) could cut this substantially if N=100 at full frame rate is wanted.

Earlier integrator notes, now resolved or shelved: implicit midpoint (the old "B3") is **implemented and is the default**; symplectic Verlet/Yoshida ("B4") is still explicit with the same θ̈·h² sensitivity and is not pursued.

## Sizing

Chain length is `canvas.width * ROPE_LENGTH_FRACTION`; segment length `L = (canvas.width · ROPE_LENGTH_FRACTION) / (N − 1)`. Anchor marker radius `ANCHOR_MARKER_RADIUS_FRAC` (visible dot) and grab radius `ANCHOR_GRAB_RADIUS_FRAC` (touch target) are fractions of the canvas dimension.

## Reset behavior

The Reset button (handler in [controls.js](controls.js)) resets the anchor to its initial position and zeros all `θ` and `θ̇`. Tracing/logging buffers also restart so a Reset gives clean repeatable runs.
