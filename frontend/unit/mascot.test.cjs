/* eslint-disable @typescript-eslint/no-require-imports -- TypeScript test harness. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const THREE = require('three');
const { CompletionMascot, animationSequence, MASCOT_FINISH_POSITION } = require('../src/lib/ar/mascot.ts');
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
  assert.equal(m.sequence[m.phase].name,'Walk'); advance(m,3.1);
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
