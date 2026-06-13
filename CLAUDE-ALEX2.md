# CLAUDE-ALEX2.md

Alex2's variant of the Vibe Disk Game — a **rope/chain physics sandbox** in reduced (joint-angle) coordinates. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls).

This doc describes the **current state**. The investigation history — dead-ends, dated findings, the reasoning behind each choice — lives in git, [Alex2/tests/FINDINGS.md](Alex2/tests/FINDINGS.md), and the session notes, not here.

Alex2 parameterizes the rope by its N−1 joint angles: distance constraints are exact by construction, and the equations of motion come from Lagrangian mechanics rather than constraint projection. (An earlier Verlet/XPBD variant of Alex2 lives in git history.)

## Entry page

- [alex2.html](Alex2/alex2.html) — sets `<body data-player="alex2">` so [main.js](main.js) dynamically imports `alex2-physics.js`. Single button in `#panel`: Reset. The **shared engine** disk and bar are deliberately disabled (`bar.hidden = true`, `inputHooks.diskGrab = false`, `setDiskRadiusFraction(0)`); the playfield exists only as a backdrop for the chain.

## What Alex2 is

Grab the big **handle** and whip the chain around. The handle drives a **spring**, the spring drives the **anchor** (the chain head), and the chain hangs off the anchor under **gravity**. The chain starts hanging straight down; the handle starts above the anchor.

A single chain is drawn by default (`N = 50`). The factory `makeRope` and the array-of-ropes structure are kept so the variant can be extended to a multi-rope comparison view (e.g. N=50 vs N=100, same anchor input) by pushing more `makeRope(...)` calls into the `ropes` array — useful for verifying N-invariance.

Input:
- **Mouse drag on the handle** — spring mode (the shipping control). The finger moves the handle; the anchor is a spring-mass-damper that chases it. The handle has **no L/R clamp** — drag it off one side and it wraps to the other; grab detection is wrap-aware so it's never lost. Released, the handle **stays where you left it** (it has no gravity — it's the control point). Vertically it's clamped on-screen (no vertical wrap).
- **Mouse drag on the small anchor dot** — direct mode (testing): the finger pins the anchor rigidly, bypassing the spring's low-pass. This drives the solver hardest (the `Δv/h` forcing path), so it's a test handle, not for the end user.
- **Arrow keys** — step the anchor's velocity by ±`ANCHOR_KEY_VELOCITY_STEP` px/s per press. The anchor's sudden velocity change jerks the chain — applied as a one-step impulse (`M·Δθ̇ = L·μ_jj·(sin θ·Δv_x − cos θ·Δv_y)`) so the chain responds immediately rather than being dragged over frames.

### Mouse→anchor spring, handle, gravity, wrap

- **Spring (low-pass on the forcing).** The anchor's acceleration fed to `Q_anchor` is the spring force / mass — `K·stretch`, a function of *displacement*, not `Δv/h`. So a fast jerk or a clamped (slow) frame can't manufacture a huge `ax` the way a finger-pinned anchor can — the forcing is bounded by geometry, not by frame timing. Constants: `SPRING_K`, `SPRING_DAMP`, `ANCHOR_MASS`, `SPRING_REST_FRAC`. (Direct anchor mode keeps the raw `ax = Δv/h` path for testing.)
- **Gravity** (`GRAVITY`, px/s²; 0 disables). Acts on the chain as a generalized force `Q_grav_j = g·L·μ_jj·cos θ_j` (so θ=π/2 / straight-down is the equilibrium) and on the anchor body (`ay += g`). It does **not** act on the spring or handle (kinematic control elements). Added to `buildRhs` *and* its θ-derivative to the Newton Jacobian in `buildJacobianBlocks`, so the implicit solve stays consistent. Equivalence-principle-consistent: if the anchor free-falls, `Q_anchor`'s `−cos θ_j·ay` exactly cancels `Q_grav`, so a free-falling chain doesn't spuriously deform.
- **Toroidal wrap — horizontal only** (`USE_CHAIN_WRAP`). The whole movable scene (chain + spring + anchor dot + handle) is drawn once per needed canvas shift via `ctx.translate`, letting the canvas clip — uniform across all elements, no per-element math. Only L↔R; vertical wrap is deliberately off because with gravity the chain hangs down and a fallen chain teleporting to the top reads badly. Drop the height term back in `drawAlex2` to re-enable full wrap.

## Physics model

Each chain is parameterized by N−1 joint angles `θ_k` (one per segment). The state vector is `[θ, θ̇]`, total 2(N−1) components. Distance constraints are exact: every segment has length L, no stretching is possible by construction. **Tension is implicit** — the reduced coordinates satisfy the rigid-segment constraints automatically, so constraint forces never appear as variables; their physics is baked into the mass-matrix coupling — the `μ` structure (`μ_{jk} = Σ_{i ≥ max(j,k)} m_i`): moving one joint must accelerate everything downstream of it.

The Lagrangian equations of motion are
```
M(θ) · θ̈ + C(θ, θ̇) = Q_anchor + Q_bend + Q_damp + Q_grav
```

with
```
M_{jk}(θ) = L² · cos(θ_j − θ_k) · μ_{jk}            (mass matrix, dense, symmetric positive-definite (SPD))
C_j(θ, θ̇) = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²  (Coriolis vector — see note below)
Q_anchor_j = L · μ_{jj} · (sin θ_j · ẍ_anchor − cos θ_j · ÿ_anchor)
μ_{jk}     = Σ_{i ≥ max(j,k)} m_i                   (lumped mass; uniform → (Ns − max(j,k))·m)
```

**Bending** is **linear**: `V(Δθ) = ½·k_θ·Δθ²`, so the restoring torque is `k_θ·Δθ` with `k_θ = BENDING_EI / L`. The generalized bending force on θ_j is the discrete Laplacian `k_θ·(θ_{j−1} − 2·θ_j + θ_{j+1})` with Neumann (free-end) boundary conditions (BCs). `BENDING_EI` is the **continuum flexural rigidity** — an N-invariant material property; the `1/L` factor makes the discrete energy match `∫EI·κ²ds`, so the physical stiffness is the same at any N. Sweet spot **~100K–1M**.

Linear bending is robust under any forcing.

**Strain-rate damping** is the linear discrete Laplacian on θ̇ (same Neumann BCs): pulls each joint's angular velocity toward its neighbors'. Zero effect on rigid rotation (all θ̇ equal → Laplacian = 0), suppresses high-frequency / alternating-sign modes exponentially. Coefficient `DAMPING_BEND`.

**Viscous drag** subtracts `VISCOUS_DRAG · θ̇` from θ̈ — a fluid-friction-like drag that slows every joint's angular velocity at the same rate. Because it acts on the absolute velocity (not on neighbor differences, like the strain-rate term), it is the **only** thing that damps bulk rigid rotation. Set to 0 to coast indefinitely.

### Naming note: Coriolis vs centrifugal

We call the `C` vector "Coriolis" in the code, following the robotics/multibody-dynamics convention where the lumped `C(q,q̇)·q̇` vector is named that way. **Physically the term is centrifugal**: it is quadratic in a *single* angular velocity at each k (`θ̇_k²`), whereas Coriolis forces are bilinear in *two distinct* velocities. The actual Coriolis-character coupling lives in the kinetic-energy cross term (anchor velocity × segment rotation), which the Euler-Lagrange algebra collapses into the `Q_anchor` acceleration coupling in the 2D pure-translation case. Code keeps the conventional name; this note records the physical reading.

## Integration

**Integrator: implicit midpoint** (γ = 0.5), `INTEGRATOR = 'implicit-midpoint'` — symplectic, A-stable, bounded energy error. (γ = 1.0 gives L-stable implicit Euler; explicit RK4, `INTEGRATOR = 'rk4'`, is kept as a legacy comparison path.)

Each real frame takes `IMPLICIT_SUBSTEPS_PER_FRAME = 16` substeps of size `h/16` (total physics time = h, so anchor and chain stay in lockstep). Each substep solves `F(y_{n+1}) = 0` for `y = [θ, θ̇]` by **Newton** (`NEWTON_MAX_ITERS = 8`, convergence when `‖Δy‖/max(‖y‖,1) < NEWTON_TOL = 1e-6`). Each Newton iteration builds M + Coriolis + the Jacobian blocks (O(N²)) and solves a dense Ns×Ns system by Gaussian elimination with partial pivoting (O(N³)) — this solve dominates the frame cost.

**Warm start** (`NEWTON_WARM_START`): each substep seeds Newton from the *previous converged substep's realized increment* (`y⁰ = yₙ + Δy_prev`) instead of an explicit-Euler **cold start** (`yₙ + h·f(yₙ)`). The realized increment is bounded physical motion, so it doesn't overshoot Newton's convergence basin the way `h·θ̈` can once θ̈ is large. Falls back to the cold start when no prior increment is valid (first substep after Reset / arrow-key impulse / a non-converged step).

**Anchor forcing — two delivery paths.** A *mouse-drag* velocity change is delivered **smoothly**: a constant acceleration `ax = Δv/h` spread across the frame's 16 substeps (same total impulse, no within-frame Δv jump, so the quadratic Coriolis term sees a continuous ramp). *Arrow keys* are the deliberate exception — an **abrupt** exact angular-momentum impulse `M·Δθ̇ = L·μ_jj·(sin θ_j·Δv_x − cos θ_j·Δv_y)` in the keydown handler; a jerk is the intended feel.

## Stability — the safety net

Newton can fail to converge under hard forcing: its initial guess overshoots the convergence basin and `relStep` stays O(1) across all 8 iterations instead of shrinking. **Convergence, not magnitude, is the failure signal** — legitimate fast motion (a whip tip can reach θ̇ in the thousands) converges fine; only a genuine numerical breakdown shows `converged < substeps`. So the recovery is keyed on convergence, in two tiers:

1. **Halving** (`USE_HALVING`, `HALVING_MAX_DEPTH = 2`). When a substep's Newton fails, `advanceSubstep` retries it as two half-steps, recursively down to `h_sub/4`. A smaller `h` shrinks the basin-overshoot, so the slice usually becomes solvable — the orthodox "reject the step and retry smaller," done **locally** so only the failing slice pays the extra cost; normal play is untouched. `implicitStep` commits θ/θ̇ only on success and leaves them at the slice-start state on failure, so the retry re-runs cleanly with no save/restore.
2. **Coast** (`coastSubstep`, last resort) — and, unlike halving, an **unorthodox** move with no standard-method pedigree. If even the smallest retry won't converge, advance that slice by inertia with viscous drag kept (`θ̇ ← θ̇·(1−α·h)`, `θ ← θ + h·θ̇`): no forces, bounded, and provably can't inject energy. We keep it for one reason — it turned out **useful and harmless**: it carries the rare unsolvable slice through without blowing up or pumping in energy. The damping-during-coast is essential — without it, persistent coasting bypasses all damping and the chain self-sustains forever.

In practice, normal and hard play converge cleanly (halving never fires); brutal direct-anchor jerks make halving rescue ~90% of failures with the occasional isolated coast. **Chaos is bounded and self-recovering but still generatable** at the extreme: drive hard enough and you get a cascade of coasts plus runaway *winding* (the wound state is visually invisible yet carries huge `bendPE`, and relaxes only glacially). The real cure is bounding the winding — see Open / in progress.

Counters surfaced in the HUD / `[E]` log: `halveΣ` (slices halved), `rejΣ` (slices coasted), `singBailΣ` (linear-solve singular-pivot bails). All three at 0 in healthy play.

## Tunables (top of [alex2-physics.js](Alex2/alex2-physics.js))

| Constant | Default | Role |
|---|---|---|
| `N` | 50 | Number of particles in the chain (joints = N − 1) |
| `ROPE_LENGTH_FRACTION` / `_H` | 0.45 / 0.3 | Chain length = `max(0.45·width, 0.3·height)` (height term keeps it long enough on narrow screens) |
| `INITIAL_THETA` | π/2 | Initial joint angle — straight down (gravity equilibrium) |
| `M_ROPE` | 1 | Total chain mass (excluding anchor) |
| `GRAVITY` | 1000 | Downward accel (px/s²) on chain + anchor; 0 disables |
| `INTEGRATOR` | `'implicit-midpoint'` | `'implicit-midpoint'` (γ=0.5), `'implicit-euler'` (γ=1.0), or legacy `'rk4'` |
| `IMPLICIT_SUBSTEPS_PER_FRAME` | 16 | Implicit substeps per real frame |
| `USE_HALVING` / `HALVING_MAX_DEPTH` | true / 2 | On Newton failure, retry the slice as halves (down to `h_sub/4`) before coasting |
| `NEWTON_WARM_START` | true | Seed Newton from previous substep's increment vs. explicit Euler |
| `NEWTON_MAX_ITERS` / `NEWTON_TOL` | 8 / 1e-6 | Per-substep Newton iteration cap and convergence tolerance |
| `RK4_SUBSTEPS_PER_FRAME` | 16 | Substeps for the legacy RK4 path only |
| `ANCHOR_KEY_VELOCITY_STEP` | 50 px/s | Arrow-key impulse magnitude |
| `BENDING_EI` | 500000 | Continuum flexural rigidity; `k_θ = BENDING_EI / L`. Sweet spot ~100K–1M |
| `DAMPING_BEND` | 1000 | Strain-rate (discrete Laplacian on θ̇) damping |
| `VISCOUS_DRAG` | 0.5 | Viscous drag (only thing that damps bulk rotation) |
| `USE_ANCHOR_SPRING` | true | Mouse→anchor spring + handle (the shipping control) |
| `SPRING_K` | 800 | Spring stiffness (higher = more precise control, less low-pass filtering) |
| `SPRING_DAMP` | 25 | Damping on the anchor's velocity (near-critical scales as √(K·mass)) |
| `ANCHOR_MASS` | 2 | Anchor inertia; bigger = smoother/laggier, smaller `ax` |
| `SPRING_REST_FRAC` | 0.16 | Spring rest length as a fraction of min(w,h) — the idle handle offset |
| `HANDLE_GRAB_RADIUS_FRAC` / `_MARKER_` | 1/6 / 1/15 | Handle finger hit-target / drawn radius |
| `USE_CHAIN_WRAP` | true | Horizontal-only toroidal wrap of the whole scene |

### Diagnostics (flag-gated; default off unless noted)

| Flag / helper | What it does |
|---|---|
| `SHOW_PERF_HUD` (on) | On-canvas overlay: FPS + real frame interval, integrator-only physics ms and % of frame, raw dt with a `⚠ CLAMPED` flag when main.js's 33 ms ceiling fires, and the `reject Σ` counter. |
| `NEWTON_LOG_ENABLED` | Per-frame Newton summary, **gated to problem frames only** (a substep fails to converge, or strains near the iter cap). Headline `converged=X/Y  halveΣ  rejΣ  singBailΣ`. Silent in healthy play. |
| `ENERGY_DECAY_LOG` | The `[E]` log: every N frames prints `peakKE`, `bendPE`, `max|Δθ|` (winding), `peak|aV|`, `halveΣ`, `rejΣ`. The winding/energy gauge. |
| `ENERGY_MONITOR` | `E = ½θ̇ᵀMθ̇` per frame; warns on spikes (`E_new/E_prev > E_SPIKE_RATIO`) or NaN. |
| `CONDITION_ESTIMATE` | Spectral κ₂(M) by power + inverse-power iteration (expensive). M conditioning is *not* the cause of blow-ups. |
| `window.alex2.dumpTheta()` | On-demand console print of per-joint `Δθ` (+ turn count) and raw `θ` — for comparing winding data to the visual. |
| `window.alex2.kickChain()` / `kickAnchor()` | Perturb the chain-only / anchor-only at rest, to study decay in isolation. |

## Open / in progress

- **Reset on "cannot proceed."** Instead of coasting at the floor, auto-reset the chain (with a blow sound) when even halving can't solve — on a *sustained*-failure trigger (K consecutive coast-frames), so isolated harmless coasts don't reset. Discussed, not built.
- **Whip crack via mass taper.** A real whip cracks because it's lighter toward the tip: the impedance `√(T·μ)` drops, so the traveling wave's velocity amplifies. Uniform `particleMass` gives a traveling wave but no crack. Add a tip-ward mass taper (stiffness taper secondary).
- **Open mystery — pinned wound state.** A heavily-wound chain leaves a frozen wound state (`max|Δθ|` and `bendPE` essentially constant) with a tiny non-decaying wiggle that relaxes only over ~hours. Possibly the same as a 12-hour overnight observation; unconfirmed, and may never be resolved — because we have since dramatically increased the `BENDING_EI` constant, so the chain no longer reaches the heavily-wound regime that produced it.
- **Performance.** The dense O(N³) Newton solve dominates. M is **dense, not banded** (the lumped-mass `μ` couples every joint pair), so a banded solver doesn't apply; the real O(N) lever is the articulated-body / Featherstone recursion (never forms M) — a larger reformulation.
- **Parked feel items.** The anchor/handle marker & grab radii (fractions of `min(w,h)`) are provisional and to be revisited with the reference scale; the spring/handle wrap reads slightly oddly when the anchor crosses a seam.

## Sizing

Chain length is `max(width·ROPE_LENGTH_FRACTION, height·ROPE_LENGTH_FRACTION_H)`; segment length `L = chainLength / (N − 1)`. Anchor marker/grab radii (`ANCHOR_MARKER_RADIUS_FRAC`, `ANCHOR_GRAB_RADIUS_FRAC`) and handle marker/grab radii (`HANDLE_MARKER_RADIUS_FRAC`, `HANDLE_GRAB_RADIUS_FRAC`) are fractions of `min(w,h)`. (These fractions are provisional — see Open / in progress.)

## Reset behavior

The Reset button (handler in [controls.js](controls.js)) resets the anchor to its initial position, parks the handle above the anchor, releases any held grab, and zeros all `θ` and `θ̇` (chain back to straight-down). It also clears the anti-chaos counters (`halveΣ`/`rejΣ`) and the `[E]`-log clock.
