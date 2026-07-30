#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const workspace = process.cwd();

/**
 * Resolve a part, preferring the `-sealed` variant produced by
 * seal-puppet-joint.py. Sealed parts have the cut joint opening painted over
 * with a fur patch and are otherwise pixel-identical in size, so swapping them
 * in never shifts geometry.
 */
function imagePath(breed, file) {
  const dir = path.join(workspace, "artwork", "rive", "parts", breed);
  const sealed = path.join(dir, file.replace(/\.png$/, "-sealed.png"));
  return existsSync(sealed) ? sealed : path.join(dir, file);
}

/** split-puppet-sheet.py leaves a uniform transparent border on every part. */
const PART_PAD = 4;

/** Read height straight out of the PNG IHDR chunk (bytes 20..24). */
function pngHeight(file) {
  const header = readFileSync(file).subarray(0, 24);
  if (header.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`Not a PNG: ${file}`);
  }
  return header.readUInt32BE(20);
}

/**
 * Place a leg from its paw upward.
 *
 * The four leg cutouts are not the same length (the near-side legs are shorter
 * and more foreshortened than the far-side ones), so a shared y-offset can
 * never put all four paws on one ground line. Instead we pin each paw to the
 * intended ground line and derive the joint from that leg's own ink height.
 *
 * Returns the pivot y (relative to root) and the image y offset (relative to
 * the pivot), both in artboard units.
 */
function solveLeg({ file, scale, ground, rootY, jointDepth }) {
  const srcHeight = pngHeight(file);
  const inkHeight = (srcHeight - 2 * PART_PAD) * scale;
  const inkTop = ground - inkHeight;
  // The joint sits a little way down into the leg so the stump stays buried
  // under the torso as the leg swings.
  const pivotAbs = inkTop + inkHeight * jointDepth;
  // Rive image nodes use a centre origin.
  const centreAbs = inkTop - PART_PAD * scale + (srcHeight * scale) / 2;
  return {
    pivotY: round2(pivotAbs - rootY),
    offsetY: round2(centreAbs - pivotAbs),
    inkTop: round2(inkTop),
    pivotAbs: round2(pivotAbs),
  };
}

const round2 = (value) => Math.round(value * 100) / 100;

const configs = {
  shiba: {
    artboardName: "ShibaPet",
    root: { x: 256, y: 250 },
    head: { x: -118, y: -63 },
    eyes: { left: { x: -24, y: 10 }, right: { x: 24, y: 10 } },
    // Paws land here. The far side sits slightly higher so the ground plane
    // reads as receding rather than flat.
    ground: { near: 446, far: 440 },
    jointDepth: 0.09,
    // Near-side legs are scaled up: they are closer to camera, and the cutouts
    // are shorter than the far-side ones so they need the extra reach.
    legs: [
      { id: "frontFar", file: "front-far-leg.png", x: -42, scale: 0.5, side: "far" },
      { id: "rearFar", file: "rear-far-leg.png", x: 118, scale: 0.5, side: "far" },
      { id: "frontNear", file: "front-near-leg.png", x: -90, scale: 0.56, side: "near" },
      { id: "rearNear", file: "rear-near-leg.png", x: 70, scale: 0.56, side: "near" },
    ],
    groups: [
      { id: "tailPivot", x: 140, y: -42, parent: "root" },
      { id: "torsoPivot", x: 18, y: 0, parent: "root" },
      { id: "headPivot", x: -118, y: -63, parent: "root" },
      { id: "leftEyePivot", x: -24, y: 10, parent: "headPivot" },
      { id: "rightEyePivot", x: 24, y: 10, parent: "headPivot" },
      { id: "neckPivot", x: 8, y: 76, parent: "headPivot" },
    ],
    images: [
      ["tail", "tail.png", 25, -25, 0.52, "tailPivot"],
      ["torso", "torso.png", 0, 0, 0.52, "torsoPivot"],
      ["neckOverlap", "neck-overlap.png", 0, 0, 0.38, "neckPivot"],
      ["head", "head.png", 0, 0, 0.52, "headPivot"],
      ["leftEye", "left-eye.png", 0, 0, 0.32, "leftEyePivot"],
      ["rightEye", "right-eye.png", 0, 0, 0.3, "rightEyePivot"],
    ],
  },
  bichon: {
    artboardName: "BichonPet",
    root: { x: 256, y: 250 },
    head: { x: -108, y: -58 },
    eyes: { left: { x: -30, y: -6 }, right: { x: 27, y: -2 } },
    ground: { near: 465, far: 459 },
    jointDepth: 0.09,
    legs: [
      { id: "frontFar", file: "front-far-leg.png", x: -38, scale: 0.55, side: "far" },
      { id: "rearFar", file: "rear-far-leg.png", x: 122, scale: 0.55, side: "far" },
      { id: "frontNear", file: "front-near-leg.png", x: -88, scale: 0.57, side: "near" },
      { id: "rearNear", file: "rear-near-leg.png", x: 75, scale: 0.6, side: "near" },
    ],
    groups: [
      { id: "tailPivot", x: 138, y: -48, parent: "root" },
      { id: "torsoPivot", x: 18, y: 0, parent: "root" },
      { id: "headPivot", x: -108, y: -58, parent: "root" },
      { id: "leftEyePivot", x: -30, y: -6, parent: "headPivot" },
      { id: "rightEyePivot", x: 27, y: -2, parent: "headPivot" },
      { id: "neckPivot", x: 12, y: 78, parent: "headPivot" },
    ],
    images: [
      ["tail", "tail.png", 26, -25, 0.55, "tailPivot"],
      ["torso", "torso.png", 0, 0, 0.62, "torsoPivot"],
      ["neckOverlap", "neck-overlap.png", 0, 0, 0.48, "neckPivot"],
      ["head", "head.png", 0, 0, 0.55, "headPivot"],
      ["leftEye", "left-eye.png", 0, 0, 0.34, "leftEyePivot"],
      ["rightEye", "right-eye.png", 0, 0, 0.34, "rightEyePivot"],
    ],
  },
};

const keyframes = (values, easing = "ease-in-out") =>
  values.map(([frame, value], index) => ({
    frame,
    value,
    ...(index === 0 ? {} : { easing }),
  }));

const track = (target, property, values, easing) => ({
  target,
  property,
  keyframes: keyframes(values, easing),
});

function buildAnimations(config) {
  const root = config.root;
  const head = config.head;
  const left = config.eyes.left;
  const right = config.eyes.right;
  const animation = (name, duration, loop, tracks) => ({
    name,
    fps: 60,
    duration,
    loop,
    tracks,
  });

  return [
    animation("idle", 210, "loop", [
      track("root", "y", [[0, root.y], [105, root.y - 4], [210, root.y]]),
      track("tailPivot", "rotation", [[0, -5], [70, 8], [140, -9], [210, -5]]),
      track("headPivot", "rotation", [[0, 0], [105, 2], [210, 0]]),
    ]),
    animation("walk", 60, "loop", [
      track("root", "y", [[0, root.y], [15, root.y - 6], [30, root.y], [45, root.y - 6], [60, root.y]]),
      track("frontNearPivot", "rotation", [[0, -18], [30, 18], [60, -18]]),
      track("rearFarPivot", "rotation", [[0, -16], [30, 16], [60, -16]]),
      track("frontFarPivot", "rotation", [[0, 18], [30, -18], [60, 18]]),
      track("rearNearPivot", "rotation", [[0, 16], [30, -16], [60, 16]]),
      track("tailPivot", "rotation", [[0, -9], [30, 12], [60, -9]]),
    ]),
    animation("sleep", 300, "loop", [
      track("root", "y", [[0, root.y + 18], [150, root.y + 21], [300, root.y + 18]]),
      track("root", "scaleY", [[0, 0.88], [150, 0.91], [300, 0.88]]),
      track("headPivot", "y", [[0, head.y + 18], [150, head.y + 20], [300, head.y + 18]]),
      track("headPivot", "rotation", [[0, -7], [150, -9], [300, -7]]),
    ]),
    animation("held", 150, "loop", [
      track("root", "y", [[0, root.y - 10], [75, root.y - 16], [150, root.y - 10]]),
      track("root", "rotation", [[0, -3], [75, 3], [150, -3]]),
      track("frontNearPivot", "rotation", [[0, -10], [75, 10], [150, -10]]),
      track("rearNearPivot", "rotation", [[0, 8], [75, -8], [150, 8]]),
    ]),
    animation("thinking", 150, "loop", [
      track("headPivot", "rotation", [[0, -5], [75, 8], [150, -5]]),
      track("headPivot", "y", [[0, head.y], [75, head.y - 3], [150, head.y]]),
      track("tailPivot", "rotation", [[0, -4], [75, 4], [150, -4]]),
    ]),
    animation("working", 90, "loop", [
      track("headPivot", "y", [[0, head.y], [45, head.y + 6], [90, head.y]]),
      track("headPivot", "rotation", [[0, -2], [45, 4], [90, -2]]),
      track("tailPivot", "rotation", [[0, -8], [30, 10], [60, -10], [90, -8]]),
    ]),
    animation("happy", 60, "oneShot", [
      track("root", "y", [[0, root.y], [22, root.y - 22], [42, root.y + 3], [60, root.y]]),
      track("tailPivot", "rotation", [[0, -8], [15, 18], [30, -16], [45, 18], [60, -8]]),
    ]),
    animation("success", 72, "oneShot", [
      track("root", "y", [[0, root.y], [24, root.y - 28], [48, root.y + 4], [72, root.y]]),
      track("root", "scaleX", [[0, 1], [24, 1.05], [48, 0.98], [72, 1]]),
      track("tailPivot", "rotation", [[0, -8], [18, 22], [36, -18], [54, 20], [72, -8]]),
    ]),
    animation("error", 54, "oneShot", [
      track("headPivot", "rotation", [[0, 0], [9, -9], [18, 9], [27, -7], [36, 7], [54, 0]]),
      track("root", "x", [[0, root.x], [9, root.x - 4], [18, root.x + 4], [27, root.x - 3], [36, root.x + 3], [54, root.x]]),
    ]),
    animation("land", 48, "oneShot", [
      track("root", "y", [[0, root.y - 24], [20, root.y + 8], [34, root.y - 3], [48, root.y]]),
      track("root", "scaleY", [[0, 1], [20, 0.88], [34, 1.04], [48, 1]]),
    ]),
    animation("eat", 90, "oneShot", [
      track("headPivot", "y", [[0, head.y], [20, head.y + 16], [40, head.y + 10], [60, head.y + 17], [90, head.y]]),
      track("headPivot", "rotation", [[0, 0], [20, -8], [40, -3], [60, -8], [90, 0]]),
    ]),
    animation("play", 78, "oneShot", [
      track("root", "rotation", [[0, 0], [18, -5], [39, 6], [60, -4], [78, 0]]),
      track("root", "y", [[0, root.y], [20, root.y - 14], [39, root.y], [60, root.y - 10], [78, root.y]]),
      track("tailPivot", "rotation", [[0, -8], [20, 20], [39, -18], [60, 18], [78, -8]]),
    ]),
    animation("tap-head", 42, "oneShot", [
      track("headPivot", "y", [[0, head.y], [12, head.y + 8], [28, head.y - 3], [42, head.y]]),
      track("headPivot", "scaleY", [[0, 1], [12, 0.92], [28, 1.04], [42, 1]]),
    ]),
    animation("tap-body", 42, "oneShot", [
      track("root", "scaleX", [[0, 1], [12, 0.96], [28, 1.03], [42, 1]]),
      track("root", "scaleY", [[0, 1], [12, 1.04], [28, 0.98], [42, 1]]),
    ]),
    animation("look-left", 30, "oneShot", [
      track("leftEyePivot", "x", [[0, left.x], [18, left.x - 3], [30, left.x - 3]]),
      track("rightEyePivot", "x", [[0, right.x], [18, right.x - 3], [30, right.x - 3]]),
    ]),
    animation("look-right", 30, "oneShot", [
      track("leftEyePivot", "x", [[0, left.x], [18, left.x + 3], [30, left.x + 3]]),
      track("rightEyePivot", "x", [[0, right.x], [18, right.x + 3], [30, right.x + 3]]),
    ]),
    animation("look-up", 30, "oneShot", [
      track("leftEyePivot", "y", [[0, left.y], [18, left.y - 3], [30, left.y - 3]]),
      track("rightEyePivot", "y", [[0, right.y], [18, right.y - 3], [30, right.y - 3]]),
    ]),
    animation("look-down", 30, "oneShot", [
      track("leftEyePivot", "y", [[0, left.y], [18, left.y + 3], [30, left.y + 3]]),
      track("rightEyePivot", "y", [[0, right.y], [18, right.y + 3], [30, right.y + 3]]),
    ]),
    animation("look-center", 18, "oneShot", [
      track("leftEyePivot", "x", [[0, left.x], [18, left.x]]),
      track("rightEyePivot", "x", [[0, right.x], [18, right.x]]),
      track("leftEyePivot", "y", [[0, left.y], [18, left.y]]),
      track("rightEyePivot", "y", [[0, right.y], [18, right.y]]),
    ]),
    animation("blink", 18, "oneShot", [
      track("leftEyePivot", "scaleY", [[0, 1], [8, 0.08], [18, 1]]),
      track("rightEyePivot", "scaleY", [[0, 1], [8, 0.08], [18, 1]]),
    ]),
    animation("sit", 60, "oneShot", [
      track("root", "y", [[0, root.y], [60, root.y + 18]]),
      track("rearNearPivot", "rotation", [[0, 0], [60, 28]]),
      track("rearFarPivot", "rotation", [[0, 0], [60, 24]]),
      track("headPivot", "rotation", [[0, 0], [60, -3]]),
    ]),
    animation("crawl", 72, "loop", [
      track("root", "y", [[0, root.y + 18], [18, root.y + 15], [36, root.y + 18], [54, root.y + 15], [72, root.y + 18]]),
      track("frontNearPivot", "rotation", [[0, -10], [36, 10], [72, -10]]),
      track("rearNearPivot", "rotation", [[0, 8], [36, -8], [72, 8]]),
    ]),
  ];
}

function buildLegs(breed, config) {
  const groups = [];
  const images = [];
  for (const leg of config.legs) {
    const file = imagePath(breed, leg.file);
    const solved = solveLeg({
      file,
      scale: leg.scale,
      ground: config.ground[leg.side],
      rootY: config.root.y,
      jointDepth: config.jointDepth,
    });
    const pivotId = `${leg.id}Pivot`;
    groups.push({ id: pivotId, x: leg.x, y: solved.pivotY, parent: "root" });
    images.push({
      id: `${leg.id}Leg`,
      pngPath: file,
      x: 0,
      y: solved.offsetY,
      scale: leg.scale,
      parent: pivotId,
    });
  }
  return { groups, images };
}

function buildScene(breed, config) {
  const legs = buildLegs(breed, config);
  return {
    artboard: { name: config.artboardName, width: 512, height: 512 },
    groups: [
      { id: "root", x: config.root.x, y: config.root.y },
      ...legs.groups,
      ...config.groups,
    ],
    // Far-side legs render behind the near-side pair, and the torso covers both
    // sets of joints.
    images: [
      ...legs.images,
      ...config.images.map(([id, file, x, y, scale, parent]) => ({
        id,
        pngPath: imagePath(breed, file),
        x,
        y,
        scale,
        parent,
      })),
    ],
    animations: buildAnimations(config),
  };
}

const outputDir = path.join(workspace, "artwork", "rive", "specs");
mkdirSync(outputDir, { recursive: true });
for (const [breed, config] of Object.entries(configs)) {
  const scene = buildScene(breed, config);
  const outputPath = path.join(outputDir, `${breed}-realistic-v5.scene.json`);
  writeFileSync(outputPath, `${JSON.stringify(scene, null, 2)}\n`);
  console.log(outputPath);
}
