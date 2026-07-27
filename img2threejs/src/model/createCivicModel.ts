import * as THREE from 'three';
import { create20162021HondaCivicSedanModel } from '../generated/civic-blockout';
import { refineCivicModel } from './refineCivicModel';

function restOnGround(model: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const min = box.min.clone();
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= min.y;
}

export function createCivicModel(): THREE.Group {
  const model = create20162021HondaCivicSedanModel({
    castShadow: true,
    receiveShadow: true
  });

  refineCivicModel(model);
  model.name = 'civic-root';
  restOnGround(model);
  model.rotation.y = Math.PI;
  model.scale.setScalar(1);
  return model;
}
