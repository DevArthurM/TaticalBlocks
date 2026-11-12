/**
 * GLSL do pós-processamento ("shaders"): oclusão de ambiente, raios de sol,
 * névoa volumétrica, bloom, gradação de cor e FXAA. Todos desenham um triângulo
 * que cobre a tela.
 */

export const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const COMMON = /* glsl */ `
  varying vec2 vUv;
  /** Ruído de gradiente intercalado (Jimenez): barato e sem padrão visível depois do desfoque. */
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }
`;

const VIEW_POS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  /** Posição no espaço da câmera a partir da profundidade (x direita, y cima, −z frente). */
  vec3 viewPos(vec2 uv, float depth) {
    vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  vec3 viewPosAt(vec2 uv) {
    return viewPos(uv, texture2D(tDepth, uv).x);
  }
`;

/**
 * Oclusão de ambiente (SSAO): escurece cantos, frestas e o encontro dos blocos com o
 * chão. A normal é reconstruída da profundidade; amostras em hemisfério com rotação por pixel.
 */
export const AO_FRAG = /* glsl */ `
  ${COMMON}
  ${VIEW_POS}
  uniform mat4 uProj;
  uniform vec2 uTexel;
  uniform float uRadius;

  void main() {
    float depth = texture2D(tDepth, vUv).x;
    if (depth >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewPos(vUv, depth);

    // normal: de cada lado usa o vizinho mais próximo em profundidade (não atravessa bordas)
    vec3 pr = viewPosAt(vUv + vec2(uTexel.x, 0.0));
    vec3 pl = viewPosAt(vUv - vec2(uTexel.x, 0.0));
    vec3 pu = viewPosAt(vUv + vec2(0.0, uTexel.y));
    vec3 pd = viewPosAt(vUv - vec2(0.0, uTexel.y));
    vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
    vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
    vec3 n = normalize(cross(dx, dy));

    vec3 up = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(up, n));
    vec3 b = cross(n, t);
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    // longe da câmera o raio em pixels fica minúsculo: cresce um pouco com a distância
    float radius = uRadius * (1.0 + -p.z * 0.02);
    float occ = 0.0;
    for (int i = 0; i < AO_SAMPLES; i++) {
      float fi = (float(i) + 0.5) / float(AO_SAMPLES);
      float a = float(i) * 2.399963 + rot;
      float r = sqrt(fi);
      vec3 dir = t * (cos(a) * r) + b * (sin(a) * r) + n * sqrt(1.0 - fi);
      vec3 sp = p + dir * radius * mix(0.25, 1.0, fi);
      vec4 c = uProj * vec4(sp, 1.0);
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      float sz = viewPosAt(uv).z;
      // só conta o que está perto (um objeto distante atrás não faz sombra aqui)
      float range = smoothstep(0.0, 1.0, radius / (abs(p.z - sz) + 1e-4));
      occ += step(sp.z + 0.03, sz) * range;
    }
    float ao = 1.0 - occ / float(AO_SAMPLES);
    gl_FragColor = vec4(vec3(ao), 1.0);
  }`;

/** Desfoque 4×4 da oclusão respeitando a profundidade (não vaza por cima das bordas). */
export const AO_BLUR_FRAG = /* glsl */ `
  ${COMMON}
  ${VIEW_POS}
  uniform sampler2D tAO;
  uniform vec2 uTexel;
  void main() {
    float z = viewPosAt(vUv).z;
    float sum = 0.0;
    float wsum = 0.0;
    for (int x = -2; x < 2; x++) {
      for (int y = -2; y < 2; y++) {
        vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
        float w = 1.0 / (1.0 + abs(viewPosAt(uv).z - z) * 6.0);
        sum += texture2D(tAO, uv).r * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4(vec3(sum / wsum), 1.0);
  }`;

/**
 * Raios de sol ("god rays"): de cada pixel caminha na tela em direção ao sol somando
 * o céu visível — onde blocos tapam o sol aparecem os feixes de luz e sombra.
 */
export const RAYS_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D tDepth;
  uniform vec2 uSunUv;
  uniform float uAspect;
  void main() {
    vec2 delta = (uSunUv - vUv) * (0.92 / float(RAY_SAMPLES));
    vec2 uv = vUv + delta * ign(gl_FragCoord.xy);
    float decay = 1.0;
    float sum = 0.0;
    for (int i = 0; i < RAY_SAMPLES; i++) {
      uv += delta;
      vec2 cuv = clamp(uv, 0.0, 1.0);
      // fora da tela: assume céu aberto (o sol pode estar logo além da borda)
      float sky = cuv == uv ? step(0.99999, texture2D(tDepth, uv).x) : 1.0;
      vec2 q = (uv - uSunUv) * vec2(uAspect, 1.0);
      sum += sky * exp(-dot(q, q) * 12.0) * decay;
      decay *= 0.968;
    }
    gl_FragColor = vec4(vec3(sum / float(RAY_SAMPLES)), 1.0);
  }`;

/**
 * Composição do mundo: aplica a oclusão, a névoa volumétrica (mais densa perto do
 * chão, dourada na direção do sol) e os raios de sol. Também faz o desfoque de fundo do menu T.
 */
export const COMPOSITE_FRAG = /* glsl */ `
  ${COMMON}
  ${VIEW_POS}
  uniform sampler2D tScene;
  uniform sampler2D tAO;
  uniform sampler2D tRays;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFogFalloff;
  uniform float uAoOn;
  uniform float uRaysOn;
  uniform vec2 uResolution;
  uniform float uBlurPx;
  uniform float uDim;

  vec3 sceneColor(vec2 uv) {
    vec3 c = texture2D(tScene, uv).rgb;
    if (uBlurPx > 0.0) {
      // desfoque em disco: 3 anéis × 12 amostras
      vec2 px = uBlurPx / uResolution;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5235988 + 0.13;
        vec2 d = vec2(cos(a), sin(a));
        c += texture2D(tScene, uv + d * px).rgb;
        c += texture2D(tScene, uv + d * px * 0.66 + d.yx * px * 0.12).rgb;
        c += texture2D(tScene, uv + d * px * 0.33).rgb;
      }
      c /= 37.0;
    }
    return c;
  }

  void main() {
    vec3 col = sceneColor(vUv);
    float depth = texture2D(tDepth, vUv).x;
    vec3 vp = viewPos(vUv, depth);
    vec3 rd = normalize((uCamWorld * vec4(vp, 0.0)).xyz);
    float sunAmt = max(dot(rd, uSunDir), 0.0);

    if (depth < 0.99999) {
      // oclusão: pesa menos no que está muito iluminado (a luz direta "lava" o canto)
      float ao = mix(1.0, texture2D(tAO, vUv).r, uAoOn);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(ao, 1.0, smoothstep(0.6, 2.0, lum) * 0.5);

      // névoa exponencial com altura (integral analítica ao longo do raio)
      float dist = length(vp);
      float ry = abs(rd.y) < 1e-3 ? 1e-3 : rd.y;
      float od = uFogDensity * exp(-uFogFalloff * max(uCamPos.y, 0.0)) * (1.0 - exp(-uFogFalloff * ry * dist)) / (uFogFalloff * ry);
      float fog = 1.0 - exp(-od);
      vec3 fogCol = mix(uFogColor, uSunColor, pow(sunAmt, 10.0) * 0.35);
      col = mix(col, fogCol, fog);
    }

    if (uRaysOn > 0.0) {
      // 4 amostras em cruz escondem o pontilhado da marcha
      vec2 o = 1.5 / uResolution;
      float rays = texture2D(tRays, vUv + o).r + texture2D(tRays, vUv - o).r
        + texture2D(tRays, vUv + vec2(o.x, -o.y)).r + texture2D(tRays, vUv + vec2(-o.x, o.y)).r;
      col += uSunColor * rays * 0.25 * uRaysOn;
    }

    // menu T: escurece um pouco e mais nas bordas — o olho vai para a arma
    float v = smoothstep(0.25, 0.95, length((vUv - 0.5) * vec2(1.4, 1.0)));
    col *= 1.0 - uDim * (0.18 + 0.45 * v);
    gl_FragColor = vec4(col, 1.0);
  }`;

/** Bloom, 1º passo: reduz à metade e guarda só o que passa do limiar (joelho suave). */
export const BLOOM_PREFILTER_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  uniform float uThreshold;
  vec3 bright(vec2 uv) {
    vec3 c = min(texture2D(tColor, uv).rgb, vec3(40.0));
    float b = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(b - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    // média ponderada (Karis): um pixel estourado não vira um quadrado piscando
    return c * max(soft, b - uThreshold) / max(b, 1e-4) / (1.0 + b * 0.25);
  }
  void main() {
    vec3 c = bright(vUv + uTexel * vec2(-1.0, -1.0)) + bright(vUv + uTexel * vec2(1.0, -1.0))
      + bright(vUv + uTexel * vec2(-1.0, 1.0)) + bright(vUv + uTexel * vec2(1.0, 1.0));
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`;

/** Bloom: reduz à metade (caixa de 4 amostras bilineares). */
export const BLOOM_DOWN_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  void main() {
    vec3 c = texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
      + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`;

/** Bloom: amplia com filtro em tenda 3×3 (somado ao nível de cima). */
export const BLOOM_UP_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb * 4.0;
    c += (texture2D(tColor, vUv + uTexel * vec2(1.0, 0.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(-1.0, 0.0)).rgb
      + texture2D(tColor, vUv + uTexel * vec2(0.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(0.0, -1.0)).rgb) * 2.0;
    c += texture2D(tColor, vUv + uTexel).rgb + texture2D(tColor, vUv - uTexel).rgb
      + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
    gl_FragColor = vec4(c / 16.0, 1.0);
  }`;

/**
 * Imagem final: soma o bloom, gradação de cor (sombras frias, luzes quentes), curva
 * de filme (ACES), vinheta e conversão para sRGB com um pontilhado contra faixas no céu.
 */
export const FINAL_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uExposure;

  vec3 aces(vec3 x) {
    // ajuste de Narkowicz da curva ACES
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
    c *= uExposure;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // cores mais vivas; sombras puxam para o azul e as áreas claras para o dourado
    c = mix(vec3(l), c, 1.06);
    c *= mix(vec3(0.95, 0.99, 1.07), vec3(1.04, 1.0, 0.95), smoothstep(0.0, 1.2, l));
    c = aces(max(c, 0.0));
    // um pouco de contraste em torno do cinza médio
    c = clamp(mix(vec3(0.5), c, 1.03), 0.0, 1.0);
    float vig = smoothstep(0.45, 1.15, length((vUv - 0.5) * vec2(1.25, 1.0)));
    c *= 1.0 - 0.22 * vig;
    c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }`;

/** FXAA (versão compacta de Lottes): suaviza serrilhado na imagem final já em sRGB. */
export const FXAA_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  void main() {
    const vec3 luma = vec3(0.299, 0.587, 0.114);
    vec3 rgbM = texture2D(tColor, vUv).rgb;
    float lNW = dot(texture2D(tColor, vUv + vec2(-1.0, -1.0) * uTexel).rgb, luma);
    float lNE = dot(texture2D(tColor, vUv + vec2(1.0, -1.0) * uTexel).rgb, luma);
    float lSW = dot(texture2D(tColor, vUv + vec2(-1.0, 1.0) * uTexel).rgb, luma);
    float lSE = dot(texture2D(tColor, vUv + vec2(1.0, 1.0) * uTexel).rgb, luma);
    float lM = dot(rgbM, luma);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * uTexel;
    vec3 a = 0.5 * (texture2D(tColor, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tColor, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture2D(tColor, vUv + dir * -0.5).rgb + texture2D(tColor, vUv + dir * 0.5).rgb);
    float lB = dot(b, luma);
    gl_FragColor = vec4(lB < lMin || lB > lMax ? a : b, 1.0);
  }`;
