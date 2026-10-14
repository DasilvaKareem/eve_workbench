import {
  BoxGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh,
  Mesh, MeshStandardMaterial, Object3D, SphereGeometry,
  type BufferGeometry,
} from '@iwsdk/core';

// Evaluated independently by the editor and runtime. All variation is arithmetic;
// there is no DOM, random source, runtime world, or per-frame environment work.
const material = (color: string, roughness = 0.78, metalness = 0) =>
  new MeshStandardMaterial({ color, roughness, metalness });
const oak = material('#966542');
const walnut = material('#50382b');
const paleWood = material('#c39969');
const plaster = material('#e2d8bc');
const stone = material('#c7bd9f');
const iron = material('#29352f', 0.48, 0.45);
const brass = material('#ae8c4a', 0.35, 0.65);
const moss = material('#61705a');
const fabric = material('#738575', 0.96);
const rug = material('#c2b28e', 1);
const terra = material('#a96343');
const ceramic = material('#efe4ca', 0.38);
const coffee = material('#33241a');
const leaves = ['#4c6941', '#6f8550', '#38553b'].map(c => material(c));
const bookColors = ['#bba67e', '#526c65', '#a26748', '#807b61', '#ded2ae', '#454e4a'].map(c => material(c));
const floorColors = ['#a57e52', '#b08a5e', '#977149', '#bc9668'].map(c => material(c));
const glow = new MeshStandardMaterial({ color: '#ffe4a3', emissive: '#ffd58a', emissiveIntensity: 1.3 });
const glass = new MeshStandardMaterial({ color: '#c4d9d3', transparent: true, opacity: 0.1, roughness: 0.18, depthWrite: false, side: DoubleSide });

const box = new BoxGeometry(1, 1, 1);
const cylinder = new CylinderGeometry(1, 1, 1, 20);
const cone = new CylinderGeometry(0.65, 1, 1, 20);
const orb = new SphereGeometry(1, 10, 6);
type Mat = MeshStandardMaterial;
type Pose = { position: [number, number, number]; scale: [number, number, number]; rotation: [number, number, number] };

// Batch static repeated forms per geometry/material, keeping draw calls bounded.
class StaticAsset {
  private batches = new Map<BufferGeometry, Map<Mat, Pose[]>>();
  constructor(private name: string) {}
  add(geometry: BufferGeometry, mat: Mat, position: Pose['position'], scale: Pose['scale'], rotation: Pose['rotation'] = [0, 0, 0]) {
    let materials = this.batches.get(geometry);
    if (!materials) this.batches.set(geometry, materials = new Map());
    let poses = materials.get(mat);
    if (!poses) materials.set(mat, poses = []);
    poses.push({ position, scale, rotation });
  }
  box(mat: Mat, x: number, y: number, z: number, w: number, h: number, d: number, rotation: Pose['rotation'] = [0, 0, 0]) {
    this.add(box, mat, [x, y, z], [w, h, d], rotation);
  }
  round(mat: Mat, x: number, y: number, z: number, radius: number, height: number) {
    this.add(cylinder, mat, [x, y, z], [radius, height, radius]);
  }
  finish() {
    const root = new Group();
    root.name = this.name;
    const pose = new Object3D();
    for (const [geometry, materials] of this.batches) {
      for (const [mat, poses] of materials) {
        const mesh = new InstancedMesh(geometry, mat, poses.length);
        mesh.name = `${this.name} / ${mat.color.getHexString()}`;
        for (let i = 0; i < poses.length; i++) {
          const p = poses[i];
          pose.position.set(...p.position);
          pose.rotation.set(...p.rotation);
          pose.scale.set(...p.scale);
          pose.updateMatrix();
          mesh.setMatrixAt(i, pose.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        root.add(mesh);
      }
    }
    return root;
  }
}

const floor = new StaticAsset('Cafe oak floor');
for (let row = 0; row < 30; row++) {
  for (let col = 0; col < 4; col++) {
    floor.box(floorColors[(row + col * 3) % 4], -4.5 + col * 3, -0.025, -6.8 + row * 0.4, 2.99, 0.05, 0.392);
  }
}
export const cafeFloorboards = floor.finish();
// Keep the walkable support an ordinary mesh: navigation backends do not all
// expand InstancedMesh transforms when collecting environment triangles.
const walkableGeometry = new BoxGeometry(12.1, 0.12, 12.1);
walkableGeometry.translate(0, -0.06, -1);
export const cafeFloor = new Mesh(walkableGeometry, walnut);
cafeFloor.name = 'Continuous cafe walkable floor';

const shell = new StaticAsset('Cafe timber and glass architecture');
shell.box(plaster, 0, 2.25, -7, 12.2, 4.5, 0.2);
shell.box(walnut, 0, 0.12, -6.85, 12, 0.24, 0.13);
shell.box(oak, 0, 3.65, -6.83, 12, 0.12, 0.16);
for (const x of [-6, 6]) {
  shell.box(stone, x, 0.26, -1, 0.18, 0.52, 12);
  shell.box(walnut, x, 0.56, -1, 0.28, 0.1, 12);
  shell.box(walnut, x, 4.2, -1, 0.23, 0.24, 12);
  for (let z = -7; z <= 5; z += 2) {
    shell.box(iron, x, 2.38, z, 0.09, 3.65, 0.09);
    if (z < 5) shell.box(glass, x, 2.37, z + 1, 0.018, 3.56, 1.92);
  }
  shell.box(iron, x, 1.45, -1, 0.1, 0.055, 12);
  shell.box(iron, x, 3.35, -1, 0.1, 0.055, 12);
}
// Rear gable with roof panes and repeating oak rafters.
const pitch = Math.atan2(1.15, 6);
const rafterLength = Math.hypot(6, 1.15);
for (let z = -7; z <= 5; z += 2) {
  shell.box(walnut, 0, 4.25, z, 12.1, 0.15, 0.18);
  for (const side of [-1, 1]) {
    shell.box(oak, side * 3, 4.775, z, rafterLength, 0.18, 0.19, [0, -0, -side * pitch]);
    if (z < 5) shell.box(glass, side * 3, 4.85, z + 1, rafterLength, 0.025, 1.81, [0, 0, -side * pitch]);
  }
}
shell.box(oak, 0, 5.35, -1, 0.22, 0.2, 12.15);
for (let x = -6; x <= 6; x += 2) {
  shell.box(iron, x, 2.35, 5, 0.09, 3.7, 0.09);
  if (x < 6) shell.box(glass, x + 1, 2.35, 5, 1.91, 3.6, 0.018);
}
shell.box(walnut, 0, 4.2, 5, 12, 0.24, 0.24);
export const cafeArchitecture = shell.finish();

const library = new StaticAsset('Cafe library wall');
// Left wall shelves face into the room, with a low cabinet beneath them.
for (let bay = 0; bay < 4; bay++) {
  const z = -5.7 + bay * 2.1;
  library.box(walnut, -5.77, 1.73, z, 0.18, 3.2, 2.04);
  library.box(oak, -5.49, 0.42, z, 0.64, 0.82, 2.03);
  library.box(paleWood, -5.15, 0.42, z, 0.025, 0.68, 1.85);
  library.box(brass, -5.12, 0.6, z, 0.05, 0.035, 0.25);
  for (const end of [-1, 1]) library.box(oak, -5.48, 1.78, z + end, 0.67, 3.4, 0.09);
  for (let shelf = 0; shelf < 4; shelf++) {
    const y = 0.86 + shelf * 0.65;
    library.box(oak, -5.46, y, z, 0.7, 0.075, 1.96);
    for (let book = 0; book < 11; book++) {
      const height = 0.3 + ((book * 7 + bay * 3 + shelf * 11) % 9) * 0.025;
      const depth = 0.27 + (book % 3) * 0.025;
      const bz = z - 0.86 + book * 0.155;
      library.box(bookColors[(book + shelf + bay) % bookColors.length], -5.37, y + 0.055 + height / 2, bz, depth, height, 0.105);
      library.box(brass, -5.37 + depth / 2 + 0.002, y + height * 0.7, bz, 0.005, 0.014, 0.08);
    }
  }
}
export const cafeLibrary = library.finish();

const counter = new StaticAsset('Cafe counter and Eve sign');
counter.box(oak, 0.5, 0.52, -6, 4.4, 1.04, 1.04);
for (let i = 0; i < 37; i++) counter.box(paleWood, -1.64 + i * 0.12, 0.53, -5.46, 0.045, 0.93, 0.05);
counter.box(stone, 0.5, 1.09, -6, 4.6, 0.12, 1.18);
counter.box(iron, 1.65, 1.42, -6.14, 0.82, 0.55, 0.5);
counter.box(brass, 1.65, 1.52, -5.87, 0.74, 0.075, 0.03);
counter.box(iron, 1.65, 1.17, -5.76, 0.83, 0.05, 0.34);
for (const x of [1.45, 1.83]) {
  counter.round(ceramic, x, 1.8, -6.14, 0.075, 0.1);
  counter.round(brass, x, 1.31, -5.84, 0.026, 0.13);
}
counter.round(ceramic, -0.9, 1.23, -5.8, 0.17, 0.12);
for (let i = 0; i < 3; i++) counter.round(terra, -0.3 + i * 0.35, 1.26, -6.28, 0.12, 0.24 + i * 0.04);
counter.box(moss, 0.5, 2.8, -6.85, 3.5, 1.75, 0.07);
counter.box(brass, 0.5, 3.72, -6.81, 3.62, 0.035, 0.1);
counter.box(brass, 0.5, 1.89, -6.81, 3.62, 0.035, 0.1);
// E V E, made from actual geometry so it is crisp in both editor and XR.
for (const x of [-0.5, 1.5]) {
  counter.box(ceramic, x - 0.2, 2.85, -6.77, 0.075, 0.7, 0.035);
  for (const y of [2.5, 2.85, 3.2]) counter.box(ceramic, x, y, -6.77, 0.45, 0.065, 0.035);
}
counter.box(ceramic, 0.35, 2.85, -6.77, 0.075, 0.76, 0.035, [0, 0, 0.38]);
counter.box(ceramic, 0.63, 2.85, -6.77, 0.075, 0.76, 0.035, [0, 0, -0.38]);
export const cafeCounter = counter.finish();

const desk = new StaticAsset('Eve oak workbench');
desk.box(oak, 0, 0.8, 0, 3.65, 0.12, 1.3);
desk.box(paleWood, 0, 0.864, 0, 3.59, 0.01, 1.24);
for (const x of [-1.5, 1.5]) {
  for (const z of [-0.44, 0.44]) desk.box(iron, x, 0.38, z, 0.065, 0.76, 0.065);
  desk.box(iron, x, 0.08, 0, 0.08, 0.06, 1.05);
}
desk.box(iron, 0, 0.3, -0.44, 3.05, 0.06, 0.055);
desk.box(moss, 0, 0.88, 0.08, 1.2, 0.015, 0.65);
desk.round(ceramic, 0.8, 0.93, 0.25, 0.075, 0.13);
desk.round(coffee, 0.8, 1, 0.25, 0.062, 0.003);
export const cafeWorkbench = desk.finish();

const nook = new StaticAsset('Cafe reading nook');
nook.box(rug, 3.8, 0.015, -2, 2.8, 0.025, 3.65);
for (let stripe = 0; stripe < 7; stripe++) nook.box(stone, 3.8, 0.029, -3.5 + stripe * 0.5, 2.7, 0.003, 0.025);
for (const z of [-3.25, -0.65]) {
  nook.box(fabric, 4.45, 0.46, z, 0.92, 0.2, 0.86);
  nook.box(fabric, 4.77, 0.85, z, 0.2, 0.77, 0.9, [0, 0, -0.12]);
  for (const side of [-1, 1]) {
    nook.box(oak, 4.42, 0.68, z + side * 0.48, 1.02, 0.09, 0.11);
    for (const x of [4.1, 4.8]) nook.box(walnut, x, 0.25, z + side * 0.34, 0.055, 0.5, 0.055);
  }
  nook.box(ceramic, 4.56, 0.7, z, 0.12, 0.33, 0.5, [0, 0, -0.15]);
}
nook.round(walnut, 3.85, 0.26, -2, 0.12, 0.5);
nook.round(oak, 3.85, 0.53, -2, 0.53, 0.07);
nook.box(bookColors[1], 3.8, 0.59, -2, 0.26, 0.06, 0.37, [0, 0.15, 0]);
nook.round(ceramic, 4, 0.62, -1.8, 0.07, 0.1);
export const cafeNook = nook.finish();

function plant(asset: StaticAsset, x: number, z: number, size = 1) {
  asset.add(cone, terra, [x, 0.24 * size, z], [0.3 * size, 0.48 * size, 0.3 * size]);
  asset.round(coffee, x, 0.48 * size, z, 0.2 * size, 0.025);
  asset.round(walnut, x, 0.85 * size, z, 0.025 * size, 0.8 * size);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996;
    const radius = (0.24 + (i % 3) * 0.07) * size;
    asset.add(orb, leaves[i % 3], [x + Math.cos(a) * radius, (0.75 + i * 0.065) * size, z + Math.sin(a) * radius], [0.16 * size, 0.36 * size, 0.1 * size], [0.35, -a, 0.6]);
  }
}
const planting = new StaticAsset('Cafe indoor planting and pendant lamps');
for (const [x, z, s] of [[-4.6, 2.3, 1.4], [5.2, 2.8, 1.7], [3.7, -6.1, 1.3], [-3.5, -6.2, 1]] as const) plant(planting, x, z, s);
for (const [x, z] of [[-2, -1.4], [2, -1.4], [0, -5.3], [3.8, 0.4]]) {
  planting.round(iron, x, 3.7, z, 0.015, 1.1);
  planting.add(cone, brass, [x, 3.08, z], [0.33, 0.2, 0.33]);
  planting.round(glow, x, 2.976, z, 0.28, 0.015);
}
export const cafeDetails = planting.finish();

const garden = new StaticAsset('Cafe surrounding garden');
garden.box(moss, 0, -0.26, -1, 36, 0.15, 36);
garden.box(stone, 0, -0.12, 7, 3.5, 0.08, 4);
for (const x of [-9, 9]) {
  for (let i = 0; i < 8; i++) {
    const z = -12 + i * 3.5;
    garden.round(walnut, x, 1.4, z, 0.16, 3);
    for (let j = 0; j < 3; j++) garden.add(orb, leaves[(i + j) % 3], [x + (j - 1) * 0.65, 3 + j * 0.45, z + (j % 2) * 0.5], [1.5, 1.75, 1.45]);
  }
}
export const cafeGarden = garden.finish();
