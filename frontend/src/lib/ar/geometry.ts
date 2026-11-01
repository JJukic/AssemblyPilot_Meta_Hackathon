import * as THREE from "three";
import { validPlacement, type Placement } from "./data";
export const mm = (value: number) => value / 1000;
export function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = mesh.material
      ? Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      : [];
    materials.forEach((m) => {
      const map = (m as THREE.MeshBasicMaterial).map;
      map?.dispose();
      m.dispose();
    });
  });
}
export function ghost(p: Placement): THREE.Group {
  if (!validPlacement(p)) throw new Error("Invalid AR placement or dimensions");
  const root = new THREE.Group(),
    d = p.dimensions;
  const material = new THREE.MeshBasicMaterial({
    color: 0x3ce6ff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(mm(d.x_mm), mm(d.y_mm), mm(d.z_mm)),
    material,
  );
  body.position.y = mm(d.y_mm) / 2;
  root.add(body);
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0x91f3ff }),
  );
  outline.position.copy(body.position);
  root.add(outline);
  if (p.studs) {
    const s = p.studs;
    for (let x = 0; x < s.x; x++)
      for (let z = 0; z < s.z; z++) {
        const stud = new THREE.Mesh(
          new THREE.CylinderGeometry(
            mm(s.diameter_mm) / 2,
            mm(s.diameter_mm) / 2,
            mm(s.height_mm),
            12,
          ),
          material,
        );
        stud.position.set(
          mm((x - (s.x - 1) / 2) * s.pitch_mm),
          mm(d.y_mm + s.height_mm / 2),
          mm((z - (s.z - 1) / 2) * s.pitch_mm),
        );
        root.add(stud);
      }
  }
  root.add(
    new THREE.ArrowHelper(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, mm(d.y_mm) + 0.08, 0),
      0.06,
      0x91f3ff,
      0.02,
      0.015,
    ),
  );
  root.position.fromArray(p.position_m);
  root.rotation.set(
    ...(p.rotation_deg.map(THREE.MathUtils.degToRad) as [
      number,
      number,
      number,
    ]),
  );
  return root;
}
