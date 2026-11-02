/* Deterministic synthetic camera frames for detector/controller tests (not a test file). */
const W = 80, H = 60, WW = 160, WH = 120;
/** Smooth deterministic tabletop texture (world larger than the view). */
function makeWorld() {
  const world = new Float32Array(WW * WH);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++)
    world[y * WW + x] = 110 + 35 * Math.sin(x / 7.3) * Math.cos(y / 5.1) + 20 * Math.sin((x + 2 * y) / 11);
  for (let i = 0; i < 60; i++) {
    const x0 = Math.floor(rnd() * WW), y0 = Math.floor(rnd() * WH), s = 2 + Math.floor(rnd() * 6), v = 40 + rnd() * 170;
    for (let y = y0; y < Math.min(WH, y0 + s); y++) for (let x = x0; x < Math.min(WW, x0 + s); x++) world[y * WW + x] = v;
  }
  return world;
}
const block = (world, cx, cy, w, h, v = 235) => {
  const out = Float32Array.from(world);
  for (let y = cy - (h >> 1); y < cy + (h >> 1); y++) for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) out[y * WW + x] = v;
  return out;
};
let clock = 0;
/** Camera view: crop at (ox, oy), optional zoom (moving closer) and gain/offset (lighting). */
function view(world, ox = 40, oy = 30, { zoom = 1, gain = 1, offset = 0, noise = 2 } = {}) {
  const gray = new Uint8Array(W * H);
  let s = clock * 13 + 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = Math.round(ox + W / 2 + (x - W / 2) / zoom), wy = Math.round(oy + H / 2 + (y - H / 2) / zoom);
    s = (s * 1103515245 + 12345) % 2147483648;
    const n = ((s / 2147483648) - 0.5) * 2 * noise;
    gray[y * W + x] = Math.max(0, Math.min(255, world[wy * WW + wx] * gain + offset + n));
  }
  return { gray, w: W, h: H, clock: ++clock, at: clock * 500 };
}
module.exports = { W, H, makeWorld, block, view };
