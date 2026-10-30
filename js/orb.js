/* Ember's orb: a deep red plasma sphere drawn in 3D with three.js (loaded only when the Ember tab opens).
   A web of hair-thin threads like neurons, red-white surges racing through them, faint sun rays that stretch while it talks,
   bloom, film grain and scan lines. Flattened front to back so it faces you with depth instead of spinning like a globe. */

const FILES = ['three.min.js', 'CopyShader.js', 'LuminosityHighPassShader.js', 'EffectComposer.js', 'RenderPass.js', 'ShaderPass.js', 'UnrealBloomPass.js'];
let loading = null;
/* the scripts depend on each other, so they load one after another */
export function loadThree(){
  if (window.THREE && window.THREE.UnrealBloomPass) return Promise.resolve();
  return loading || (loading = FILES.reduce((p, f) => p.then(() => new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = 'vendor/three/' + f; s.onload = ok; s.onerror = () => { loading = null; fail(new Error('Couldn’t load ' + f)); }; document.head.appendChild(s);
  })), Promise.resolve()));
}

/* One orb for the whole app: built in the background after the app opens, then kept, so the Ember tab opens instantly. */
let inst = null;
export function getOrb(){
  if (!inst){ const cv = document.createElement('canvas'); cv.className = 'em-gl'; cv.setAttribute('aria-hidden', 'true'); inst = createOrb(cv); inst.canvas = cv; }
  return inst;
}
export function preloadOrb(){
  const go = () => loadThree().then(() => { try { getOrb().warm(); } catch (e){} }).catch(() => {});
  setTimeout(() => ('requestIdleCallback' in window) ? requestIdleCallback(go, { timeout: 3000 }) : go(), 2000);
}

/* level() (set with setLevel) returns how loud the voice is right now (0..1), or null to let the orb animate on its own */
function createOrb(cv){
  let level = null;
  const THREE = window.THREE;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x030102, 1);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, 1, .1, 100), orb = new THREE.Group();
  scene.add(orb); orb.scale.z = .45;
  const R = Math.random, TAU = Math.PI * 2;

  /* ---------- the shape: round, with a gentle unevenness that breathes ---------- */
  const reach = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l; return 1 + .05 * Math.sin(x * 3.1 + 1.3) * Math.sin(y * 2.6 - .4) + .03 * Math.sin(z * 4.7 + x * 2.2); };
  const BULGE = `vec3 n = normalize(position + 1e-4);
        float bulge = 1.0 + (0.025 + 0.07 * uAmp) * sin(n.x * 2.7 + uTime * 0.45) * sin(n.y * 3.1 - uTime * 0.35) + 0.02 * sin(n.z * 5.0 + uTime * 0.6);`;
  const U = { uTime: { value: 0 }, uAmp: { value: 0 }, uHot: { value: new THREE.Color(.86, .07, .05) }, uDeep: { value: new THREE.Color(.2, 0, .01) } };
  const add = (mat, geo, Kind) => { const m = new Kind(geo, mat); orb.add(m); return m; };
  const geom = attrs => { const g = new THREE.BufferGeometry(); Object.entries(attrs).forEach(([k, [arr, n]]) => g.setAttribute(k, new THREE.Float32BufferAttribute(arr, n))); return g; };

  /* ---------- filaments: wandering threads plus a web of connections between nodes, like neurons ---------- */
  const nz = (x, y, z, s) => [Math.sin(y * 3.1 + s) + Math.sin(z * 2.3 - s * .7), Math.sin(z * 2.9 + s * 1.3) + Math.sin(x * 2.1 + s), Math.sin(x * 3.3 - s) + Math.sin(y * 1.9 + s * .5)];
  const pos = [], aR = [], aSeed = [], aU = [];
  const line = (pts, seed) => { const n = pts.length - 1; for (let i = 0; i < n; i++){ pos.push(...pts[i], ...pts[i + 1]); aR.push(Math.hypot(...pts[i]), Math.hypot(...pts[i + 1])); aSeed.push(seed, seed); aU.push(i / n, (i + 1) / n); } };
  const unit = () => { const u = R() * 2 - 1, th = R() * TAU, q = Math.sqrt(1 - u * u); return [q * Math.cos(th), u, q * Math.sin(th)]; };
  // threads that wander outward from inside; a few become long curly tendrils that stray far outside
  for (let k = 0; k < 850; k++){
    let p = unit().map(v => v * Math.pow(R(), .55) * .9), d = unit();
    const seed = R() * 100, tendril = R() < .06, steps = tendril ? 50 : 12 + (R() * 18 | 0), pts = [p];
    for (let i = 0; i < steps; i++){
      const n = nz(p[0], p[1], p[2], seed), len = Math.hypot(...p) || 1;
      d = d.map((v, j) => v + n[j] * .3 + p[j] / len * .1); const dl = Math.hypot(...d); d = d.map(v => v / dl);
      const q = p.map((v, j) => v + d[j] * .055);
      if (Math.hypot(...q) > reach(...q) * (tendril ? 1.45 + R() * .5 : 1)) break;
      pts.push(q); p = q;
    }
    if (pts.length > 2) line(pts, seed);
  }
  // nodes joined to their nearest neighbours with slightly curved links
  const nodes = Array.from({ length: 320 }, (_, i) => unit().map(v => v * (i < 210 ? .78 + R() * .2 : Math.pow(R(), .7) * .75)));
  nodes.forEach((a, i) => {
    nodes.map((b, j) => [j, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])]).filter(([j]) => j > i).sort((x, y) => x[1] - y[1]).slice(0, 2).forEach(([j]) => {
      const b = nodes[j], m = a.map((v, k) => (v + b[k]) / 2 + (R() - .5) * .14), pts = [];
      for (let s = 0; s <= 8; s++){ const t = s / 8, u = 1 - t; pts.push(a.map((v, k) => u * u * v + 2 * u * t * m[k] + t * t * b[k])); }
      line(pts, R() * 100);
    });
  });
  const strandMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aR; attribute float aSeed; attribute float aU; uniform float uTime; uniform float uAmp; varying float vA; varying float vR; varying float vP;
      void main(){
        ${BULGE}
        vec3 p = position * bulge * (1.0 + uAmp * 0.12 * aR);
        float w = (0.018 + 0.04 * uAmp) * (0.3 + aR);
        p += vec3(sin(p.y * 4.0 + uTime * 0.9 + aSeed), sin(p.z * 4.0 + uTime * 0.8 + aSeed * 1.3), sin(p.x * 4.0 + uTime * 1.1 + aSeed * 0.7)) * w;
        float fl = 0.5 + 0.5 * sin(uTime * (1.5 + fract(aSeed) * 4.0) + aSeed * 7.0);
        vA = (0.15 + 0.85 * smoothstep(0.3, 1.0, aR)) * (0.4 + 0.6 * fl) * (aR > 1.03 ? 0.6 : 1.0);
        vR = aR;
        // a white surge runs along this thread, out and back like a brain wave; more threads fire while it talks
        float pp = abs(fract(uTime * (0.18 + fract(aSeed * 3.7) * 0.35) + fract(aSeed * 0.37)) * 2.0 - 1.0);
        float on = step(fract(aSeed * 1.913), 0.05 + 0.28 * uAmp);
        vP = on * exp(-pow((aU - pp) * 10.0, 2.0)) * (1.0 - smoothstep(0.78, 0.9, aR));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uHot; uniform vec3 uDeep; uniform float uAmp; varying float vA; varying float vR; varying float vP;
      void main(){
        float k = smoothstep(0.2, 1.0, vR);
        vec3 c = mix(uDeep, uHot, 0.35 + 0.65 * k) * vA * (0.26 + 0.14 * uAmp);
        c += vec3(1.0, 0.55, 0.52) * vP * 0.8;
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  add(strandMat, geom({ position: [pos, 3], aR: [aR, 1], aSeed: [aSeed, 1], aU: [aU, 1] }), THREE.LineSegments);

  /* ---------- white sparks shooting from the centre to the edge and back ---------- */
  const zp = [], zd = [], zs = [], ze = [];
  for (let i = 0; i < 360; i++){ const d = unit(), s = R() * 100; [0, 1].forEach(e => { zp.push(0, 0, 0); zd.push(...d); zs.push(s); ze.push(e); }); }
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aDir; attribute float aSeed; attribute float aEnd; uniform float uTime; uniform float uAmp; varying float vA;
      void main(){
        float sp = 0.22 + fract(aSeed * 3.7) * 0.55 + uAmp * 0.5;
        float ph = fract(uTime * sp + fract(aSeed * 0.61));
        if (fract(aSeed * 9.17) < 0.4) ph = 1.0 - ph;
        float r = 0.06 + ph * (0.72 + 0.08 * fract(aSeed * 5.3));
        float len = 0.04 + 0.12 * fract(aSeed * 5.1) * (0.6 + uAmp);
        vec3 p = aDir * (aEnd > 0.5 ? r : max(0.04, r - len));
        float on = step(fract(aSeed * 2.31), 0.08 + 0.42 * uAmp);
        vA = on * sin(ph * 3.14159) * (aEnd > 0.5 ? 1.0 : 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0, 0.55, 0.52) * vA * 0.65, 1.0); }`
  });
  add(sparkMat, geom({ position: [zp, 3], aDir: [zd, 3], aSeed: [zs, 1], aEnd: [ze, 1] }), THREE.LineSegments);

  /* ---------- faint sunshine beams reaching out past the edge ---------- */
  const bp = [], bu = [], bs = [];
  for (let i = 0; i < 170; i++){ const d = unit(), r1 = .88, r2 = 1.12 + Math.pow(R(), 1.7) * .85, s = R() * 100; bp.push(...d.map(v => v * r1), ...d.map(v => v * r2)); bu.push(0, 1); bs.push(s, s); }
  const beamMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aU; attribute float aSeed; uniform float uTime; uniform float uAmp; varying float vA;
      void main(){
        ${BULGE}
        // each ray slowly reaches out and pulls back, and they all stretch further while it talks
        float reachOut = 0.75 + 0.35 * sin(uTime * (0.4 + fract(aSeed * 2.3) * 0.9) + aSeed * 3.0) + uAmp * (0.6 + 0.6 * fract(aSeed * 4.7));
        vec3 p = position * bulge * (1.0 + aU * (reachOut - 1.0) * 0.6);
        float fl = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.6 + fract(aSeed) * 1.4) + aSeed * 5.0), 2.0);
        vA = fl * pow(1.0 - aU, 1.5) * (0.75 + 1.2 * uAmp);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform vec3 uHot; varying float vA; void main(){ gl_FragColor = vec4((uHot + vec3(0.12, 0.03, 0.03)) * vA * 0.5, 1.0); }`
  });
  add(beamMat, geom({ position: [bp, 3], aU: [bu, 1], aSeed: [bs, 1] }), THREE.LineSegments);

  /* ---------- specks: the rim, floating dust, and brighter nodes where links meet ---------- */
  const dp = [], ds = [], db = [];
  for (let i = 0; i < 4200; i++){
    const [x, y, z] = unit(), rim = i < 2700, stray = i >= 3950;
    const r = stray ? reach(x, y, z) * (1.05 + R() * .5) : rim ? reach(x, y, z) * (.93 + R() * .09) : Math.pow(R(), .6) * .9;
    dp.push(x * r, y * r, z * r); ds.push(R() * 100); db.push(0);
  }
  nodes.forEach(n => { dp.push(...n); ds.push(R() * 100); db.push(1); });
  const dustMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uPx: { value: 1 } }, U), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSeed; attribute float aBig; uniform float uTime; uniform float uAmp; uniform float uPx; varying float vA; varying float vR; varying float vB;
      void main(){
        float r = length(position);
        ${BULGE}
        vec3 p = position * bulge * (1.0 + uAmp * 0.12 * r) + vec3(sin(uTime * 0.7 + aSeed), cos(uTime * 0.6 + aSeed * 1.7), sin(uTime * 0.5 + aSeed * 2.3)) * (0.01 + 0.02 * uAmp);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float tw = 0.5 + 0.5 * sin(uTime * (2.0 + fract(aSeed * 3.1) * 5.0) + aSeed);
        vA = tw * (0.2 + 1.1 * smoothstep(0.7, 1.0, r)); vR = r; vB = aBig;
        if (aBig > 0.5) vA = (0.35 + 0.65 * tw) * (0.6 + 0.8 * uAmp);
        gl_PointSize = uPx * (0.8 + 1.6 * fract(aSeed * 7.3)) * (1.0 + aBig * 1.6) * (4.2 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uHot; uniform vec3 uDeep; varying float vA; varying float vR; varying float vB;
      void main(){
        float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        float f = smoothstep(0.5, 0.0, d);
        vec3 c = mix(uDeep, uHot, 0.5 + 0.5 * vR) + vec3(0.3, 0.06, 0.04) * f;
        c = mix(c, vec3(1.0, 0.55, 0.52), vB * f * 0.35);
        gl_FragColor = vec4(c * f * vA * 0.8, 1.0);
      }`
  });
  add(dustMat, geom({ position: [dp, 3], aSeed: [ds, 1], aBig: [db, 1] }), THREE.Points);

  /* ---------- core and halo: soft glowing sprites ---------- */
  const glowTex = stops => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); };
  const sprite = (tex, op) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
  const core = sprite(glowTex([[0, 'rgba(255,215,210,1)'], [.1, 'rgba(240,105,95,.9)'], [.28, 'rgba(160,18,14,.5)'], [.6, 'rgba(70,4,4,.15)'], [1, 'rgba(0,0,0,0)']]), 1);
  const halo = sprite(glowTex([[0, 'rgba(120,10,10,.35)'], [.45, 'rgba(60,4,4,.12)'], [1, 'rgba(0,0,0,0)']]), .5);
  const haze = sprite(glowTex([[0, 'rgba(50,2,4,.4)'], [1, 'rgba(0,0,0,0)']]), .3);
  halo.scale.setScalar(2.9); haze.scale.setScalar(6);
  orb.add(haze, halo, core);

  /* ---------- post: bloom, then grain, scan lines, colour split, vignette and the odd glitch ---------- */
  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, cam));
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), .7, .4, .06);
  composer.addPass(bloom);
  const film = new THREE.ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmp: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmp; uniform vec2 uRes; varying vec2 vUv;
      float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 uv = vUv;
        float band = step(0.975, rnd(vec2(floor(uv.y * 70.0), floor(uTime * 14.0)))) * smoothstep(0.35, 0.8, uAmp);
        uv.x += band * 0.02 * (rnd(vec2(uTime, floor(uv.y * 70.0))) - 0.5);
        vec2 d = uv - vec2(0.5, 0.4); float ca = 0.006 + 0.01 * uAmp;
        vec3 c = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
        c *= 0.93 + 0.07 * sin(uv.y * uRes.y * 1.6);
        c += (rnd(uv * uRes + fract(uTime * 7.0)) - 0.5) * 0.05;
        c *= smoothstep(1.2, 0.3, length(d * vec2(1.0, 0.75)));
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  composer.addPass(film);

  /* size: the orb fills about three-quarters of the width and sits in the upper part of the screen */
  let W = 0, H = 0, baseY = 0, spanH = 1, lift = 0;
  const fit = () => {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(1.5, devicePixelRatio || 1);
    if (!w || !h || (w === W && h === H)) return; W = w; H = h;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); composer.setPixelRatio(dpr); composer.setSize(w, h);
    bloom.resolution.set(w * dpr / 2, h * dpr / 2);
    cam.aspect = w / h; const span = Math.max(2.75 / cam.aspect, 2.75), z = span / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    cam.position.set(0, 0, z); cam.updateProjectionMatrix();
    baseY = span * .1; spanH = span;
    film.uniforms.uRes.value.set(w * dpr, h * dpr); dustMat.uniforms.uPx.value = dpr * 2.2;
  };

  /* states: idle, listen, think, speak */
  let state = 'idle', chat = false, amp = 0, spin = 0, flare = 0, last = performance.now(), raf = 0, running = false;
  const frame = now => {
    if (!running){ raf = 0; return; }
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    fit();
    const dt = Math.min(.05, (now - last) / 1000), t = now / 1000; last = now;
    const lv = level ? level() : null;
    const tg = lv != null && (state === 'speak' || state === 'listen') ? .08 + lv * 1.15
      : state === 'idle' ? .06 + .03 * Math.sin(t * 1.4)
      : state === 'think' ? .25 + .08 * Math.sin(t * 7)
      : state === 'listen' ? .15 + .45 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.3 + .5))
      : .2 + .8 * Math.abs(Math.sin(t * 9.1) * Math.sin(t * 3.7)) + R() * .1;
    amp += (tg - amp) * (lv != null && tg > amp ? .5 : .2); flare = Math.max(0, flare - dt * .9);
    spin += dt * ({ idle: .06, listen: .12, think: .55, speak: .16 })[state];
    U.uTime.value = t * (state === 'think' ? 1.8 : 1); U.uAmp.value = amp + flare * .5;
    // the orb spreads out with the loudness of the voice
    lift += ((chat ? 1 : 0) - lift) * .08; orb.position.y = baseY + lift * spanH * .23; const k = (1 - lift * .52) * (1 + Math.max(0, amp - .1) * .16); orb.scale.set(k, k, .45 * k);
    orb.rotation.z = spin * .6; orb.rotation.x = Math.sin(t * .23) * .22; orb.rotation.y = Math.sin(t * .17 + 1) * .26;
    const a = amp + flare * .6;
    core.scale.setScalar(.38 + a * .55 + Math.sin(t * 2) * .02); core.material.opacity = .55 + a * .45;
    halo.material.opacity = .3 + a * .4;
    bloom.strength = .6 + a * .7;
    film.uniforms.uTime.value = t; film.uniforms.uAmp.value = amp;
    composer.render();
  };
  return {
    setState(s){ if (s === 'speak' && state !== 'speak') flare = 1; state = s; },
    setChat(on){ chat = on; },
    setLevel(fn){ level = fn; },
    resume(){ if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    pause(){ running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    /* draw one small frame off screen so the shaders are compiled before the tab is opened */
    warm(){ if (running) return; try { renderer.setSize(64, 64, false); composer.setSize(64, 64); composer.render(); W = H = 0; } catch (e){} }
  };
}
