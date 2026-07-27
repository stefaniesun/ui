import { readFileSync, writeFileSync } from 'node:fs';

const specFile = new URL('../civvi/analysis/stage2-object-sculpt-spec.json', import.meta.url);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));

const localFeaturesByComponent = {
  headlightLeft: [
    { id: 'headlightBoomerang', kind: 'contour', note: 'Boomerang projector outline visible from front three-quarter.' }
  ],
  headlightRight: [
    { id: 'headlightInnerSplit', kind: 'linework', note: 'Inner projector break on the opposite side.' }
  ],
  taillightLeft: [
    { id: 'taillightCClamp', kind: 'emissive', note: 'C-shaped taillight identity wrapping the quarter panel.' }
  ],
  taillightRight: [
    { id: 'taillightInnerTrunkSeam', kind: 'seam', note: 'Inner taillight segment meets the trunk edge.' }
  ],
  hood: [
    { id: 'hoodLeadingEdge', kind: 'seam', note: 'Front hood shut line above the grille zone.' }
  ],
  trunkLid: [
    { id: 'trunkCutLine', kind: 'seam', note: 'Sedan trunk separation from the rear quarter panels.' }
  ],
  greenhouse: [
    { id: 'beltlineTrimFeature', kind: 'linework', note: 'Side glass lower beltline accent wrapping the windows.' }
  ],
  mirrorLeft: [
    { id: 'mirrorCapFeature', kind: 'contour', note: 'Small black mirror cap volume and break line.' }
  ],
  wheelFrontLeft: [
    { id: 'wheelFiveSpokeFeature', kind: 'ridge', note: 'Five-spoke alloy read visible from the detail views.' }
  ],
  rearBumper: [
    { id: 'rearLowerInsertFeature', kind: 'groove', note: 'Dark lower rear bumper insert recessed into the fascia.' }
  ]
};

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
].map((component) => ({
  ...component,
  localFeatures: localFeaturesByComponent[component.id] ?? []
}));

const mesoComponents = [
  { id: 'frontGrille', name: 'frontGrille', parent: 'frontBumper', level: 'meso', role: 'grille', primitive: 'box', material: 'blackTrim', transform: { position: [1.86, 0.78, 0], scale: [0.18, 0.2, 0.94] }, dimensions: { width: 0.18, height: 0.2, depth: 0.94 } },
  { id: 'lowerIntake', name: 'lowerIntake', parent: 'frontBumper', level: 'meso', role: 'intake', primitive: 'box', material: 'blackTrim', transform: { position: [1.94, 0.5, 0], scale: [0.12, 0.14, 1.02] }, dimensions: { width: 0.12, height: 0.14, depth: 1.02 } },
  { id: 'rockerLeft', name: 'rockerLeft', parent: 'bodyShell', level: 'meso', role: 'trim', primitive: 'box', material: 'blackTrim', transform: { position: [0, 0.43, 0.83], scale: [2.94, 0.12, 0.08] }, dimensions: { width: 2.94, height: 0.12, depth: 0.08 } },
  { id: 'rockerRight', name: 'rockerRight', parent: 'bodyShell', level: 'meso', role: 'trim', primitive: 'box', material: 'blackTrim', transform: { position: [0, 0.43, -0.83], scale: [2.94, 0.12, 0.08] }, dimensions: { width: 2.94, height: 0.12, depth: 0.08 } },
  { id: 'rearLowerInsert', name: 'rearLowerInsert', parent: 'rearBumper', level: 'meso', role: 'trim', primitive: 'box', material: 'blackTrim', transform: { position: [-1.98, 0.46, 0], scale: [0.16, 0.16, 1.04] }, dimensions: { width: 0.16, height: 0.16, depth: 1.04 } },
  { id: 'licenseRecess', name: 'licenseRecess', parent: 'rearBumper', level: 'meso', role: 'recess', primitive: 'box', material: 'bodyPaint', transform: { position: [-1.9, 0.8, 0], scale: [0.12, 0.22, 0.52] }, dimensions: { width: 0.12, height: 0.22, depth: 0.52 } },
  { id: 'windowBeltlineLeft', name: 'windowBeltlineLeft', parent: 'greenhouse', level: 'meso', role: 'trim', primitive: 'box', material: 'blackTrim', transform: { position: [0.05, 1.04, 0.75], scale: [1.9, 0.05, 0.04] }, dimensions: { width: 1.9, height: 0.05, depth: 0.04 } },
  { id: 'fuelDoor', name: 'fuelDoor', parent: 'bodyShell', level: 'meso', role: 'panel', primitive: 'box', material: 'bodyPaint', transform: { position: [-1.18, 0.93, -0.8], scale: [0.02, 0.16, 0.14] }, dimensions: { width: 0.02, height: 0.16, depth: 0.14 } }
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
  mesoComponents: mesoComponents.length,
  microFeatureGroups: Object.values(localFeaturesByComponent).reduce((total, features) => total + features.length, 0),
  materialLayers: 6,
  repetitionSystems: 1
};

spec.preSpecAssessment.detailInventory.details = [
  { id: 'headlight-boomerang', componentId: 'headlightLeft', kind: 'contour', mapsTo: { ref: 'headlightLeft/headlightBoomerang' }, note: 'boomerang projector outline visible from front three-quarter' },
  { id: 'headlight-inner-split', componentId: 'headlightRight', kind: 'linework', mapsTo: { ref: 'headlightRight/headlightInnerSplit' }, note: 'inner projector break on opposite side' },
  { id: 'taillight-c-clamp', componentId: 'taillightLeft', kind: 'emissive', mapsTo: { ref: 'taillightLeft/taillightCClamp' }, note: 'C-shaped rear light identity' },
  { id: 'taillight-inner-trunk-seam', componentId: 'taillightRight', kind: 'seam', mapsTo: { ref: 'taillightRight/taillightInnerTrunkSeam' }, note: 'inner segment meets trunk edge' },
  { id: 'hood-leading-edge', componentId: 'hood', kind: 'seam', mapsTo: { ref: 'hood/hoodLeadingEdge' }, note: 'front shut line above grille zone' },
  { id: 'trunk-cut-line', componentId: 'trunkLid', kind: 'seam', mapsTo: { ref: 'trunkLid/trunkCutLine' }, note: 'sedan trunk separation from quarter panels' },
  { id: 'beltline-trim', componentId: 'greenhouse', kind: 'linework', mapsTo: { ref: 'greenhouse/beltlineTrimFeature' }, note: 'side glass lower beltline accent' },
  { id: 'mirror-cap', componentId: 'mirrorLeft', kind: 'contour', mapsTo: { ref: 'mirrorLeft/mirrorCapFeature' }, note: 'small black side mirror volume' },
  { id: 'wheel-five-spoke-read', componentId: 'wheelFrontLeft', kind: 'ridge', mapsTo: { ref: 'wheelFrontLeft/wheelFiveSpokeFeature' }, note: 'alloy spoke pattern from detail views' },
  { id: 'rear-lower-insert', componentId: 'rearBumper', kind: 'groove', mapsTo: { ref: 'rearBumper/rearLowerInsertFeature' }, note: 'dark lower bumper insert area' }
];

spec.materials = [
  { id: 'bodyPaint', name: 'Gloss White Body Paint', baseColor: '#f4f5f3', roughness: { base: 0.24, variation: 0.08 }, metalness: 0.18 },
  { id: 'glassTint', name: 'Dark Tinted Glass', baseColor: '#29323b', roughness: { base: 0.1, variation: 0.02 }, metalness: 0.0 },
  { id: 'blackTrim', name: 'Black Exterior Trim', baseColor: '#16181b', roughness: { base: 0.62, variation: 0.08 }, metalness: 0.0 },
  { id: 'alloyWheel', name: 'Silver Alloy Wheel', baseColor: '#b7bcc2', roughness: { base: 0.42, variation: 0.06 }, metalness: 0.72 },
  { id: 'tireRubber', name: 'Matte Tire Rubber', baseColor: '#101214', roughness: { base: 0.86, variation: 0.05 }, metalness: 0.0 },
  { id: 'lampLens', name: 'Lamp Lens', baseColor: '#ccd9ef', roughness: { base: 0.12, variation: 0.04 }, metalness: 0.0 }
];

spec.componentTree = [...macroComponents, ...mesoComponents];
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

delete spec.tier1Results;

writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
