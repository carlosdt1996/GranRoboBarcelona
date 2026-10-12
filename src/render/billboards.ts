import * as THREE from 'three';
import type { SpriteAtlas, SpriteRect } from './textures';

/**
 * Sprites escalados al estilo OutRun: quads instanciados que siempre miran a la cámara
 * (giran solo en el eje vertical). Una sola llamada de dibujo para miles de árboles.
 */
export class Billboards {
  readonly mesh: THREE.Mesh;
  private offset: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private rect: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  static camRight = { value: new THREE.Vector3(1, 0, 0) };
  count = 0;

  /** `glow`: sprites con luz propia (fuego, fogonazos): no los oscurece la noche. */
  constructor(atlas: SpriteAtlas, readonly capacity: number, dynamic = false, glow = false) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const usage = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(usage);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(usage);
    this.rect = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(usage);
    g.setAttribute('offset', this.offset);
    g.setAttribute('size', this.size);
    g.setAttribute('rect', this.rect);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: atlas.texture } }]),
      vertexShader: `
        attribute vec3 offset; attribute vec2 size; attribute vec4 rect;
        uniform vec3 camRight;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vec3 wp = offset + camRight * position.x * size.x + vec3(0.0, position.y * size.y, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vUv = rect.xy + uv * rect.zw;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb, GLOW_ALPHA);
          #include <fog_fragment>
        }`,
      fog: true,
      defines: { GLOW_ALPHA: glow ? '0.0' : '1.0' },
    });
    mat.uniforms.camRight = Billboards.camRight;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  set(i: number, x: number, y: number, z: number, w: number, h: number, r: SpriteRect, flip = false) {
    this.offset.setXYZ(i, x, z, -y);
    this.size.setXY(i, w, h);
    if (flip) this.rect.setXYZW(i, r.u + r.w, r.v, -r.w, r.h);
    else this.rect.setXYZW(i, r.u, r.v, r.w, r.h);
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  commit(count: number) {
    this.count = count;
    this.geo.instanceCount = count;
    this.offset.needsUpdate = true;
    this.size.needsUpdate = true;
    this.rect.needsUpdate = true;
  }
}
