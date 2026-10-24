import assert from "node:assert/strict";
import { test } from "node:test";

import { coverLayout, cropRect, instagramRatioOk, nearestInstagramRatio, outputSize } from "./image-fit.ts";

test("le format accepté le plus proche reste dans 4:5 – 1,91:1", () => {
  assert.equal(nearestInstagramRatio(1000, 1000), 1);
  assert.equal(nearestInstagramRatio(1000, 2000), 0.8); // très haute : on passe à 4:5
  assert.equal(nearestInstagramRatio(4000, 1000), 1.91); // panorama : on passe à 1,91:1
});

test("recadrage centré d'une photo verticale 9:16 en 4:5", () => {
  const r = cropRect(1080, 1920, 0.8);
  assert.deepEqual(r, { originX: 0, originY: 285, width: 1080, height: 1350 });
});

test("recadrage d'un panorama : la zone suit le point de vue", () => {
  const left = cropRect(4000, 1000, 1.91, 0, 0.5);
  const right = cropRect(4000, 1000, 1.91, 1, 0.5);
  assert.equal(left.originX, 0);
  assert.equal(right.originX + right.width, 4000);
  assert.equal(left.height, 1000);
});

test("une image déjà au bon format n'est pas coupée", () => {
  assert.deepEqual(cropRect(1000, 1000, 1), { originX: 0, originY: 0, width: 1000, height: 1000 });
});

test("jamais hors format ni hors de l'image, quelles que soient les tailles et les arrondis", () => {
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 4000; i++) {
    const iw = 320 + Math.floor(rand() * 6000);
    const ih = 320 + Math.floor(rand() * 6000);
    const ratio = nearestInstagramRatio(iw, ih);
    const r = cropRect(iw, ih, ratio, rand(), rand());
    assert.ok(instagramRatioOk(r.width, r.height), `format ${r.width}x${r.height} pour ${iw}x${ih}`);
    assert.ok(r.originX >= 0 && r.originY >= 0 && r.originX + r.width <= iw && r.originY + r.height <= ih, `hors image pour ${iw}x${ih}`);
    const out = outputSize(r);
    assert.ok(out.width <= 1440 && instagramRatioOk(out.width, out.height), `sortie ${out.width}x${out.height} pour ${iw}x${ih}`);
  }
});

test("formats choisis à la main (carré, 4:5, 1,91:1) toujours valides", () => {
  for (const ratio of [0.8, 1, 1.91]) {
    for (const [iw, ih] of [[3024, 4032], [4032, 3024], [1080, 1080], [5000, 700], [700, 5000]]) {
      const r = cropRect(iw, ih, ratio, 0.3, 0.7);
      assert.ok(instagramRatioOk(r.width, r.height), `${ratio} sur ${iw}x${ih} → ${r.width}x${r.height}`);
    }
  }
});

test("disposition du cadre : l'image couvre le cadre et le décalage reste dans ses bornes", () => {
  const l = coverLayout(4000, 1000, 300, 300, 0.5, 0.5);
  assert.equal(l.height, 300);
  assert.equal(l.width, 1200);
  assert.equal(l.left, -450);
  assert.equal(coverLayout(1000, 1000, 300, 300, 0.5, 0.5).overflowX, 0);
});
