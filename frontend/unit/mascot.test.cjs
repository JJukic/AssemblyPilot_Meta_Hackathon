/* eslint-disable @typescript-eslint/no-require-imports -- TypeScript test harness. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const THREE = require('three');
const { CompletionMascot, animationSequence, mascotBehindField, MASCOT_FINISH_POSITION, MASCOT_START_POSITION, MASCOT_BEHIND_FIELD_OFFSET, MASCOT_BACK_EDGE_CLEARANCE_M } = require('../src/lib/ar/mascot.ts');
const { DEFAULT_FIELD } = require('../src/lib/ar/field.ts');
const { deriveGuide } = require('../src/lib/ar/guidedFlow.ts');
function asset(names = ['Walk', 'Wave', 'Celebrate', 'Idle']) {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  return { scene, animations: names.map(name => new THREE.AnimationClip(name, .5, [])) };
}
function advance(m, seconds) { for (let i=0; i<seconds*100; i++) m.tick(.01); }
test('original uploaded GLB contains real Meshy clips; robust matching and missing stages', () => {
  const b = fs.readFileSync('public/assets/meta-mascot-animated.glb');
  assert.equal(b.subarray(0,4).toString(), 'glTF');
  const j = JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
  assert.deepEqual(j.animations.map(a=>a.name), ['Running', 'Walking', 'FunnyDancing_02']);
  const clips = j.animations.map(a=>new THREE.AnimationClip(a.name,1,[]));
  assert.deepEqual(animationSequence(clips).map(c=>c?.name), ['Walking', undefined, 'FunnyDancing_02', undefined]);
});
test('load only on explicit start; Walk → Wave → Celebrate → Idle; parent and bricks unchanged', async () => {
  const parent = new THREE.Group(), brick = new THREE.Group(); parent.add(brick); parent.position.set(1,2,3);
  let loads=0; const m = new CompletionMascot(parent, ()=>{}, async()=>{loads++;return asset();});
  m.tick(.1); assert.equal(loads,0);
  await m.start(); await m.start(); assert.equal(loads,1);
  assert.equal(m.sequence[m.phase].name,'Walk'); advance(m,1.6); // short walk-in (1.5 s)
  assert.equal(m.sequence[m.phase].name,'Wave'); advance(m,.5);
  assert.equal(m.sequence[m.phase].name,'Celebrate'); advance(m,.5);
  assert.equal(m.sequence[m.phase].name,'Idle');
  assert.deepEqual(m.transform.position.toArray(),MASCOT_FINISH_POSITION.toArray());
  assert.deepEqual(parent.position.toArray(),[1,2,3]); assert.deepEqual(brick.position.toArray(),[0,0,0]);
  const mixer=m.mixer; let uncached=false; mixer.uncacheRoot=()=>{uncached=true;};
  const mesh=m.model.children[0]; let disposed=0; mesh.geometry.addEventListener('dispose',()=>disposed++);
  mesh.userData.mascotMaterial.addEventListener('dispose',()=>disposed++);
  m.stop(); assert.equal(uncached,true); assert.equal(disposed,2); assert.equal(m.mixer,null); assert.deepEqual(parent.children,[brick]);
});
test('late loader after stop/restart disposes old model; failure preserves caller completion', async () => {
  let resolve; const parent=new THREE.Group(); const messages=[];
  const m=new CompletionMascot(parent,t=>messages.push(t),()=>new Promise(r=>{resolve=r;}));
  const pending=m.start(); m.stop(); const old=asset(); let disposed=false;
  old.scene.children[0].geometry.addEventListener('dispose',()=>{disposed=true;}); resolve(old); await pending;
  assert.equal(disposed,true); assert.equal(parent.children.length,0);
  m.load=async()=>{throw Error('404');}; await m.start();
  assert.equal(messages.at(-1),'Completion hologram unavailable'); assert.equal(parent.children.length,0);
});
test('missing clips use bounded code movement; corrupt geometry fails safely', async () => {
  const parent=new THREE.Group(); const m=new CompletionMascot(parent,()=>{},async()=>asset([]));
  await m.start(); advance(m,5); assert.ok(m.transform.rotation.y>0); assert.ok(Math.abs(m.transform.position.y)<=.008);
  m.stop(); let notice=''; const corrupt=new CompletionMascot(parent,t=>notice=t,async()=>({scene:new THREE.Group(),animations:[]}));
  await corrupt.start(); assert.equal(notice,'Completion hologram unavailable'); assert.equal(parent.children.length,0);
});
test('Finish requires last verified step and is hidden during an active check', () => {
  const input={anchored:true, checking:false, serverVerified:false, manuallyConfirmed:false,isLastStep:true,summary:null};
  assert.ok(!deriveGuide(input).buttons.some(b=>b.id==='finish'));
  assert.ok(!deriveGuide({...input,serverVerified:true,isLastStep:false}).buttons.some(b=>b.id==='finish'));
  assert.ok(deriveGuide({...input,serverVerified:true}).buttons.some(b=>b.id==='finish'));
  assert.equal(deriveGuide({...input,serverVerified:true,checking:true}).buttons.length,0);
});

/* ---- Behind the assembly field (field space: +Z toward the user, origin = field centre on the table) ---- */
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
test('central offset: the mascot stops BEHIND the field (negative Z), on the table plane, clear of the back edge', () => {
  assert.deepEqual(MASCOT_BEHIND_FIELD_OFFSET, { x: 0, y: 0, z: -0.45 });
  const { start, finish } = mascotBehindField(DEFAULT_FIELD);
  assert.deepEqual(finish.toArray(), [0, 0, -0.45], 'default 0.48 × 0.32 m field: the configured offset');
  assert.deepEqual(MASCOT_FINISH_POSITION.toArray(), finish.toArray());
  const backEdge = -DEFAULT_FIELD.depthM / 2;
  assert.ok(finish.z <= backEdge - MASCOT_BACK_EDGE_CLEARANCE_M, 'never on the field or the LEGO build');
  assert.equal(finish.y, 0, 'feet on the same tabletop plane as the field');
  assert.ok(start.z === finish.z && start.x > finish.x, 'walk-in along the back edge, not through the field');
  assert.deepEqual(MASCOT_START_POSITION.toArray(), start.toArray());
  // A deep field pushes the mascot further back (offset adapted to the real field size).
  const deep = mascotBehindField({ widthM: 0.6, depthM: 1.2 }).finish;
  assert.ok(near(deep.z, -(0.6 + MASCOT_BACK_EDGE_CLEARANCE_M)), `deep field → z ${deep.z}`);
  assert.equal(mascotBehindField({ widthM: 0.3, depthM: 0.2 }).finish.z, -0.45, 'small field keeps the configured offset');
});

test('walk-in stays behind the field the whole time, then Wave/Dance/Idle on the spot facing the user', async () => {
  const parent = new THREE.Group();
  const m = new CompletionMascot(parent, () => {}, async () => asset());
  await m.start();
  const { finish } = mascotBehindField(DEFAULT_FIELD);
  const backEdge = -DEFAULT_FIELD.depthM / 2;
  for (let i = 0; i < 300; i++) {
    m.tick(0.01);
    const p = m.transform.position;
    assert.ok(p.z <= backEdge - MASCOT_BACK_EDGE_CLEARANCE_M + 1e-9, `tick ${i}: z ${p.z} stays behind the field`);
    assert.equal(p.y, 0, 'feet stay on the table plane');
  }
  assert.notEqual(m.sequence[m.phase]?.name, 'Walk');
  assert.ok(near(m.transform.position.x, finish.x) && near(m.transform.position.z, finish.z), 'stopped exactly behind the field');
  assert.equal(m.transform.rotation.y, 0, 'faces the user (+Z) across the field');
  advance(m, 5);
  assert.ok(near(m.transform.position.z, finish.z), 'Wave / Dance / Idle never move it');
  m.stop();
});

test('field rotation and re-anchor: the mascot is field-relative, so its world position is behind the field', async () => {
  const origin = new THREE.Group();
  const m = new CompletionMascot(origin, () => {}, async () => asset());
  await m.start(); advance(m, 3);
  for (const yawDeg of [0, 37, 90, 180, 270]) {
    // New confirmed field pose (rotation about Y + table position), as after rotation or re-anchor.
    origin.position.set(0.4, 0.75, -1.2);
    origin.rotation.set(0, THREE.MathUtils.degToRad(yawDeg), 0);
    origin.updateMatrixWorld(true);
    const world = m.transform.getWorldPosition(new THREE.Vector3());
    const local = origin.worldToLocal(world.clone());
    assert.ok(near(local.z, -0.45, 1e-6) && near(local.x, 0, 1e-6), `yaw ${yawDeg}°: behind the field in field space`);
    assert.ok(near(world.y, 0.75, 1e-6), `yaw ${yawDeg}°: on the table plane`);
    // "Behind" = away from the user: further from a user standing at the field front (+Z side).
    const user = origin.localToWorld(new THREE.Vector3(0, 0, 0.6));
    const fieldCentre = origin.localToWorld(new THREE.Vector3());
    assert.ok(world.distanceTo(user) > fieldCentre.distanceTo(user), `yaw ${yawDeg}°: farther from the user than the field`);
  }
  // A re-anchored field of another size: the path is recomputed from the current field.
  m.setField({ widthM: 0.8, depthM: 1.0 });
  assert.ok(near(m.transform.position.z, -(0.5 + MASCOT_BACK_EDGE_CLEARANCE_M)));
  m.stop();
});
