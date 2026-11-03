import * as THREE from "three";

export const MASCOT_SCALE = 0.3; // presentation height in metres, not a measured physical object
export const MASCOT_START_POSITION = new THREE.Vector3(0.75, 0, 0);
export const MASCOT_FINISH_POSITION = new THREE.Vector3(0.48, 0, 0);
export const MASCOT_ROTATION_SPEED = 0.2;
export const MASCOT_FLOAT_AMPLITUDE = 0.008;
export const MASCOT_URL = "/assets/meta-mascot-animated.glb";
const WALK_SECONDS = 3;
export type MascotAsset = { scene: THREE.Group; animations: THREE.AnimationClip[] };

async function loadAsset(): Promise<MascotAsset> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  return new GLTFLoader().loadAsync(MASCOT_URL);
}

export function animationSequence(clips: THREE.AnimationClip[]) {
  const find = (names: string[]) => names.map(n => clips.find(c =>
    c.name.toLowerCase().replace(/[^a-z]/g, "").includes(n) && c.duration > 0,
  )).find(Boolean);
  return [find(["walk", "running", "run"]), find(["wave", "waving"]),
    find(["dance", "dancing", "celebrat", "jump"]), find(["idle"])];
}

/** GLTFLoader owns geometries, all texture slots, image bitmaps and skeleton textures. */
export function releaseMascot(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>(), skeletons = new Set<THREE.Skeleton>();
  root.traverse(o => {
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.skeleton) skeletons.add(mesh.skeleton);
    if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
  });
  for (const m of materials) for (const value of Object.values(m))
    if (value instanceof THREE.Texture) textures.add(value);
  for (const texture of textures) { texture.dispose(); (texture.source?.data as { close?: () => void } | undefined)?.close?.(); }
  materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose()); skeletons.forEach(s => s.dispose());
  root.removeFromParent();
}

/** Session-owned presentation only. Never reads/writes project or inspection APIs. */
export class CompletionMascot {
  readonly transform = new THREE.Group();
  private epoch = 0;
  private requested = false;
  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private sequence: (THREE.AnimationClip | undefined)[] = [];
  private phase = 0;
  private elapsed = 0;
  private phaseTime = 0;
  private noClips = false;
  private hologram: THREE.MeshBasicMaterial | null = null;
  private roots: { node: THREE.Object3D; x: number; z: number }[] = [];
  constructor(private parent: THREE.Group, private notice: (text: string) => void,
    private load: () => Promise<MascotAsset> = loadAsset) {
    this.transform.name = "completion-mascot";
  }
  async start() {
    if (this.requested) return;
    this.requested = true;
    const epoch = ++this.epoch;
    this.notice("");
    let asset: MascotAsset | null = null;
    try {
      asset = await this.load();
      if (epoch !== this.epoch) { releaseMascot(asset.scene); return; }
      const box = new THREE.Box3().setFromObject(asset.scene);
      const height = box.max.y - box.min.y;
      if (!Number.isFinite(height) || height <= 0) throw new Error("Empty mascot geometry");
      this.model = asset.scene;
      this.model.traverse(node => {
        if ((node as THREE.Bone).isBone && !(node.parent as THREE.Bone | null)?.isBone)
          this.roots.push({ node, x: node.position.x, z: node.position.z });
      });
      // Normalize imported authoring units without modifying the assembly origin.
      const normalized = new THREE.Group();
      normalized.scale.setScalar(MASCOT_SCALE / height);
      normalized.position.y = -box.min.y * MASCOT_SCALE / height;
      normalized.add(this.model);
      this.transform.add(normalized);
      this.transform.position.copy(MASCOT_START_POSITION);
      this.parent.add(this.transform);
      // Retain original materials for complete disposal; use one inexpensive unlit cyan material.
      this.hologram = new THREE.MeshBasicMaterial({ color: 0x69dfff, transparent: true, opacity: 0, depthWrite: false });
      this.model.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) { mesh.userData.mascotMaterial = mesh.material; mesh.material = this.hologram!; }
      });
      this.mixer = new THREE.AnimationMixer(this.model);
      this.sequence = animationSequence(asset.animations);
      this.noClips = asset.animations.length === 0;
      // Unknown clip names: use one supplied clip as celebration; never invent a named animation.
      if (!this.sequence.some(Boolean) && asset.animations.length) this.sequence[2] = asset.animations[0];
      this.phase = 0; this.elapsed = 0; this.phaseTime = 0;
      this.playPhase();
    } catch {
      if (epoch !== this.epoch) return;
      if (!this.model && asset) releaseMascot(asset.scene);
      this.clearModel();
      this.notice("Completion hologram unavailable");
    }
  }
  private playPhase() {
    if (!this.mixer) return;
    const clip = this.sequence[this.phase];
    if (this.phase === 3 && !clip) {
      // No Idle in this asset: hold the last supplied pose, do not invent a clip.
      this.mixer.timeScale = 0;
      return;
    }
    this.mixer.stopAllAction();
    if (clip) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(this.phase === 0 || this.phase === 3 ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.reset().play();
    }
  }
  tick(delta: number) {
    if (!this.model || !this.mixer) return;
    const dt = Math.max(0, Math.min(delta, 0.1)); // no jumps after XR suspension
    this.elapsed += dt; this.phaseTime += dt; this.mixer.update(dt);
    // Imported walking root motion must not add a second uncontrolled travel path.
    for (const root of this.roots) { root.node.position.x = root.x; root.node.position.z = root.z; }
    if (this.hologram) this.hologram.opacity = Math.min(0.65, this.elapsed * 0.65);
    if (this.phase === 0) this.transform.position.lerpVectors(MASCOT_START_POSITION, MASCOT_FINISH_POSITION, Math.min(1, this.phaseTime / WALK_SECONDS));
    const duration = this.phase === 0 ? WALK_SECONDS : (this.sequence[this.phase]?.duration ?? 0);
    if (this.phase < 3 && this.phaseTime >= duration) {
      this.phase++; this.phaseTime = 0;
      while (this.phase < 3 && !this.sequence[this.phase]) this.phase++;
      this.playPhase();
    }
    if (this.noClips) {
      this.transform.rotation.y += dt * MASCOT_ROTATION_SPEED;
      this.transform.position.y = MASCOT_FLOAT_AMPLITUDE * Math.sin(this.elapsed * 1.5);
    }
  }
  private clearModel() {
    if (this.model) {
      this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.model);
      this.model.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.userData.mascotMaterial) { mesh.material = mesh.userData.mascotMaterial; delete mesh.userData.mascotMaterial; } });
      releaseMascot(this.model);
    }
    this.hologram?.dispose(); this.hologram = null;
    this.transform.clear(); this.transform.removeFromParent(); this.transform.rotation.set(0, 0, 0);
    this.model = null; this.mixer = null;
    this.roots = [];
  }
  stop() { this.epoch++; this.requested = false; this.clearModel(); }
}
