// "Star Nest" by Pablo Roman Andrioli (Shadertoy user "Kali")
// Original: https://www.shadertoy.com/view/XlfGRj (MIT / CC BY-NC-SA)
// Ported from GLSL to WGSL for three.js WebGPURenderer.
//
// Volumetric raymarch through a folded 3D fractal that looks like a star nebula.
// iMouse rotates the camera direction, iSpeed controls the flight speed.

fn starNest(fragCoord: vec2f, iTime: f32, iMouse: vec2f, iResolution: vec2f, iSpeed: f32) -> vec4f {
  let iterations: i32 = 17;
  let formuparam: f32 = 0.53;
  let volsteps: i32 = 20;
  let stepsize: f32 = 0.1;
  let zoom: f32 = 0.8;
  let tile: f32 = 0.85;
  let brightness: f32 = 0.0015;
  let darkmatter: f32 = 0.3;
  let distfading: f32 = 0.73;
  let saturation: f32 = 0.85;

  // get coords and direction
  var uv = fragCoord / iResolution - 0.5;
  uv.y *= iResolution.y / iResolution.x;
  var dir = vec3f(uv * zoom, 1.0);
  let time = iTime * iSpeed + 0.25;

  // mouse rotation
  let a1 = 0.5 + iMouse.x / iResolution.x * 2.0;
  let a2 = 0.8 + iMouse.y / iResolution.y * 2.0;
  let rot1 = mat2x2f(cos(a1), sin(a1), -sin(a1), cos(a1));
  let rot2 = mat2x2f(cos(a2), sin(a2), -sin(a2), cos(a2));

  let dz1 = rot1 * dir.xz;
  dir = vec3f(dz1.x, dir.y, dz1.y);
  let d1 = rot2 * dir.xy;
  dir = vec3f(d1.x, d1.y, dir.z);

  var from = vec3f(1.0, 0.5, 0.5);
  from += vec3f(time * 2.0, time, -2.0);
  let fz1 = rot1 * from.xz;
  from = vec3f(fz1.x, from.y, fz1.y);
  let f1 = rot2 * from.xy;
  from = vec3f(f1.x, f1.y, from.z);

  // volumetric rendering
  var s = 0.1;
  var fade = 1.0;
  var v = vec3f(0.0);
  for (var r: i32 = 0; r < volsteps; r++) {
    var p = from + s * dir * 0.5;
    p = abs(vec3f(tile) - mod(p, vec3f(tile * 2.0))); // tiling fold
    var pa = 0.0;
    var a = 0.0;
    for (var i: i32 = 0; i < iterations; i++) {
      p = abs(p) / max(dot(p, p), 1e-6) - formuparam; // the magic formula
      a += abs(length(p) - pa); // absolute sum of average change
      pa = length(p);
    }
    let dm = max(0.0, darkmatter - a * a * 0.001); // dark matter
    a *= a * a; // add contrast
    if (r > 6) {
      fade *= 1.0 - dm; // dark matter, don't render near
    }
    v += vec3f(fade);
    v += vec3f(s, s * s, s * s * s * s) * a * brightness * fade; // color based on distance
    fade *= distfading; // distance fading
    s += stepsize;
  }

  v = mix(vec3f(length(v)), v, saturation); // color adjust
  return vec4f(v * 0.01, 1.0);
}