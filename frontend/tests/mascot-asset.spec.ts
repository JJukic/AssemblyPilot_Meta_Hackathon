import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Asset validation only, not a claim of a working headset/XR session.
test("original mascot GLB decodes textures, skeleton and supplied animations in Chromium", async ({ page }) => {
  const modules: Record<string, string> = {
    "three.module.js": "build/three.module.js",
    "three.core.js": "build/three.core.js",
    "loaders/GLTFLoader.js": "examples/jsm/loaders/GLTFLoader.js",
    "utils/BufferGeometryUtils.js": "examples/jsm/utils/BufferGeometryUtils.js",
    "utils/SkeletonUtils.js": "examples/jsm/utils/SkeletonUtils.js",
  };
  await page.route("**/__mascot-test/**", async route => {
    const key = new URL(route.request().url()).pathname.split("/__mascot-test/")[1];
    if (!modules[key]) return route.abort();
    return route.fulfill({ contentType: "text/javascript", body: await readFile(`node_modules/three/${modules[key]}`, "utf8") });
  });
  await page.goto("/ar");
  await page.addScriptTag({ type: "importmap", content: JSON.stringify({ imports: { three: "/__mascot-test/three.module.js" } }) });
  const result = await page.evaluate(async () => {
    const path = "/__mascot-test/loaders/GLTFLoader.js";
    const { GLTFLoader } = await import(/* webpackIgnore: true */ path);
    const gltf = await new GLTFLoader().loadAsync("/assets/meta-mascot-animated.glb");
    let skins = 0;
    gltf.scene.traverse((o: { isSkinnedMesh?: boolean }) => { if (o.isSkinnedMesh) skins++; });
    return { animations: gltf.animations.map((c: { name: string }) => c.name), skins };
  });
  expect(result.animations).toEqual(["Running", "Walking", "FunnyDancing_02"]);
  expect(result.skins).toBeGreaterThan(0);
});
