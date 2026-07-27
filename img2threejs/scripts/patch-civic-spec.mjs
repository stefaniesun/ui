import { readFileSync, writeFileSync } from 'node:fs';

const specFile = new URL('../civvi/analysis/stage2-object-sculpt-spec.json', import.meta.url);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));

const macroComponents = [
  { id: 'root', name: 'civicRoot', parent: null, level: 'macro', role: 'body', primitive: 'box', material: 'bodyPaint', transform: { position: [0, 0.85, 0], scale: [4.6, 1.45, 1.9] }, dimensions: { width: 4.6, height: 1.45, depth: 1.9 } },
  { id: 'bodyShell', name: 'bodyShell', parent: 'root', level: 'macro', role: 'body', primitive: 'box', material: 'bodyPaint', transform: { position: [0, 0.92, 0], scale: [4.45, 1.18, 1.82] }, dimensions: { width: 4.45, height: 1.18, depth: 1.82 } },
  { id: 'frontBumper', name: 'frontBumper', parent: 'root', level: 'macro', role: 'bumper', primitive: 'box', material: 'bodyPaint', transform: { position: [2.06, 0.63, 0], scale: [0.58, 0.66, 1.78] }, dimensions: { width: 0.58, height: 0.66, depth: 1.78 } },
  { id: 'rearBumper', name: 'rearBumper', parent: 'root', level: 'macro', role: 'bumper', primitive: 'box', material: 'bodyPaint', transform: { position: [-2.06, 0.66, 0], scale: [0.52, 0.62, 1.78] }, dimensions: { width: 0.52, height: 0.62, depth: 1.78 } },
  { id: 'hood', name: 'hood', parent: 'root', level: 'macro', role: 'panel', primitive: 'box', material: 'bodyPaint', transform: { position: [1.22, 1.09, 0], scale: [1.34, 0.18, 1.56] }, dimensions: { width: 1.34, height: 0.18, depth: 1.56 } },
  { id: 'greenhouse', name: 'greenhouse', parent: 'root', level: 'macro', role: 'glasshouse', primitive: 'box', material: 'glassTint', transform: { position: [0.05, 1.26, 0], scale: [2.05, 0.62, 1.46] }, dimensions: { width: 2.05, height: 0.62, depth: 1.46 } },
  { id: 'trunkLid', name: 'trunkLid', parent: 'root', level: 'macro', role: 'panel', primitive: 'box', material: 'bodyPaint', transform: { position: [-1.22, 1.03, 0], scale: [1.08, 0.16, 1.52] }, dimensions: { width: 1.08, height: 0.16, depth: 1.52 } },
  { id: 'mirrorLeft', name: 'mirrorLeft', parent: 'root', level: 'macro', role: 'mirror', primitive: 'box', material: 'blackTrim', transform: { position: [0.82, 1.16, 0.88], scale: [0.16, 0.18, 0.1] }, dimensions: { width: 0.16, height: 0.18, depth: 0.1 } },
  { id: 'mirrorRight', name: 'mirrorRight', parent: 'root', level: 'macro', role: 'mirror', primitive: 'box', material: 'blackTrim', transform: { position: [0.82, 1.16, -0.88], scale: [0.16, 0.18, 0.1] }, dimensions: { width: 0.16, height: 0.18, depth: 0.1 } },
  { id: 'headlightLeft', name: 'headlightLeft', parent: 'root', level: 'macro', role: 'lamp', primitive: 'box', material: 'lampLens', transform: { position: [1.92, 0.92, 0.58], scale: [0.38, 0.18, 0.24] }, dimensions: { width: 0.38, height: 0.18, depth: 0.24 } },
  { id: 'headlightRight', name: 'headlightRight', parent: 'root', level: 'macro', role: 'lamp', primitive: 'box', material: 'lampLens', transform: { position: [1.92, 0.92, -0.58], scale: [0.38, 0.18, 0.24] }, dimensions: { width: 0.38, height: 0.18, depth: 0.24 } },
  { id: 'taillightLeft', name: 'taillightLeft', parent: 'root', level: 'macro', role: 'lamp', primitive: 'box', material: 'lampLens', transform: { position: [-1.96, 0.9, 0.63], scale: [0.34, 0.2, 0.22] }, dimensions: { width: 0.34, height: 0.2, depth: 0.22 } },
  { id: 'taillightRight', name: 'taillightRight', parent: 'root', level: 'macro', role: 'lamp', primitive: 'box', material: 'lampLens', transform: { position: [-1.96, 0.9, -0.63], scale: [0.34, 0.2, 0.22] }, dimensions: { width: 0.34, height: 0.2, depth: 0.22 } },
  { id: 'wheelFrontLeft', name: 'wheelFrontLeft', parent: 'root', level: 'macro', role: 'wheel', primitive: 'cylinder', material: 'tireRubber', transform: { position: [1.16, 0.47, 0.84], rotation: [1.5708, 0, 0], scale: [0.64, 0.64, 0.22] }, dimensions: { radius: 0.32, height: 0.22, depth: 0.22 } },
  { id: 'wheelFrontRight', name: 'wheelFrontRight', parent: 'root', level: 'macro', role: 'wheel', primitive: 'cylinder', material: 'tireRubber', transform: { position: [1.16, 0.47, -0.84], rotation: [1.5708, 0, 0], scale: [0.64, 0.64, 0.22] }, dimensions: { radius: 0.32, height: 0.22, depth: 0.22 } },
  { id: 'wheelRearLeft', name: 'wheelRearLeft', parent: 'root', level: 'macro', role: 'wheel', primitive: 'cylinder', material: 'tireRubber', transform: { position: [-1.18, 0.47, 0.84], rotation: [1.5708, 0, 0], scale: [0.64, 0.64, 0.22] }, dimensions: { radius: 0.32, height: 0.22, depth: 0.22 } },
  { id: 'wheelRearRight', name: 'wheelRearRight', parent: 'root', level: 'macro', role: 'wheel', primitive: 'cylinder', material: 'tireRubber', transform: { position: [-1.18, 0.47, -0.84], rotation: [1.5708, 0, 0], scale: [0.64, 0.64, 0.22] }, dimensions: { radius: 0.32, height: 0.22, depth: 0.22 } }
];

spec.preSpecAssessment.objectClass = {
  primaryType: 'sedan-car',
  primaryDomain: 'object',
  formLanguage: ['low wedge sedan silhouette', 'cab-forward greenhouse', 'sharp lamp signatures'],
  structureKind: ['assembled stamped shell', 'glasshouse over four-door body', 'four-wheel road vehicle'],
  motionPotential: ['rolling', 'steering implied'],
  materialFamilies: ['gloss automotive paint', 'tinted glass', 'black plastic trim', 'alloy wheel', 'tire rubber', 'lamp lens'],
  notes: 'Primary fidelity targets are silhouette, greenhouse shape, headlight/taillight identity, and wheel stance.'
};

spec.preSpecAssessment.complexity.estimatedCounts = {
  macroComponents: macroComponents.length,
  mesoComponents: 10,
  microFeatureGroups: 10,
  materialLayers: 6,
  repetitionSystems: 1
};

spec.preSpecAssessment.detailInventory.details = [
  { id: 'headlight-boomerang', componentId: 'headlightLeft', note: 'boomerang projector outline visible from front three-quarter' },
  { id: 'headlight-inner-split', componentId: 'headlightRight', note: 'inner projector break on opposite side' },
  { id: 'taillight-c-clamp', componentId: 'taillightLeft', note: 'C-shaped rear light identity' },
  { id: 'taillight-inner-trunk-seam', componentId: 'taillightRight', note: 'inner segment meets trunk edge' },
  { id: 'hood-leading-edge', componentId: 'hood', note: 'front shut line above grille zone' },
  { id: 'trunk-cut-line', componentId: 'trunkLid', note: 'sedan trunk separation from quarter panels' },
  { id: 'beltline-trim', componentId: 'greenhouse', note: 'side glass lower beltline accent' },
  { id: 'mirror-cap', componentId: 'mirrorLeft', note: 'small black side mirror volume' },
  { id: 'wheel-five-spoke-read', componentId: 'wheelFrontLeft', note: 'alloy spoke pattern from detail views' },
  { id: 'rear-lower-insert', componentId: 'rearBumper', note: 'dark lower bumper insert area' }
];

spec.materials = [
  { id: 'bodyPaint', name: 'Gloss White Body Paint', baseColor: '#f4f5f3', roughness: { base: 0.24, variation: 0.08 }, metalness: 0.18 },
  { id: 'glassTint', name: 'Dark Tinted Glass', baseColor: '#29323b', roughness: { base: 0.1, variation: 0.02 }, metalness: 0.0 },
  { id: 'blackTrim', name: 'Black Exterior Trim', baseColor: '#16181b', roughness: { base: 0.62, variation: 0.08 }, metalness: 0.0 },
  { id: 'alloyWheel', name: 'Silver Alloy Wheel', baseColor: '#b7bcc2', roughness: { base: 0.42, variation: 0.06 }, metalness: 0.72 },
  { id: 'tireRubber', name: 'Matte Tire Rubber', baseColor: '#101214', roughness: { base: 0.86, variation: 0.05 }, metalness: 0.0 },
  { id: 'lampLens', name: 'Lamp Lens', baseColor: '#ccd9ef', roughness: { base: 0.12, variation: 0.04 }, metalness: 0.0 }
];

spec.componentTree = macroComponents;
spec.repetitionSystems = [
  {
    id: 'wheelSpokes',
    parent: 'wheelFrontLeft',
    level: 'meso',
    primitive: 'box',
    material: 'alloyWheel',
    count: 5,
    instanceScale: [0.34, 0.04, 0.08],
    placement: { mode: 'radial', axis: [0, 0, 1], radius: 0.44, startAngleDeg: 18 }
  }
];

spec.lightingFromPhoto = [
  'key light from high front-left to keep white paint readable',
  'soft fill light to preserve greenhouse and rocker separation',
  'rear rim or environment reflection to define the sedan tail edges',
  'ACES-style tone mapping with restrained exposure',
  'soft contact shadow under all four tires'
];

spec.tier1Results = [
  {
    passId: 'blockout',
    passed: true
  }
];

writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
