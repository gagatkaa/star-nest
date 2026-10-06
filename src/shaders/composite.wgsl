// Composite shader for the "gravity wells" experiment.
// Samples the Star Nest buffer texture and warps (gravitational lensing) it
// around every physics ball, then adds a soft additive glow on top.
// Ball data is read from a small texture (one texel per ball):
//   r,g = center position in uv space (0..1), b = radius in uv space, a = 1 if active.

fn composite(fragCoord: vec2f, iTime: f32, iMouse: vec2f, iResolution: vec2f,
             iChannel0: texture_2d<f32>, iChannel0Sampler: sampler,
             ballsMap: texture_2d<f32>, ballsMapSampler: sampler,
             uLensing: f32, uGlow: f32, uCore: f32, uGlowColor: vec3f) -> vec4f {
  let maxBalls: i32 = 32;
  let uv = fragCoord / iResolution;

  var duv = vec2f(0.0);
  var glow = 0.0;
  var core = 1.0;

  for (var i: i32 = 0; i < maxBalls; i++) {
    let b = textureSample(ballsMap, ballsMapSampler, vec2f((f32(i) + 0.5) / f32(maxBalls), 0.5));
    if (b.a < 0.5) {
      continue;
    }
    let center = b.xy;
    let r = max(b.z, 1e-4);
    let toCenter = center - uv;
    let d = length(toCenter);
    // lensing: pull the sampled coordinate toward the ball, strongest close in
    duv += toCenter * (uLensing * r * r) / (d * d + r * r);
    // soft glow
    glow += uGlow * exp(-(d * d) / (r * r * 0.55));
    // darken the core so the well looks like a hole in the nebula
    core *= 1.0 - uCore * (1.0 - smoothstep(r * 0.2, r * 1.3, d));
  }
  core = clamp(core, 0.15, 1.0);

  var col = textureSample(iChannel0, iChannel0Sampler, uv + duv) * core;
  col += vec4f(uGlowColor * glow, 0.0);
  return col;
}