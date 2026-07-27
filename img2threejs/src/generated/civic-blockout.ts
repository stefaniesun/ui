import * as THREE from 'three';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object â€?same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below â€?it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F'),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: Math.max(1, readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: Math.max(1, readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clamp01(readLayerNumber(spec.specularIntensity, ['base'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: 2016-2021 Honda Civic Sedan
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function create20162021HondaCivicSedanModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "2016-2021 Honda Civic Sedan";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40, "aspect": 1, "orientation": {"yaw": 0, "pitch": 0, "roll": 0}, "positionHint": [0, 0, 3], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["bodyPaint"] = createSculptMaterial(
    "bodyPaint",
    {"id": "bodyPaint", "name": "Gloss White Body Paint", "baseColor": "#f4f5f3", "roughness": {"base": 0.24, "variation": 0.08}, "metalness": 0.18},
    options
  );
  materialMap["glassTint"] = createSculptMaterial(
    "glassTint",
    {"id": "glassTint", "name": "Dark Tinted Glass", "baseColor": "#29323b", "roughness": {"base": 0.1, "variation": 0.02}, "metalness": 0},
    options
  );
  materialMap["blackTrim"] = createSculptMaterial(
    "blackTrim",
    {"id": "blackTrim", "name": "Black Exterior Trim", "baseColor": "#16181b", "roughness": {"base": 0.62, "variation": 0.08}, "metalness": 0},
    options
  );
  materialMap["alloyWheel"] = createSculptMaterial(
    "alloyWheel",
    {"id": "alloyWheel", "name": "Silver Alloy Wheel", "baseColor": "#b7bcc2", "roughness": {"base": 0.42, "variation": 0.06}, "metalness": 0.72},
    options
  );
  materialMap["tireRubber"] = createSculptMaterial(
    "tireRubber",
    {"id": "tireRubber", "name": "Matte Tire Rubber", "baseColor": "#101214", "roughness": {"base": 0.86, "variation": 0.05}, "metalness": 0},
    options
  );
  materialMap["lampLens"] = createSculptMaterial(
    "lampLens",
    {"id": "lampLens", "name": "Lamp Lens", "baseColor": "#ccd9ef", "roughness": {"base": 0.12, "variation": 0.04}, "metalness": 0},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "civicRoot__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.85, 0.0);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(4.6, 1.45, 1.9);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "civicRoot", "parent": null, "level": "macro", "role": "body", "primitive": "box", "material": "bodyPaint", "transform": {"position": [0, 0.85, 0], "scale": [4.6, 1.45, 1.9]}, "dimensions": {"width": 4.6, "height": 1.45, "depth": 1.9}, "localFeatures": []};
  node_root_0.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["bodyPaint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "civicRoot";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "civicRoot", "parent": null, "level": "macro", "role": "body", "primitive": "box", "material": "bodyPaint", "transform": {"position": [0, 0.85, 0], "scale": [4.6, 1.45, 1.9]}, "dimensions": {"width": 4.6, "height": 1.45, "depth": 1.9}, "localFeatures": []};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {};

  const attachment_bodyShell_1 = null;
  const endpoint_bodyShell_1 = makeAttachmentEndpoint(attachment_bodyShell_1);
  const node_bodyShell_1 = new THREE.Group();
  node_bodyShell_1.name = "bodyShell__pivot";
  if (endpoint_bodyShell_1) {
    node_bodyShell_1.position.copy(endpoint_bodyShell_1.start);
    node_bodyShell_1.rotation.set(0, 0, 0);
    node_bodyShell_1.scale.set(1, 1, 1);
  } else {
    node_bodyShell_1.position.set(0.0, 0.92, 0.0);
    node_bodyShell_1.rotation.set(0, 0, 0);
    node_bodyShell_1.scale.set(4.45, 1.18, 1.82);
  }
  node_bodyShell_1.userData.sculptComponent = {"id": "bodyShell", "name": "bodyShell", "parent": "root", "level": "macro", "role": "body", "primitive": "box", "material": "bodyPaint", "transform": {"position": [0, 0.92, 0], "scale": [4.45, 1.18, 1.82]}, "dimensions": {"width": 4.45, "height": 1.18, "depth": 1.82}, "localFeatures": []};
  node_bodyShell_1.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_bodyShell_1);
  nodes["bodyShell"] = node_bodyShell_1;
  const mesh_bodyShell_1Geometry = endpoint_bodyShell_1
    ? new THREE.CylinderGeometry(endpoint_bodyShell_1.endRadius, endpoint_bodyShell_1.baseRadius, endpoint_bodyShell_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_bodyShell_1 = new THREE.Mesh(
    mesh_bodyShell_1Geometry,
    materialMap["bodyPaint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bodyShell_1.name = "bodyShell";
  if (endpoint_bodyShell_1) {
    mesh_bodyShell_1.position.copy(endpoint_bodyShell_1.midpoint);
    mesh_bodyShell_1.quaternion.copy(endpoint_bodyShell_1.quaternion);
  }
  mesh_bodyShell_1.castShadow = options.castShadow ?? true;
  mesh_bodyShell_1.receiveShadow = options.receiveShadow ?? true;
  mesh_bodyShell_1.userData.sculptComponent = {"id": "bodyShell", "name": "bodyShell", "parent": "root", "level": "macro", "role": "body", "primitive": "box", "material": "bodyPaint", "transform": {"position": [0, 0.92, 0], "scale": [4.45, 1.18, 1.82]}, "dimensions": {"width": 4.45, "height": 1.18, "depth": 1.82}, "localFeatures": []};
  node_bodyShell_1.add(mesh_bodyShell_1);
  meshes["bodyShell"] = mesh_bodyShell_1;
  colliders["bodyShell"] = {};

  const attachment_frontBumper_2 = null;
  const endpoint_frontBumper_2 = makeAttachmentEndpoint(attachment_frontBumper_2);
  const node_frontBumper_2 = new THREE.Group();
  node_frontBumper_2.name = "frontBumper__pivot";
  if (endpoint_frontBumper_2) {
    node_frontBumper_2.position.copy(endpoint_frontBumper_2.start);
    node_frontBumper_2.rotation.set(0, 0, 0);
    node_frontBumper_2.scale.set(1, 1, 1);
  } else {
    node_frontBumper_2.position.set(2.06, 0.63, 0.0);
    node_frontBumper_2.rotation.set(0, 0, 0);
    node_frontBumper_2.scale.set(0.58, 0.66, 1.78);
  }
  node_frontBumper_2.userData.sculptComponent = {"id": "frontBumper", "name": "frontBumper", "parent": "root", "level": "macro", "role": "bumper", "primitive": "box", "material": "bodyPaint", "transform": {"position": [2.06, 0.63, 0], "scale": [0.58, 0.66, 1.78]}, "dimensions": {"width": 0.58, "height": 0.66, "depth": 1.78}, "localFeatures": []};
  node_frontBumper_2.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_frontBumper_2);
  nodes["frontBumper"] = node_frontBumper_2;
  const mesh_frontBumper_2Geometry = endpoint_frontBumper_2
    ? new THREE.CylinderGeometry(endpoint_frontBumper_2.endRadius, endpoint_frontBumper_2.baseRadius, endpoint_frontBumper_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_frontBumper_2 = new THREE.Mesh(
    mesh_frontBumper_2Geometry,
    materialMap["bodyPaint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frontBumper_2.name = "frontBumper";
  if (endpoint_frontBumper_2) {
    mesh_frontBumper_2.position.copy(endpoint_frontBumper_2.midpoint);
    mesh_frontBumper_2.quaternion.copy(endpoint_frontBumper_2.quaternion);
  }
  mesh_frontBumper_2.castShadow = options.castShadow ?? true;
  mesh_frontBumper_2.receiveShadow = options.receiveShadow ?? true;
  mesh_frontBumper_2.userData.sculptComponent = {"id": "frontBumper", "name": "frontBumper", "parent": "root", "level": "macro", "role": "bumper", "primitive": "box", "material": "bodyPaint", "transform": {"position": [2.06, 0.63, 0], "scale": [0.58, 0.66, 1.78]}, "dimensions": {"width": 0.58, "height": 0.66, "depth": 1.78}, "localFeatures": []};
  node_frontBumper_2.add(mesh_frontBumper_2);
  meshes["frontBumper"] = mesh_frontBumper_2;
  colliders["frontBumper"] = {};

  const attachment_rearBumper_3 = null;
  const endpoint_rearBumper_3 = makeAttachmentEndpoint(attachment_rearBumper_3);
  const node_rearBumper_3 = new THREE.Group();
  node_rearBumper_3.name = "rearBumper__pivot";
  if (endpoint_rearBumper_3) {
    node_rearBumper_3.position.copy(endpoint_rearBumper_3.start);
    node_rearBumper_3.rotation.set(0, 0, 0);
    node_rearBumper_3.scale.set(1, 1, 1);
  } else {
    node_rearBumper_3.position.set(-2.06, 0.66, 0.0);
    node_rearBumper_3.rotation.set(0, 0, 0);
    node_rearBumper_3.scale.set(0.52, 0.62, 1.78);
  }
  node_rearBumper_3.userData.sculptComponent = {"id": "rearBumper", "name": "rearBumper", "parent": "root", "level": "macro", "role": "bumper", "primitive": "box", "material": "bodyPaint", "transform": {"position": [-2.06, 0.66, 0], "scale": [0.52, 0.62, 1.78]}, "dimensions": {"width": 0.52, "height": 0.62, "depth": 1.78}, "localFeatures": [{"id": "rearLowerInsertFeature", "kind": "groove", "note": "Dark lower rear bumper insert recessed into the fascia."}]};
  node_rearBumper_3.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_rearBumper_3);
  nodes["rearBumper"] = node_rearBumper_3;
  const mesh_rearBumper_3Geometry = endpoint_rearBumper_3
    ? new THREE.CylinderGeometry(endpoint_rearBumper_3.endRadius, endpoint_rearBumper_3.baseRadius, endpoint_rearBumper_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_rearBumper_3 = new THREE.Mesh(
    mesh_rearBumper_3Geometry,
    materialMap["bodyPaint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rearBumper_3.name = "rearBumper";
  if (endpoint_rearBumper_3) {
    mesh_rearBumper_3.position.copy(endpoint_rearBumper_3.midpoint);
    mesh_rearBumper_3.quaternion.copy(endpoint_rearBumper_3.quaternion);
  }
  mesh_rearBumper_3.castShadow = options.castShadow ?? true;
  mesh_rearBumper_3.receiveShadow = options.receiveShadow ?? true;
  mesh_rearBumper_3.userData.sculptComponent = {"id": "rearBumper", "name": "rearBumper", "parent": "root", "level": "macro", "role": "bumper", "primitive": "box", "material": "bodyPaint", "transform": {"position": [-2.06, 0.66, 0], "scale": [0.52, 0.62, 1.78]}, "dimensions": {"width": 0.52, "height": 0.62, "depth": 1.78}, "localFeatures": [{"id": "rearLowerInsertFeature", "kind": "groove", "note": "Dark lower rear bumper insert recessed into the fascia."}]};
  node_rearBumper_3.add(mesh_rearBumper_3);
  meshes["rearBumper"] = mesh_rearBumper_3;
  colliders["rearBumper"] = {};

  const attachment_hood_4 = null;
  const endpoint_hood_4 = makeAttachmentEndpoint(attachment_hood_4);
  const node_hood_4 = new THREE.Group();
  node_hood_4.name = "hood__pivot";
  if (endpoint_hood_4) {
    node_hood_4.position.copy(endpoint_hood_4.start);
    node_hood_4.rotation.set(0, 0, 0);
    node_hood_4.scale.set(1, 1, 1);
  } else {
    node_hood_4.position.set(1.22, 1.09, 0.0);
    node_hood_4.rotation.set(0, 0, 0);
    node_hood_4.scale.set(1.34, 0.18, 1.56);
  }
  node_hood_4.userData.sculptComponent = {"id": "hood", "name": "hood", "parent": "root", "level": "macro", "role": "panel", "primitive": "box", "material": "bodyPaint", "transform": {"position": [1.22, 1.09, 0], "scale": [1.34, 0.18, 1.56]}, "dimensions": {"width": 1.34, "height": 0.18, "depth": 1.56}, "localFeatures": [{"id": "hoodLeadingEdge", "kind": "seam", "note": "Front hood shut line above the grille zone."}]};
  node_hood_4.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_hood_4);
  nodes["hood"] = node_hood_4;
  const mesh_hood_4Geometry = endpoint_hood_4
    ? new THREE.CylinderGeometry(endpoint_hood_4.endRadius, endpoint_hood_4.baseRadius, endpoint_hood_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_hood_4 = new THREE.Mesh(
    mesh_hood_4Geometry,
    materialMap["bodyPaint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hood_4.name = "hood";
  if (endpoint_hood_4) {
    mesh_hood_4.position.copy(endpoint_hood_4.midpoint);
    mesh_hood_4.quaternion.copy(endpoint_hood_4.quaternion);
  }
  mesh_hood_4.castShadow = options.castShadow ?? true;
  mesh_hood_4.receiveShadow = options.receiveShadow ?? true;
  mesh_hood_4.userData.sculptComponent = {"id": "hood", "name": "hood", "parent": "root", "level": "macro", "role": "panel", "primitive": "box", "material": "bodyPaint", "transform": {"position": [1.22, 1.09, 0], "scale": [1.34, 0.18, 1.56]}, "dimensions": {"width": 1.34, "height": 0.18, "depth": 1.56}, "localFeatures": [{"id": "hoodLeadingEdge", "kind": "seam", "note": "Front hood shut line above the grille zone."}]};
  node_hood_4.add(mesh_hood_4);
  meshes["hood"] = mesh_hood_4;
  colliders["hood"] = {};

  const attachment_greenhouse_5 = null;
  const endpoint_greenhouse_5 = makeAttachmentEndpoint(attachment_greenhouse_5);
  const node_greenhouse_5 = new THREE.Group();
  node_greenhouse_5.name = "greenhouse__pivot";
  if (endpoint_greenhouse_5) {
    node_greenhouse_5.position.copy(endpoint_greenhouse_5.start);
    node_greenhouse_5.rotation.set(0, 0, 0);
    node_greenhouse_5.scale.set(1, 1, 1);
  } else {
    node_greenhouse_5.position.set(0.05, 1.26, 0.0);
    node_greenhouse_5.rotation.set(0, 0, 0);
    node_greenhouse_5.scale.set(2.05, 0.62, 1.46);
  }
  node_greenhouse_5.userData.sculptComponent = {"id": "greenhouse", "name": "greenhouse", "parent": "root", "level": "macro", "role": "glasshouse", "primitive": "box", "material": "glassTint", "transform": {"position": [0.05, 1.26, 0], "scale": [2.05, 0.62, 1.46]}, "dimensions": {"width": 2.05, "height": 0.62, "depth": 1.46}, "localFeatures": [{"id": "beltlineTrimFeature", "kind": "linework", "note": "Side glass lower beltline accent wrapping the windows."}]};
  node_greenhouse_5.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_greenhouse_5);
  nodes["greenhouse"] = node_greenhouse_5;
  const mesh_greenhouse_5Geometry = endpoint_greenhouse_5
    ? new THREE.CylinderGeometry(endpoint_greenhouse_5.endRadius, endpoint_greenhouse_5.baseRadius, endpoint_greenhouse_5.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_greenhouse_5 = new THREE.Mesh(
    mesh_greenhouse_5Geometry,
    materialMap["glassTint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_greenhouse_5.name = "greenhouse";
  if (endpoint_greenhouse_5) {
    mesh_greenhouse_5.position.copy(endpoint_greenhouse_5.midpoint);
    mesh_greenhouse_5.quaternion.copy(endpoint_greenhouse_5.quaternion);
  }
  mesh_greenhouse_5.castShadow = options.castShadow ?? true;
  mesh_greenhouse_5.receiveShadow = options.receiveShadow ?? true;
  mesh_greenhouse_5.userData.sculptComponent = {"id": "greenhouse", "name": "greenhouse", "parent": "root", "level": "macro", "role": "glasshouse", "primitive": "box", "material": "glassTint", "transform": {"position": [0.05, 1.26, 0], "scale": [2.05, 0.62, 1.46]}, "dimensions": {"width": 2.05, "height": 0.62, "depth": 1.46}, "localFeatures": [{"id": "beltlineTrimFeature", "kind": "linework", "note": "Side glass lower beltline accent wrapping the windows."}]};
  node_greenhouse_5.add(mesh_greenhouse_5);
  meshes["greenhouse"] = mesh_greenhouse_5;
  colliders["greenhouse"] = {};

  const attachment_trunkLid_6 = null;
  const endpoint_trunkLid_6 = makeAttachmentEndpoint(attachment_trunkLid_6);
  const node_trunkLid_6 = new THREE.Group();
  node_trunkLid_6.name = "trunkLid__pivot";
  if (endpoint_trunkLid_6) {
    node_trunkLid_6.position.copy(endpoint_trunkLid_6.start);
    node_trunkLid_6.rotation.set(0, 0, 0);
    node_trunkLid_6.scale.set(1, 1, 1);
  } else {
    node_trunkLid_6.position.set(-1.22, 1.03, 0.0);
    node_trunkLid_6.rotation.set(0, 0, 0);
    node_trunkLid_6.scale.set(1.08, 0.16, 1.52);
  }
  node_trunkLid_6.userData.sculptComponent = {"id": "trunkLid", "name": "trunkLid", "parent": "root", "level": "macro", "role": "panel", "primitive": "box", "material": "bodyPaint", "transform": {"position": [-1.22, 1.03, 0], "scale": [1.08, 0.16, 1.52]}, "dimensions": {"width": 1.08, "height": 0.16, "depth": 1.52}, "localFeatures": [{"id": "trunkCutLine", "kind": "seam", "note": "Sedan trunk separation from the rear quarter panels."}]};
  node_trunkLid_6.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_trunkLid_6);
  nodes["trunkLid"] = node_trunkLid_6;
  const mesh_trunkLid_6Geometry = endpoint_trunkLid_6
    ? new THREE.CylinderGeometry(endpoint_trunkLid_6.endRadius, endpoint_trunkLid_6.baseRadius, endpoint_trunkLid_6.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_trunkLid_6 = new THREE.Mesh(
    mesh_trunkLid_6Geometry,
    materialMap["bodyPaint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunkLid_6.name = "trunkLid";
  if (endpoint_trunkLid_6) {
    mesh_trunkLid_6.position.copy(endpoint_trunkLid_6.midpoint);
    mesh_trunkLid_6.quaternion.copy(endpoint_trunkLid_6.quaternion);
  }
  mesh_trunkLid_6.castShadow = options.castShadow ?? true;
  mesh_trunkLid_6.receiveShadow = options.receiveShadow ?? true;
  mesh_trunkLid_6.userData.sculptComponent = {"id": "trunkLid", "name": "trunkLid", "parent": "root", "level": "macro", "role": "panel", "primitive": "box", "material": "bodyPaint", "transform": {"position": [-1.22, 1.03, 0], "scale": [1.08, 0.16, 1.52]}, "dimensions": {"width": 1.08, "height": 0.16, "depth": 1.52}, "localFeatures": [{"id": "trunkCutLine", "kind": "seam", "note": "Sedan trunk separation from the rear quarter panels."}]};
  node_trunkLid_6.add(mesh_trunkLid_6);
  meshes["trunkLid"] = mesh_trunkLid_6;
  colliders["trunkLid"] = {};

  const attachment_mirrorLeft_7 = null;
  const endpoint_mirrorLeft_7 = makeAttachmentEndpoint(attachment_mirrorLeft_7);
  const node_mirrorLeft_7 = new THREE.Group();
  node_mirrorLeft_7.name = "mirrorLeft__pivot";
  if (endpoint_mirrorLeft_7) {
    node_mirrorLeft_7.position.copy(endpoint_mirrorLeft_7.start);
    node_mirrorLeft_7.rotation.set(0, 0, 0);
    node_mirrorLeft_7.scale.set(1, 1, 1);
  } else {
    node_mirrorLeft_7.position.set(0.82, 1.16, 0.88);
    node_mirrorLeft_7.rotation.set(0, 0, 0);
    node_mirrorLeft_7.scale.set(0.16, 0.18, 0.1);
  }
  node_mirrorLeft_7.userData.sculptComponent = {"id": "mirrorLeft", "name": "mirrorLeft", "parent": "root", "level": "macro", "role": "mirror", "primitive": "box", "material": "blackTrim", "transform": {"position": [0.82, 1.16, 0.88], "scale": [0.16, 0.18, 0.1]}, "dimensions": {"width": 0.16, "height": 0.18, "depth": 0.1}, "localFeatures": [{"id": "mirrorCapFeature", "kind": "contour", "note": "Small black mirror cap volume and break line."}]};
  node_mirrorLeft_7.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_mirrorLeft_7);
  nodes["mirrorLeft"] = node_mirrorLeft_7;
  const mesh_mirrorLeft_7Geometry = endpoint_mirrorLeft_7
    ? new THREE.CylinderGeometry(endpoint_mirrorLeft_7.endRadius, endpoint_mirrorLeft_7.baseRadius, endpoint_mirrorLeft_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mirrorLeft_7 = new THREE.Mesh(
    mesh_mirrorLeft_7Geometry,
    materialMap["blackTrim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mirrorLeft_7.name = "mirrorLeft";
  if (endpoint_mirrorLeft_7) {
    mesh_mirrorLeft_7.position.copy(endpoint_mirrorLeft_7.midpoint);
    mesh_mirrorLeft_7.quaternion.copy(endpoint_mirrorLeft_7.quaternion);
  }
  mesh_mirrorLeft_7.castShadow = options.castShadow ?? true;
  mesh_mirrorLeft_7.receiveShadow = options.receiveShadow ?? true;
  mesh_mirrorLeft_7.userData.sculptComponent = {"id": "mirrorLeft", "name": "mirrorLeft", "parent": "root", "level": "macro", "role": "mirror", "primitive": "box", "material": "blackTrim", "transform": {"position": [0.82, 1.16, 0.88], "scale": [0.16, 0.18, 0.1]}, "dimensions": {"width": 0.16, "height": 0.18, "depth": 0.1}, "localFeatures": [{"id": "mirrorCapFeature", "kind": "contour", "note": "Small black mirror cap volume and break line."}]};
  node_mirrorLeft_7.add(mesh_mirrorLeft_7);
  meshes["mirrorLeft"] = mesh_mirrorLeft_7;
  colliders["mirrorLeft"] = {};

  const attachment_mirrorRight_8 = null;
  const endpoint_mirrorRight_8 = makeAttachmentEndpoint(attachment_mirrorRight_8);
  const node_mirrorRight_8 = new THREE.Group();
  node_mirrorRight_8.name = "mirrorRight__pivot";
  if (endpoint_mirrorRight_8) {
    node_mirrorRight_8.position.copy(endpoint_mirrorRight_8.start);
    node_mirrorRight_8.rotation.set(0, 0, 0);
    node_mirrorRight_8.scale.set(1, 1, 1);
  } else {
    node_mirrorRight_8.position.set(0.82, 1.16, -0.88);
    node_mirrorRight_8.rotation.set(0, 0, 0);
    node_mirrorRight_8.scale.set(0.16, 0.18, 0.1);
  }
  node_mirrorRight_8.userData.sculptComponent = {"id": "mirrorRight", "name": "mirrorRight", "parent": "root", "level": "macro", "role": "mirror", "primitive": "box", "material": "blackTrim", "transform": {"position": [0.82, 1.16, -0.88], "scale": [0.16, 0.18, 0.1]}, "dimensions": {"width": 0.16, "height": 0.18, "depth": 0.1}, "localFeatures": []};
  node_mirrorRight_8.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_mirrorRight_8);
  nodes["mirrorRight"] = node_mirrorRight_8;
  const mesh_mirrorRight_8Geometry = endpoint_mirrorRight_8
    ? new THREE.CylinderGeometry(endpoint_mirrorRight_8.endRadius, endpoint_mirrorRight_8.baseRadius, endpoint_mirrorRight_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_mirrorRight_8 = new THREE.Mesh(
    mesh_mirrorRight_8Geometry,
    materialMap["blackTrim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mirrorRight_8.name = "mirrorRight";
  if (endpoint_mirrorRight_8) {
    mesh_mirrorRight_8.position.copy(endpoint_mirrorRight_8.midpoint);
    mesh_mirrorRight_8.quaternion.copy(endpoint_mirrorRight_8.quaternion);
  }
  mesh_mirrorRight_8.castShadow = options.castShadow ?? true;
  mesh_mirrorRight_8.receiveShadow = options.receiveShadow ?? true;
  mesh_mirrorRight_8.userData.sculptComponent = {"id": "mirrorRight", "name": "mirrorRight", "parent": "root", "level": "macro", "role": "mirror", "primitive": "box", "material": "blackTrim", "transform": {"position": [0.82, 1.16, -0.88], "scale": [0.16, 0.18, 0.1]}, "dimensions": {"width": 0.16, "height": 0.18, "depth": 0.1}, "localFeatures": []};
  node_mirrorRight_8.add(mesh_mirrorRight_8);
  meshes["mirrorRight"] = mesh_mirrorRight_8;
  colliders["mirrorRight"] = {};

  const attachment_headlightLeft_9 = null;
  const endpoint_headlightLeft_9 = makeAttachmentEndpoint(attachment_headlightLeft_9);
  const node_headlightLeft_9 = new THREE.Group();
  node_headlightLeft_9.name = "headlightLeft__pivot";
  if (endpoint_headlightLeft_9) {
    node_headlightLeft_9.position.copy(endpoint_headlightLeft_9.start);
    node_headlightLeft_9.rotation.set(0, 0, 0);
    node_headlightLeft_9.scale.set(1, 1, 1);
  } else {
    node_headlightLeft_9.position.set(1.92, 0.92, 0.58);
    node_headlightLeft_9.rotation.set(0, 0, 0);
    node_headlightLeft_9.scale.set(0.38, 0.18, 0.24);
  }
  node_headlightLeft_9.userData.sculptComponent = {"id": "headlightLeft", "name": "headlightLeft", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [1.92, 0.92, 0.58], "scale": [0.38, 0.18, 0.24]}, "dimensions": {"width": 0.38, "height": 0.18, "depth": 0.24}, "localFeatures": [{"id": "headlightBoomerang", "kind": "contour", "note": "Boomerang projector outline visible from front three-quarter."}]};
  node_headlightLeft_9.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_headlightLeft_9);
  nodes["headlightLeft"] = node_headlightLeft_9;
  const mesh_headlightLeft_9Geometry = endpoint_headlightLeft_9
    ? new THREE.CylinderGeometry(endpoint_headlightLeft_9.endRadius, endpoint_headlightLeft_9.baseRadius, endpoint_headlightLeft_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_headlightLeft_9 = new THREE.Mesh(
    mesh_headlightLeft_9Geometry,
    materialMap["lampLens"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headlightLeft_9.name = "headlightLeft";
  if (endpoint_headlightLeft_9) {
    mesh_headlightLeft_9.position.copy(endpoint_headlightLeft_9.midpoint);
    mesh_headlightLeft_9.quaternion.copy(endpoint_headlightLeft_9.quaternion);
  }
  mesh_headlightLeft_9.castShadow = options.castShadow ?? true;
  mesh_headlightLeft_9.receiveShadow = options.receiveShadow ?? true;
  mesh_headlightLeft_9.userData.sculptComponent = {"id": "headlightLeft", "name": "headlightLeft", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [1.92, 0.92, 0.58], "scale": [0.38, 0.18, 0.24]}, "dimensions": {"width": 0.38, "height": 0.18, "depth": 0.24}, "localFeatures": [{"id": "headlightBoomerang", "kind": "contour", "note": "Boomerang projector outline visible from front three-quarter."}]};
  node_headlightLeft_9.add(mesh_headlightLeft_9);
  meshes["headlightLeft"] = mesh_headlightLeft_9;
  colliders["headlightLeft"] = {};

  const attachment_headlightRight_10 = null;
  const endpoint_headlightRight_10 = makeAttachmentEndpoint(attachment_headlightRight_10);
  const node_headlightRight_10 = new THREE.Group();
  node_headlightRight_10.name = "headlightRight__pivot";
  if (endpoint_headlightRight_10) {
    node_headlightRight_10.position.copy(endpoint_headlightRight_10.start);
    node_headlightRight_10.rotation.set(0, 0, 0);
    node_headlightRight_10.scale.set(1, 1, 1);
  } else {
    node_headlightRight_10.position.set(1.92, 0.92, -0.58);
    node_headlightRight_10.rotation.set(0, 0, 0);
    node_headlightRight_10.scale.set(0.38, 0.18, 0.24);
  }
  node_headlightRight_10.userData.sculptComponent = {"id": "headlightRight", "name": "headlightRight", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [1.92, 0.92, -0.58], "scale": [0.38, 0.18, 0.24]}, "dimensions": {"width": 0.38, "height": 0.18, "depth": 0.24}, "localFeatures": [{"id": "headlightInnerSplit", "kind": "linework", "note": "Inner projector break on the opposite side."}]};
  node_headlightRight_10.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_headlightRight_10);
  nodes["headlightRight"] = node_headlightRight_10;
  const mesh_headlightRight_10Geometry = endpoint_headlightRight_10
    ? new THREE.CylinderGeometry(endpoint_headlightRight_10.endRadius, endpoint_headlightRight_10.baseRadius, endpoint_headlightRight_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_headlightRight_10 = new THREE.Mesh(
    mesh_headlightRight_10Geometry,
    materialMap["lampLens"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headlightRight_10.name = "headlightRight";
  if (endpoint_headlightRight_10) {
    mesh_headlightRight_10.position.copy(endpoint_headlightRight_10.midpoint);
    mesh_headlightRight_10.quaternion.copy(endpoint_headlightRight_10.quaternion);
  }
  mesh_headlightRight_10.castShadow = options.castShadow ?? true;
  mesh_headlightRight_10.receiveShadow = options.receiveShadow ?? true;
  mesh_headlightRight_10.userData.sculptComponent = {"id": "headlightRight", "name": "headlightRight", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [1.92, 0.92, -0.58], "scale": [0.38, 0.18, 0.24]}, "dimensions": {"width": 0.38, "height": 0.18, "depth": 0.24}, "localFeatures": [{"id": "headlightInnerSplit", "kind": "linework", "note": "Inner projector break on the opposite side."}]};
  node_headlightRight_10.add(mesh_headlightRight_10);
  meshes["headlightRight"] = mesh_headlightRight_10;
  colliders["headlightRight"] = {};

  const attachment_taillightLeft_11 = null;
  const endpoint_taillightLeft_11 = makeAttachmentEndpoint(attachment_taillightLeft_11);
  const node_taillightLeft_11 = new THREE.Group();
  node_taillightLeft_11.name = "taillightLeft__pivot";
  if (endpoint_taillightLeft_11) {
    node_taillightLeft_11.position.copy(endpoint_taillightLeft_11.start);
    node_taillightLeft_11.rotation.set(0, 0, 0);
    node_taillightLeft_11.scale.set(1, 1, 1);
  } else {
    node_taillightLeft_11.position.set(-1.96, 0.9, 0.63);
    node_taillightLeft_11.rotation.set(0, 0, 0);
    node_taillightLeft_11.scale.set(0.34, 0.2, 0.22);
  }
  node_taillightLeft_11.userData.sculptComponent = {"id": "taillightLeft", "name": "taillightLeft", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [-1.96, 0.9, 0.63], "scale": [0.34, 0.2, 0.22]}, "dimensions": {"width": 0.34, "height": 0.2, "depth": 0.22}, "localFeatures": [{"id": "taillightCClamp", "kind": "emissive", "note": "C-shaped taillight identity wrapping the quarter panel."}]};
  node_taillightLeft_11.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_taillightLeft_11);
  nodes["taillightLeft"] = node_taillightLeft_11;
  const mesh_taillightLeft_11Geometry = endpoint_taillightLeft_11
    ? new THREE.CylinderGeometry(endpoint_taillightLeft_11.endRadius, endpoint_taillightLeft_11.baseRadius, endpoint_taillightLeft_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_taillightLeft_11 = new THREE.Mesh(
    mesh_taillightLeft_11Geometry,
    materialMap["lampLens"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_taillightLeft_11.name = "taillightLeft";
  if (endpoint_taillightLeft_11) {
    mesh_taillightLeft_11.position.copy(endpoint_taillightLeft_11.midpoint);
    mesh_taillightLeft_11.quaternion.copy(endpoint_taillightLeft_11.quaternion);
  }
  mesh_taillightLeft_11.castShadow = options.castShadow ?? true;
  mesh_taillightLeft_11.receiveShadow = options.receiveShadow ?? true;
  mesh_taillightLeft_11.userData.sculptComponent = {"id": "taillightLeft", "name": "taillightLeft", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [-1.96, 0.9, 0.63], "scale": [0.34, 0.2, 0.22]}, "dimensions": {"width": 0.34, "height": 0.2, "depth": 0.22}, "localFeatures": [{"id": "taillightCClamp", "kind": "emissive", "note": "C-shaped taillight identity wrapping the quarter panel."}]};
  node_taillightLeft_11.add(mesh_taillightLeft_11);
  meshes["taillightLeft"] = mesh_taillightLeft_11;
  colliders["taillightLeft"] = {};

  const attachment_taillightRight_12 = null;
  const endpoint_taillightRight_12 = makeAttachmentEndpoint(attachment_taillightRight_12);
  const node_taillightRight_12 = new THREE.Group();
  node_taillightRight_12.name = "taillightRight__pivot";
  if (endpoint_taillightRight_12) {
    node_taillightRight_12.position.copy(endpoint_taillightRight_12.start);
    node_taillightRight_12.rotation.set(0, 0, 0);
    node_taillightRight_12.scale.set(1, 1, 1);
  } else {
    node_taillightRight_12.position.set(-1.96, 0.9, -0.63);
    node_taillightRight_12.rotation.set(0, 0, 0);
    node_taillightRight_12.scale.set(0.34, 0.2, 0.22);
  }
  node_taillightRight_12.userData.sculptComponent = {"id": "taillightRight", "name": "taillightRight", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [-1.96, 0.9, -0.63], "scale": [0.34, 0.2, 0.22]}, "dimensions": {"width": 0.34, "height": 0.2, "depth": 0.22}, "localFeatures": [{"id": "taillightInnerTrunkSeam", "kind": "seam", "note": "Inner taillight segment meets the trunk edge."}]};
  node_taillightRight_12.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_taillightRight_12);
  nodes["taillightRight"] = node_taillightRight_12;
  const mesh_taillightRight_12Geometry = endpoint_taillightRight_12
    ? new THREE.CylinderGeometry(endpoint_taillightRight_12.endRadius, endpoint_taillightRight_12.baseRadius, endpoint_taillightRight_12.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_taillightRight_12 = new THREE.Mesh(
    mesh_taillightRight_12Geometry,
    materialMap["lampLens"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_taillightRight_12.name = "taillightRight";
  if (endpoint_taillightRight_12) {
    mesh_taillightRight_12.position.copy(endpoint_taillightRight_12.midpoint);
    mesh_taillightRight_12.quaternion.copy(endpoint_taillightRight_12.quaternion);
  }
  mesh_taillightRight_12.castShadow = options.castShadow ?? true;
  mesh_taillightRight_12.receiveShadow = options.receiveShadow ?? true;
  mesh_taillightRight_12.userData.sculptComponent = {"id": "taillightRight", "name": "taillightRight", "parent": "root", "level": "macro", "role": "lamp", "primitive": "box", "material": "lampLens", "transform": {"position": [-1.96, 0.9, -0.63], "scale": [0.34, 0.2, 0.22]}, "dimensions": {"width": 0.34, "height": 0.2, "depth": 0.22}, "localFeatures": [{"id": "taillightInnerTrunkSeam", "kind": "seam", "note": "Inner taillight segment meets the trunk edge."}]};
  node_taillightRight_12.add(mesh_taillightRight_12);
  meshes["taillightRight"] = mesh_taillightRight_12;
  colliders["taillightRight"] = {};

  const attachment_wheelFrontLeft_13 = null;
  const endpoint_wheelFrontLeft_13 = makeAttachmentEndpoint(attachment_wheelFrontLeft_13);
  const node_wheelFrontLeft_13 = new THREE.Group();
  node_wheelFrontLeft_13.name = "wheelFrontLeft__pivot";
  if (endpoint_wheelFrontLeft_13) {
    node_wheelFrontLeft_13.position.copy(endpoint_wheelFrontLeft_13.start);
    node_wheelFrontLeft_13.rotation.set(0, 0, 0);
    node_wheelFrontLeft_13.scale.set(1, 1, 1);
  } else {
    node_wheelFrontLeft_13.position.set(1.16, 0.47, 0.84);
    node_wheelFrontLeft_13.rotation.set(1.5708, 0.0, 0.0);
    node_wheelFrontLeft_13.scale.set(0.64, 0.64, 0.22);
  }
  node_wheelFrontLeft_13.userData.sculptComponent = {"id": "wheelFrontLeft", "name": "wheelFrontLeft", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [1.16, 0.47, 0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": [{"id": "wheelFiveSpokeFeature", "kind": "ridge", "note": "Five-spoke alloy read visible from the detail views."}]};
  node_wheelFrontLeft_13.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_wheelFrontLeft_13);
  nodes["wheelFrontLeft"] = node_wheelFrontLeft_13;
  const mesh_wheelFrontLeft_13Geometry = endpoint_wheelFrontLeft_13
    ? new THREE.CylinderGeometry(endpoint_wheelFrontLeft_13.endRadius, endpoint_wheelFrontLeft_13.baseRadius, endpoint_wheelFrontLeft_13.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_wheelFrontLeft_13 = new THREE.Mesh(
    mesh_wheelFrontLeft_13Geometry,
    materialMap["tireRubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheelFrontLeft_13.name = "wheelFrontLeft";
  if (endpoint_wheelFrontLeft_13) {
    mesh_wheelFrontLeft_13.position.copy(endpoint_wheelFrontLeft_13.midpoint);
    mesh_wheelFrontLeft_13.quaternion.copy(endpoint_wheelFrontLeft_13.quaternion);
  }
  mesh_wheelFrontLeft_13.castShadow = options.castShadow ?? true;
  mesh_wheelFrontLeft_13.receiveShadow = options.receiveShadow ?? true;
  mesh_wheelFrontLeft_13.userData.sculptComponent = {"id": "wheelFrontLeft", "name": "wheelFrontLeft", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [1.16, 0.47, 0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": [{"id": "wheelFiveSpokeFeature", "kind": "ridge", "note": "Five-spoke alloy read visible from the detail views."}]};
  node_wheelFrontLeft_13.add(mesh_wheelFrontLeft_13);
  meshes["wheelFrontLeft"] = mesh_wheelFrontLeft_13;
  colliders["wheelFrontLeft"] = {};

  const attachment_wheelFrontRight_14 = null;
  const endpoint_wheelFrontRight_14 = makeAttachmentEndpoint(attachment_wheelFrontRight_14);
  const node_wheelFrontRight_14 = new THREE.Group();
  node_wheelFrontRight_14.name = "wheelFrontRight__pivot";
  if (endpoint_wheelFrontRight_14) {
    node_wheelFrontRight_14.position.copy(endpoint_wheelFrontRight_14.start);
    node_wheelFrontRight_14.rotation.set(0, 0, 0);
    node_wheelFrontRight_14.scale.set(1, 1, 1);
  } else {
    node_wheelFrontRight_14.position.set(1.16, 0.47, -0.84);
    node_wheelFrontRight_14.rotation.set(1.5708, 0.0, 0.0);
    node_wheelFrontRight_14.scale.set(0.64, 0.64, 0.22);
  }
  node_wheelFrontRight_14.userData.sculptComponent = {"id": "wheelFrontRight", "name": "wheelFrontRight", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [1.16, 0.47, -0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": []};
  node_wheelFrontRight_14.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_wheelFrontRight_14);
  nodes["wheelFrontRight"] = node_wheelFrontRight_14;
  const mesh_wheelFrontRight_14Geometry = endpoint_wheelFrontRight_14
    ? new THREE.CylinderGeometry(endpoint_wheelFrontRight_14.endRadius, endpoint_wheelFrontRight_14.baseRadius, endpoint_wheelFrontRight_14.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_wheelFrontRight_14 = new THREE.Mesh(
    mesh_wheelFrontRight_14Geometry,
    materialMap["tireRubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheelFrontRight_14.name = "wheelFrontRight";
  if (endpoint_wheelFrontRight_14) {
    mesh_wheelFrontRight_14.position.copy(endpoint_wheelFrontRight_14.midpoint);
    mesh_wheelFrontRight_14.quaternion.copy(endpoint_wheelFrontRight_14.quaternion);
  }
  mesh_wheelFrontRight_14.castShadow = options.castShadow ?? true;
  mesh_wheelFrontRight_14.receiveShadow = options.receiveShadow ?? true;
  mesh_wheelFrontRight_14.userData.sculptComponent = {"id": "wheelFrontRight", "name": "wheelFrontRight", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [1.16, 0.47, -0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": []};
  node_wheelFrontRight_14.add(mesh_wheelFrontRight_14);
  meshes["wheelFrontRight"] = mesh_wheelFrontRight_14;
  colliders["wheelFrontRight"] = {};

  const attachment_wheelRearLeft_15 = null;
  const endpoint_wheelRearLeft_15 = makeAttachmentEndpoint(attachment_wheelRearLeft_15);
  const node_wheelRearLeft_15 = new THREE.Group();
  node_wheelRearLeft_15.name = "wheelRearLeft__pivot";
  if (endpoint_wheelRearLeft_15) {
    node_wheelRearLeft_15.position.copy(endpoint_wheelRearLeft_15.start);
    node_wheelRearLeft_15.rotation.set(0, 0, 0);
    node_wheelRearLeft_15.scale.set(1, 1, 1);
  } else {
    node_wheelRearLeft_15.position.set(-1.18, 0.47, 0.84);
    node_wheelRearLeft_15.rotation.set(1.5708, 0.0, 0.0);
    node_wheelRearLeft_15.scale.set(0.64, 0.64, 0.22);
  }
  node_wheelRearLeft_15.userData.sculptComponent = {"id": "wheelRearLeft", "name": "wheelRearLeft", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [-1.18, 0.47, 0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": []};
  node_wheelRearLeft_15.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_wheelRearLeft_15);
  nodes["wheelRearLeft"] = node_wheelRearLeft_15;
  const mesh_wheelRearLeft_15Geometry = endpoint_wheelRearLeft_15
    ? new THREE.CylinderGeometry(endpoint_wheelRearLeft_15.endRadius, endpoint_wheelRearLeft_15.baseRadius, endpoint_wheelRearLeft_15.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_wheelRearLeft_15 = new THREE.Mesh(
    mesh_wheelRearLeft_15Geometry,
    materialMap["tireRubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheelRearLeft_15.name = "wheelRearLeft";
  if (endpoint_wheelRearLeft_15) {
    mesh_wheelRearLeft_15.position.copy(endpoint_wheelRearLeft_15.midpoint);
    mesh_wheelRearLeft_15.quaternion.copy(endpoint_wheelRearLeft_15.quaternion);
  }
  mesh_wheelRearLeft_15.castShadow = options.castShadow ?? true;
  mesh_wheelRearLeft_15.receiveShadow = options.receiveShadow ?? true;
  mesh_wheelRearLeft_15.userData.sculptComponent = {"id": "wheelRearLeft", "name": "wheelRearLeft", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [-1.18, 0.47, 0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": []};
  node_wheelRearLeft_15.add(mesh_wheelRearLeft_15);
  meshes["wheelRearLeft"] = mesh_wheelRearLeft_15;
  colliders["wheelRearLeft"] = {};

  const attachment_wheelRearRight_16 = null;
  const endpoint_wheelRearRight_16 = makeAttachmentEndpoint(attachment_wheelRearRight_16);
  const node_wheelRearRight_16 = new THREE.Group();
  node_wheelRearRight_16.name = "wheelRearRight__pivot";
  if (endpoint_wheelRearRight_16) {
    node_wheelRearRight_16.position.copy(endpoint_wheelRearRight_16.start);
    node_wheelRearRight_16.rotation.set(0, 0, 0);
    node_wheelRearRight_16.scale.set(1, 1, 1);
  } else {
    node_wheelRearRight_16.position.set(-1.18, 0.47, -0.84);
    node_wheelRearRight_16.rotation.set(1.5708, 0.0, 0.0);
    node_wheelRearRight_16.scale.set(0.64, 0.64, 0.22);
  }
  node_wheelRearRight_16.userData.sculptComponent = {"id": "wheelRearRight", "name": "wheelRearRight", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [-1.18, 0.47, -0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": []};
  node_wheelRearRight_16.userData.actionProfile = {};
  (nodes["root"] ?? root).add(node_wheelRearRight_16);
  nodes["wheelRearRight"] = node_wheelRearRight_16;
  const mesh_wheelRearRight_16Geometry = endpoint_wheelRearRight_16
    ? new THREE.CylinderGeometry(endpoint_wheelRearRight_16.endRadius, endpoint_wheelRearRight_16.baseRadius, endpoint_wheelRearRight_16.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  const mesh_wheelRearRight_16 = new THREE.Mesh(
    mesh_wheelRearRight_16Geometry,
    materialMap["tireRubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheelRearRight_16.name = "wheelRearRight";
  if (endpoint_wheelRearRight_16) {
    mesh_wheelRearRight_16.position.copy(endpoint_wheelRearRight_16.midpoint);
    mesh_wheelRearRight_16.quaternion.copy(endpoint_wheelRearRight_16.quaternion);
  }
  mesh_wheelRearRight_16.castShadow = options.castShadow ?? true;
  mesh_wheelRearRight_16.receiveShadow = options.receiveShadow ?? true;
  mesh_wheelRearRight_16.userData.sculptComponent = {"id": "wheelRearRight", "name": "wheelRearRight", "parent": "root", "level": "macro", "role": "wheel", "primitive": "cylinder", "material": "tireRubber", "transform": {"position": [-1.18, 0.47, -0.84], "rotation": [1.5708, 0, 0], "scale": [0.64, 0.64, 0.22]}, "dimensions": {"radius": 0.32, "height": 0.22, "depth": 0.22}, "localFeatures": []};
  node_wheelRearRight_16.add(mesh_wheelRearRight_16);
  meshes["wheelRearRight"] = mesh_wheelRearRight_16;
  colliders["wheelRearRight"] = {};

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}
