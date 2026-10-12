import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Part { w: number; h: number; l: number; x: number; y: number; z: number; c: string }

const GLASS = '#3a5a8a', DARK = '#26222e', METAL = '#8a8a96';

function geo(parts: Part[]) {
  return mergeGeometries(parts.map((p) => {
    const b = new THREE.BoxGeometry(p.w, p.h, p.l);
    b.translate(p.x, p.y, -p.z); // +z del modelo = hacia delante = -Z en three
    const c = new THREE.Color(p.c), n = b.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    b.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.deleteAttribute('uv');
    return b;
  }))!;
}

const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const shadowMat = new THREE.MeshBasicMaterial({ color: '#341450', transparent: true, opacity: 0.45, depthWrite: false });

export interface HeliMesh { group: THREE.Group; body: THREE.Object3D; rotor: THREE.Object3D; tail: THREE.Object3D; shadow: THREE.Mesh }

/** Helicóptero ligero de líneas ochenteras: cabina de burbuja, botalón de cola y patines. */
export function createHeliMesh(body: string, stripe: string): HeliMesh {
  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(geo([
    { w: 1.9, h: 1.6, l: 3.6, x: 0, y: 1.35, z: 0.2, c: body },
    { w: 1.92, h: 0.3, l: 3.62, x: 0, y: 1.0, z: 0.2, c: stripe },
    { w: 1.7, h: 1.15, l: 1.3, x: 0, y: 1.55, z: 2.4, c: GLASS }, // burbuja
    { w: 1.4, h: 0.5, l: 0.6, x: 0, y: 0.95, z: 2.6, c: body },
    { w: 1.0, h: 0.55, l: 1.6, x: 0, y: 2.4, z: -0.2, c: body }, // turbina
    { w: 0.36, h: 0.36, l: 5.2, x: 0, y: 1.75, z: -3.9, c: body }, // botalón
    { w: 0.38, h: 0.12, l: 5.0, x: 0, y: 1.6, z: -3.8, c: stripe },
    { w: 0.14, h: 1.5, l: 0.8, x: 0, y: 2.35, z: -6.3, c: stripe }, // deriva
    { w: 1.7, h: 0.1, l: 0.5, x: 0, y: 1.8, z: -5.7, c: body },
    { w: 0.18, h: 0.55, l: 0.18, x: 0, y: 2.9, z: 0, c: DARK }, // mástil
    { w: 0.12, h: 0.12, l: 3.8, x: -0.95, y: 0.08, z: 0.3, c: METAL }, // patines
    { w: 0.12, h: 0.12, l: 3.8, x: 0.95, y: 0.08, z: 0.3, c: METAL },
    { w: 0.1, h: 0.6, l: 0.1, x: -0.85, y: 0.38, z: 1.2, c: METAL },
    { w: 0.1, h: 0.6, l: 0.1, x: 0.85, y: 0.38, z: 1.2, c: METAL },
    { w: 0.1, h: 0.6, l: 0.1, x: -0.85, y: 0.38, z: -0.7, c: METAL },
    { w: 0.1, h: 0.6, l: 0.1, x: 0.85, y: 0.38, z: -0.7, c: METAL },
  ]), material);
  const rotor = new THREE.Mesh(geo([
    { w: 0.32, h: 0.06, l: 10.4, x: 0, y: 0, z: 0, c: DARK },
    { w: 10.4, h: 0.06, l: 0.32, x: 0, y: 0, z: 0, c: DARK },
  ]), material);
  rotor.position.set(0, 3.2, 0);
  const tail = new THREE.Mesh(geo([
    { w: 0.06, h: 1.7, l: 0.2, x: 0, y: 0, z: 0, c: DARK },
    { w: 0.06, h: 0.2, l: 1.7, x: 0, y: 0, z: 0, c: DARK },
  ]), material);
  tail.position.set(0.22, 2.35, 6.3);
  const pivot = new THREE.Group(); // cabeceo y alabeo del fuselaje
  pivot.add(bodyMesh, rotor, tail);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), shadowMat);
  shadow.renderOrder = 1;
  group.add(pivot);
  return { group, body: pivot, rotor, tail, shadow };
}
