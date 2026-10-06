# Star Nest · Gravity Wells (WebGPU)

An interactive WebGPU experiment: the famous **"Star Nest"** fragment shader by
Pablo Roman Andrioli (Shadertoy user *Kali*) is ported **GLSL → WGSL** and embedded
in a Three.js scene rendered with the **`WebGPURenderer`**. Cannon‑es physics balls act
as **gravity wells** that visibly warp and light up the nebula around them.

## Original shader

- **Star Nest** by Pablo Roman Andrioli — [https://www.shadertoy.com/view/XlfGRj](https://www.shadertoy.com/view/XlfGRj)
- License: MIT (as archived by the Python Arcade documentation used for the cleanest source); original published under CC BY-NC-SA.

## How it works

Two WGSL fragment shaders run in two render passes:

1. **Buffer pass** — `src/shaders/starNest.wgsl` renders the Star Nest nebula into a render target
   (a fullscreen quad with an orthographic camera). Mouse position (`iMouse`) rotates the view, exactly
   like on Shadertoy.
2. **Composite pass** — `src/shaders/composite.wgsl` samples that buffer texture and, for every physics
   ball, applies gravitational lensing to the sample coordinate plus an additive glow (and a darkened core),
   so the wells really bend the stars.

The ball positions/radii live in a tiny per-frame `DataTexture` fed from the cannon‑es world, so the
shader responds 1:1 to the physics simulation.

## Controls

| Input | Action |
| --- | --- |
| Move mouse | Navigate the nebula (Star Nest's native mouse-look) + attract the wells |
| Click | Drop a gravity well at the cursor |
| Drag | Slingshot — pull back, release, a well flies off |
| `G` | Toggle gravity (wells rain down, bounce off the edges) |
| `R` | Reset all wells |
| `S` | Shake (kick every well) |
| `Space` | Spawn a well in the middle |
| GUI panel | Star speed, attractor strength, gravity, slingshot power, bounciness, lensing / glow / core strength, glow color |

## Tech stack

- [Three.js](https://threejs.org/) `WebGPURenderer` + TSL (`wgslFn`, `uniform`, `texture`) — v0.186
- WebGPU / WGSL (no WebGL fallback; use Chrome, Edge, Firefox, or Safari)
- [cannon-es](https://github.com/pmndrs/cannon-es) for the rigid-body physics
- [lil-gui](https://lil-gui.georgealways.com/) for the control panel
- [Vite](https://vite.dev/) + TypeScript

## Run it locally

```bash
npm install
npm run dev      # starts the Vite dev server (open the printed URL in Chrome)
```

Production build:

```bash
npm run build    # type-checks (tsc) + bundles into dist/
npm run preview  # serve the production build locally
```

## Live demo

[`https://gagatkaa.github.io/star-nest/`](https://gagatkaa.github.io/star-nest/) — deployed from the `gh-pages` branch.

### One-time Pages setup

The `gh-pages` branch is already pushed. If the URL still 404s, enable Pages once:
repo **Settings → Pages → Source: "Deploy from a branch" → Branch: `gh-pages` / `(root)` → Save**.
Then the URL goes live (allow ~1 min).

Re-deploy after a change:

```bash
npm run build
npm run deploy     # pushes dist/ to the gh-pages branch
```

## Project structure

```
src/
  main.ts              # renderer, scenes, physics, input, GUI, render loop
  style.css            # minimal fullscreen canvas + overlay styles
  shaders/
    starNest.wgsl      # WGSL port of the Shadertoy shader (buffer pass)
    composite.wgsl     # lensing / glow composite shader (final pass)
  types/wgsl.d.ts      # type declaration so tsc accepts `?raw` shader imports
index.html             # canvas + HUD + credits overlay
```

## What was ported

`starNest.wgsl` is a line-by-line port of the original Image shader. The usual GLSL → WGSL rules
applied: `vec3` → `vec3f`, `mat2` → `mat2x2f`, swizzle *assignment* (`dir.xz = …`) rebuilt as explicit
vector construction (WGSL forbids swizzle lvalues), `v += fade` rewritten as `v += vec3f(fade)`
(scalar/vector adds aren't implicit), and a guard on `dot(p,p)` to avoid a division by zero.