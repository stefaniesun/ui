import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createCivicModel } from '../model/createCivicModel';
import { BACKGROUND_COLOR, CAMERA_START, LOOK_AT, ORBIT_LIMITS } from './sceneConfig';

type DisposableTextureCandidate = {
  dispose: () => void;
  isTexture: true;
};

function isDisposableTexture(candidate: unknown): candidate is DisposableTextureCandidate {
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    'isTexture' in candidate &&
    candidate.isTexture === true &&
    'dispose' in candidate &&
    typeof candidate.dispose === 'function'
  );
}

function disposeTexture(
  candidate: unknown,
  disposedTextures: Set<THREE.Texture>
): void {
  if (!isDisposableTexture(candidate)) {
    return;
  }

  const texture = candidate as THREE.Texture;
  if (disposedTextures.has(texture)) {
    return;
  }

  disposedTextures.add(texture);
  texture.dispose();
}

function disposeMaterial(
  material: THREE.Material,
  disposedMaterials: Set<THREE.Material>,
  disposedTextures: Set<THREE.Texture>
): void {
  if (disposedMaterials.has(material)) {
    return;
  }

  disposedMaterials.add(material);

  for (const value of Object.values(material)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        disposeTexture(entry, disposedTextures);
      }

      continue;
    }

    disposeTexture(value, disposedTextures);
  }

  material.dispose();
}

function disposeObjectResources(root: THREE.Object3D): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;

    if (mesh.geometry instanceof THREE.BufferGeometry && !disposedGeometries.has(mesh.geometry)) {
      disposedGeometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    for (const material of materials) {
      disposeMaterial(material, disposedMaterials, disposedTextures);
    }
  });
}

export function createPreviewScene(host: HTMLElement): () => void {
  const width = host.clientWidth || window.innerWidth;
  const height = host.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
  camera.position.set(...CAMERA_START);
  camera.lookAt(...LOOK_AT);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(...LOOK_AT);
  controls.minDistance = ORBIT_LIMITS.minDistance;
  controls.maxDistance = ORBIT_LIMITS.maxDistance;

  scene.add(new THREE.HemisphereLight(0xf6f8fb, 0x80868f, 1.15));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(6, 8, 4);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xd9e7ff, 0.75);
  fillLight.position.set(-5, 3, -4);
  scene.add(fillLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.ShadowMaterial({ opacity: 0.22 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const model = createCivicModel();
  scene.add(model);

  let disposed = false;
  let frameHandle = 0;

  const onResize = (): void => {
    const nextWidth = host.clientWidth || window.innerWidth;
    const nextHeight = host.clientHeight || window.innerHeight;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  };

  window.addEventListener('resize', onResize);

  const tick = (): void => {
    if (disposed) {
      return;
    }

    controls.update();
    renderer.render(scene, camera);
    frameHandle = requestAnimationFrame(tick);
  };

  tick();

  return () => {
    if (disposed) {
      return;
    }

    disposed = true;
    window.removeEventListener('resize', onResize);
    if (frameHandle && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameHandle);
    }
    controls.dispose();
    disposeObjectResources(ground);
    disposeObjectResources(model);
    scene.clear();
    renderer.renderLists?.dispose?.();
    renderer.dispose();
    host.replaceChildren();
  };
}
