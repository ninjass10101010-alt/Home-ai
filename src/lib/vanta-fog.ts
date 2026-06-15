import { ShaderBase, type ShaderOptions } from "./vanta-shader-base";

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float blurFactor;
uniform vec3 baseColor;
uniform vec3 lowlightColor;
uniform vec3 midtoneColor;
uniform vec3 highlightColor;
uniform float zoom;

varying vec2 vUv;

float random (in vec2 _st) {
  return fract(sin(dot(_st.xy, vec2(0.129898, 0.78233))) * 437.585453123);
}

float noise (in vec2 _st) {
  vec2 i = floor(_st);
  vec2 f = fract(_st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

#define NUM_OCTAVES 6

float fbm (in vec2 _st) {
  float v = 0.0;
  float a = blurFactor;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
  for (int i = 0; i < NUM_OCTAVES; ++i) {
    v += a * noise(_st);
    _st = rot * _st * 2.0 + shift;
    a *= (1.0 - blurFactor);
  }
  return v;
}

void main() {
  vec2 st = vUv * 3.0;
  st.x *= 0.7 * iResolution.x / iResolution.y;
  st *= zoom;

  vec3 color = vec3(0.0);

  vec2 q = vec2(0.0);
  q.x = fbm(st + 0.00 * iTime);
  q.y = fbm(st + vec2(1.0));

  vec2 dir = vec2(0.15, 0.126);
  vec2 r = vec2(0.0);
  r.x = fbm(st + 1.0 * q + vec2(1.7, 9.2) + dir.x * iTime);
  r.y = fbm(st + 1.0 * q + vec2(8.3, 2.8) + dir.y * iTime);

  float f = fbm(st + r);

  color = mix(baseColor,
              lowlightColor,
              clamp((f * f) * 4.0, 0.0, 1.0));

  color = mix(color,
              midtoneColor,
              clamp(length(q), 0.0, 1.0));

  color = mix(color,
              highlightColor,
              clamp(length(r.x), 0.0, 1.0));

  vec3 finalColor = mix(baseColor, color, f * f * f + 0.6 * f * f + 0.5 * f);
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

interface FogOptions extends ShaderOptions {
  baseColor?: number;
  lowlightColor?: number;
  midtoneColor?: number;
  highlightColor?: number;
  blurFactor?: number;
  zoom?: number;
}

const DEFAULT_OPTIONS: Partial<ShaderOptions> = {
  baseColor: 0xe8f0f8,
  lowlightColor: 0x7ba7cc,
  midtoneColor: 0xf0e8e0,
  highlightColor: 0xe8c870,
  blurFactor: 0.5,
  speed: 0.7,
  zoom: 1.0,
  mouseControls: false,
  touchControls: false,
  backgroundColor: 0x000000,
  backgroundAlpha: 0,
};

export class FogEffect extends ShaderBase {
  declare fragmentShader: string;
  declare vertexShader: string;

  constructor(userOptions: FogOptions) {
    super({ ...DEFAULT_OPTIONS, ...userOptions });
  }

  getDefaultOptions(): Partial<ShaderOptions> {
    return { ...DEFAULT_OPTIONS };
  }
}

Object.defineProperty(FogEffect.prototype, "fragmentShader", {
  value: FRAGMENT_SHADER,
  writable: false,
  configurable: false,
});
Object.defineProperty(FogEffect.prototype, "vertexShader", {
  value: VERTEX_SHADER,
  writable: false,
  configurable: false,
});

export function createFogEffect(options: FogOptions): FogEffect {
  return new FogEffect(options);
}