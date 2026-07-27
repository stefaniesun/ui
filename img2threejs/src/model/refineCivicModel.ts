import * as THREE from 'three';

function hasDirectChild(parent: THREE.Object3D, name: string): boolean {
  return parent.children.some((child) => child.name === name);
}

function addLens(parent: THREE.Object3D, name: string, color: number): void {
  if (hasDirectChild(parent, name)) {
    return;
  }

  const lens = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.1, 0.04),
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.08,
      transmission: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.9
    })
  );

  lens.name = name;
  lens.position.z = 0.06;
  parent.add(lens);
}

function addWheelFace(parent: THREE.Object3D, name: string): void {
  if (hasDirectChild(parent, name)) {
    return;
  }

  const wheelPosition = parent.userData.sculptComponent?.transform?.position as
    | [number, number, number]
    | undefined;
  const side = Math.sign(wheelPosition?.[2] ?? 0) || 1;

  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.05, 5),
    new THREE.MeshStandardMaterial({
      color: 0xbcc3cb,
      roughness: 0.38,
      metalness: 0.8
    })
  );

  face.rotation.z = Math.PI / 2;
  face.position.y = side * 0.08;
  face.name = name;
  parent.add(face);
}

export function refineCivicModel(model: THREE.Group): void {
  const headlightLeft = model.getObjectByName('headlightLeft');
  const headlightRight = model.getObjectByName('headlightRight');
  const taillightLeft = model.getObjectByName('taillightLeft');
  const taillightRight = model.getObjectByName('taillightRight');

  if (headlightLeft) {
    addLens(headlightLeft, 'headlightLeftLens', 0xdce8ff);
  }

  if (headlightRight) {
    addLens(headlightRight, 'headlightRightLens', 0xdce8ff);
  }

  if (taillightLeft) {
    addLens(taillightLeft, 'taillightLeftLens', 0xff5448);
  }

  if (taillightRight) {
    addLens(taillightRight, 'taillightRightLens', 0xff5448);
  }

  for (const wheelName of ['wheelFrontLeft', 'wheelFrontRight', 'wheelRearLeft', 'wheelRearRight']) {
    const wheel = model.getObjectByName(wheelName);
    if (wheel) {
      addWheelFace(wheel, `${wheelName}Face`);
    }
  }
}
