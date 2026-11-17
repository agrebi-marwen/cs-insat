// Legacy WebGL starfield, wrapped as a module. Logic unchanged from assets/js/galaxy-bg.js.
let started = false;
export function startGalaxy() {
  if (started) return;
  started = true;
  // Skip entirely on mobile — galaxy background is too heavy for phones
  if (window.innerWidth <= 600 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) {
    return;
  }

  const vertexShaderSource = `
    attribute vec2 position;
    varying vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;

    uniform float uTime;
    uniform vec3 uResolution;
    uniform vec2 uFocal;
    uniform vec2 uRotation;
    uniform float uStarSpeed;
    uniform float uDensity;
    uniform float uHueShift;
    uniform float uSpeed;
    uniform vec2 uMouse;
    uniform float uGlowIntensity;
    uniform float uSaturation;
    uniform bool uMouseRepulsion;
    uniform float uTwinkleIntensity;
    uniform float uRotationSpeed;
    uniform float uRepulsionStrength;
    uniform float uMouseActiveFactor;
    uniform float uAutoCenterRepulsion;
    uniform bool uTransparent;

    varying vec2 vUv;

    #define NUM_LAYER 2.0
    #define STAR_COLOR_CUTOFF 0.2
    #define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
    #define PERIOD 3.0

    float Hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float tri(float x) {
      return abs(fract(x) * 2.0 - 1.0);
    }

    float tris(float x) {
      float t = fract(x);
      return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0));
    }

    float trisn(float x) {
      float t = fract(x);
      return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0;
    }

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    float Star(vec2 uv, float flare) {
      float d = length(uv);
      float m = (0.05 * uGlowIntensity) / d;
      float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
      m += rays * flare * uGlowIntensity;
      uv *= MAT45;
      rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
      m += rays * 0.3 * flare * uGlowIntensity;
      m *= smoothstep(1.0, 0.2, d);
      return m;
    }

    vec3 StarLayer(vec2 uv) {
      vec3 col = vec3(0.0);

      vec2 gv = fract(uv) - 0.5; 
      vec2 id = floor(uv);

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 offset = vec2(float(x), float(y));
          vec2 si = id + vec2(float(x), float(y));
          float seed = Hash21(si);
          float size = 0.35 + 0.65 * fract(seed * 345.32);
          float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
          float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;

          float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
          float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
          float grn = min(red, blu) * seed;
          vec3 base = vec3(red, grn, blu);
          
          float hue = atan(base.g - base.r, base.b - base.r) / (2.0 * 3.14159) + 0.5;
          hue = fract(hue + uHueShift / 360.0);
          float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;
          float val = max(max(base.r, base.g), base.b);
          base = hsv2rgb(vec3(hue, sat, val));

          vec2 pad = vec2(tris(seed * 34.0 + uTime * uSpeed / 10.0), tris(seed * 38.0 + uTime * uSpeed / 30.0)) - 0.5;

          float star = Star(gv - offset - pad, flareSize);
          vec3 color = base;

          float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
          twinkle = mix(1.0, twinkle, uTwinkleIntensity);
          star *= twinkle;
          
          col += star * size * color;
        }
      }

      return col;
    }

    void main() {
      vec2 focalPx = uFocal * uResolution.xy;
      vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;

      vec2 mouseNorm = uMouse - vec2(0.5);
      
      if (uAutoCenterRepulsion > 0.0) {
        vec2 centerUV = vec2(0.0, 0.0);
        float centerDist = length(uv - centerUV);
        vec2 repulsion = normalize(uv - centerUV) * (uAutoCenterRepulsion / (centerDist + 0.1));
        uv += repulsion * 0.05;
      } else if (uMouseRepulsion) {
        vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
        float mouseDist = length(uv - mousePosUV);
        vec2 repulsion = normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1));
        uv += repulsion * 0.05 * uMouseActiveFactor;
      } else {
        vec2 mouseOffset = mouseNorm * 0.1 * uMouseActiveFactor;
        uv += mouseOffset;
      }

      float autoRotAngle = uTime * uRotationSpeed;
      mat2 autoRot = mat2(cos(autoRotAngle), -sin(autoRotAngle), sin(autoRotAngle), cos(autoRotAngle));
      uv = autoRot * uv;

      uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;

      vec3 col = vec3(0.0);

      for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYER) {
        float depth = fract(i + uStarSpeed * uSpeed);
        float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
        float fade = depth * smoothstep(1.0, 0.9, depth);
        col += StarLayer(uv * scale + i * 453.32) * fade;
      }

      if (uTransparent) {
        float alpha = length(col);
        alpha = smoothstep(0.0, 0.3, alpha);
        alpha = min(alpha, 1.0);
        gl_FragColor = vec4(col, alpha);
      } else {
        gl_FragColor = vec4(col, 1.0);
      }
    }
  `;

  function initGalaxyBackground() {
    let canvas = document.getElementById('galaxy-bg-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'galaxy-bg-canvas';
      Object.assign(canvas.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '-10',
        opacity: '1'
      });
      document.body.appendChild(canvas);
    }

    // When perf mode is active from the start, don't even spin up WebGL.
    const gl = window.__PERF_MODE ? null : canvas.getContext('webgl', { alpha: true });
    if (!gl) {
      canvas.style.display = 'none';
      return;
    }

    gl.clearColor(0, 0, 0, 0);

    function createShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vertShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Quad geometry covering full clip space
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1
    ]), gl.STATIC_DRAW);

    const posAttrLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posAttrLoc);
    gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniform Locations
    const uLocations = {
      uTime: gl.getUniformLocation(program, 'uTime'),
      uResolution: gl.getUniformLocation(program, 'uResolution'),
      uFocal: gl.getUniformLocation(program, 'uFocal'),
      uRotation: gl.getUniformLocation(program, 'uRotation'),
      uStarSpeed: gl.getUniformLocation(program, 'uStarSpeed'),
      uDensity: gl.getUniformLocation(program, 'uDensity'),
      uHueShift: gl.getUniformLocation(program, 'uHueShift'),
      uSpeed: gl.getUniformLocation(program, 'uSpeed'),
      uMouse: gl.getUniformLocation(program, 'uMouse'),
      uGlowIntensity: gl.getUniformLocation(program, 'uGlowIntensity'),
      uSaturation: gl.getUniformLocation(program, 'uSaturation'),
      uMouseRepulsion: gl.getUniformLocation(program, 'uMouseRepulsion'),
      uTwinkleIntensity: gl.getUniformLocation(program, 'uTwinkleIntensity'),
      uRotationSpeed: gl.getUniformLocation(program, 'uRotationSpeed'),
      uRepulsionStrength: gl.getUniformLocation(program, 'uRepulsionStrength'),
      uMouseActiveFactor: gl.getUniformLocation(program, 'uMouseActiveFactor'),
      uAutoCenterRepulsion: gl.getUniformLocation(program, 'uAutoCenterRepulsion'),
      uTransparent: gl.getUniformLocation(program, 'uTransparent')
    };

    // Props — tuned for performance & aesthetics
    const config = {
      focal: [0.5, 0.5],
      rotation: [1.0, 0.0],
      starSpeed: 0.5,
      density: 0.24,
      hueShift: 0.0,
      speed: 0.7,
      glowIntensity: 0.22,
      saturation: 0.0,
      mouseRepulsion: false,
      twinkleIntensity: 0.2,
      rotationSpeed: 0.0,
      repulsionStrength: 6.0,
      autoCenterRepulsion: 0.0,
      transparent: true
    };

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform3f(uLocations.uResolution, canvas.width, canvas.height, canvas.width / canvas.height);
    }

    function resizeHandler() { if (window.__PERF_MODE) return; resize(); }
    window.addEventListener('resize', resizeHandler);
    resize();

    // Set static uniforms
    gl.uniform2f(uLocations.uFocal, config.focal[0], config.focal[1]);
    gl.uniform2f(uLocations.uRotation, config.rotation[0], config.rotation[1]);
    gl.uniform1f(uLocations.uStarSpeed, config.starSpeed);
    gl.uniform1f(uLocations.uDensity, config.density);
    gl.uniform1f(uLocations.uHueShift, config.hueShift);
    gl.uniform1f(uLocations.uSpeed, config.speed);
    gl.uniform1f(uLocations.uGlowIntensity, config.glowIntensity);
    gl.uniform1f(uLocations.uSaturation, config.saturation);
    gl.uniform1i(uLocations.uMouseRepulsion, config.mouseRepulsion ? 1 : 0);
    gl.uniform1f(uLocations.uTwinkleIntensity, config.twinkleIntensity);
    gl.uniform1f(uLocations.uRotationSpeed, config.rotationSpeed);
    gl.uniform1f(uLocations.uRepulsionStrength, config.repulsionStrength);
    gl.uniform1f(uLocations.uAutoCenterRepulsion, config.autoCenterRepulsion);
    gl.uniform1i(uLocations.uTransparent, config.transparent ? 1 : 0);

    const targetMousePos = { x: 0.5, y: 0.5 };
    const smoothMousePos = { x: 0.5, y: 0.5 };
    let targetMouseActive = 0.0;
    let smoothMouseActive = 0.0;

    window.addEventListener('mousemove', (e) => {
      if (window.__PERF_MODE) return;
      targetMousePos.x = e.clientX / window.innerWidth;
      targetMousePos.y = 1.0 - (e.clientY / window.innerHeight);
      targetMouseActive = 1.0;
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
      targetMouseActive = 0.0;
    });

    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animationId = null;
    function render(t) {
      const timeSec = t * 0.001;

      gl.uniform1f(uLocations.uTime, timeSec);
      gl.uniform1f(uLocations.uStarSpeed, (timeSec * config.starSpeed) / 10.0);

      const lerpFactor = 0.05;
      smoothMousePos.x += (targetMousePos.x - smoothMousePos.x) * lerpFactor;
      smoothMousePos.y += (targetMousePos.y - smoothMousePos.y) * lerpFactor;
      smoothMouseActive += (targetMouseActive - smoothMouseActive) * lerpFactor;

      gl.uniform2f(uLocations.uMouse, smoothMousePos.x, smoothMousePos.y);
      gl.uniform1f(uLocations.uMouseActiveFactor, smoothMouseActive);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function frame(t) {
      if (window.__PERF_MODE) { animationId = null; return; }
      render(t);
      animationId = requestAnimationFrame(frame);
    }

    function start() {
      canvas.style.display = '';
      if (prefersReduced) {
        render(0); // single static frame
        return;
      }
      if (animationId == null) {
        animationId = requestAnimationFrame(frame);
      }
    }

    function stop() {
      if (animationId != null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      canvas.style.display = 'none';
    }

    // Drive start/stop from performance mode (initial state applied too).
    const off = window.perfMode && window.perfMode.on ? window.perfMode.on(function (perfOn) {
      if (perfOn) { stop(); } else { start(); }
    }) : (window.__PERF_MODE ? stop() : start());
  }

  initGalaxyBackground();
}
