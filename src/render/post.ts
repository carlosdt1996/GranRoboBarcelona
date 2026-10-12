import * as THREE from 'three';

/**
 * Renderiza la escena a baja resolución y la cuantiza con tramado Bayer
 * para conseguir el aspecto de paleta limitada de las recreativas.
 */
export class Pixelator {
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor(w: number, h: number) {
    this.rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, levels: { value: 18 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float levels; varying vec2 vUv;
        float b2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float d = b4(gl_FragCoord.xy) - 0.5;
          c = floor(c * levels + 0.5 + d * 0.9) / levels;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  setSize(w: number, h: number) {
    this.rt.setSize(w, h);
  }

  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
