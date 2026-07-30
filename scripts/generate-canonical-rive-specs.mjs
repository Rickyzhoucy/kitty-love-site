#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const scale = 0.38;
const sourceCenter = 627;
const root = { x: 256, y: 256 };

const breeds = {
  shiba: { artboard: "ShibaPet" },
  bichon: { artboard: "BichonPet" },
};

const frames = (values, easing = "ease-in-out") =>
  values.map(([frame, value], index) => ({
    frame,
    value,
    ...(index ? { easing } : {}),
  }));

const track = (target, property, values, easing) => ({
  target,
  property,
  keyframes: frames(values, easing),
});

const animation = (name, duration, loop, tracks) => ({
  name,
  fps: 60,
  duration,
  loop,
  tracks,
});

/** 语义活动 → 状态机 activity 输入的取值。与 petBodyProtocol 的活动枚举对应。 */
const ACTIVITY_VALUE = {
  idle: 0,
  walk: 1,
  sleep: 2,
  held: 3,
  thinking: 4,
  working: 5,
  waiting: 6,
  asking: 7,
};

/** 由 trigger 驱动的一次性反应。名字与渲染层的 REACTION_ANIMATION 对齐。 */
const REACTIONS = [
  "happy",
  "success",
  "error",
  "land",
  "eat",
  "play",
  "tap-head",
  "tap-body",
  "confused",
];

/** 目光偏移幅度（画板单位）。blend1d 在两端之间连续插值。 */
const GAZE_X = 2.6;
const GAZE_Y = 2.4;

/** 单值「姿势」动画：blend1d 的采样端点，本身不产生运动。 */
function pose(name, tracks) {
  return {
    name,
    fps: 60,
    duration: 2,
    loop: "loop",
    tracks: tracks.map(([target, property, value]) => ({
      target,
      property,
      keyframes: [
        { frame: 0, value },
        { frame: 2, value },
      ],
    })),
  };
}

function animations(groups) {
  const eyeLeft = groups["left-eye"];
  const eyeRight = groups["right-eye"];
  return [
    animation("idle", 210, "loop", [
      track("root", "y", [[0, root.y], [105, root.y - 6], [210, root.y]]),
      track("tailPivot", "rotation", [[0, -3], [70, 7], [140, -6], [210, -3]]),
    ]),
    // 摆幅上限由 base 的挖腿边缘决定：±14° 时 512 画板上会出现约 4px 的接缝，
    // 但宠物实际显示宽度约 138px，该接缝落到亚像素级，肉眼不可见。取 ±9 留余量。
    animation("walk", 60, "loop", [
      track("root", "y", [[0, root.y], [15, root.y - 4], [30, root.y], [45, root.y - 4], [60, root.y]]),
      track("front-near-legPivot", "rotation", [[0, -9], [30, 9], [60, -9]]),
      track("rear-near-legPivot", "rotation", [[0, 9], [30, -9], [60, 9]]),
      track("tailPivot", "rotation", [[0, -6], [30, 11], [60, -6]]),
    ]),
    animation("sleep", 300, "loop", [
      track("root", "y", [[0, root.y + 8], [150, root.y + 10], [300, root.y + 8]]),
      track("root", "scaleY", [[0, 0.97], [150, 0.98], [300, 0.97]]),
    ]),
    animation("held", 150, "loop", [
      track("root", "y", [[0, root.y - 5], [75, root.y - 8], [150, root.y - 5]]),
      track("root", "rotation", [[0, -2], [75, 2], [150, -2]]),
    ]),
    animation("thinking", 150, "loop", [
      track("root", "rotation", [[0, -1.5], [75, 1.5], [150, -1.5]]),
      track("tailPivot", "rotation", [[0, -2], [75, 2], [150, -2]]),
    ]),
    animation("working", 90, "loop", [
      track("root", "y", [[0, root.y], [45, root.y + 2], [90, root.y]]),
      track("tailPivot", "rotation", [[0, -4], [30, 7], [60, -6], [90, -4]]),
    ]),
    // waiting：任务卡在外部（等接口、等 Skill 回包）。语义是「没我的事，但我在」，
    // 所以是缓慢的重心左右倒 + 低垂慢摆的尾巴，节奏比 working 慢一倍。
    animation("waiting", 240, "loop", [
      track("root", "x", [[0, root.x - 9], [120, root.x + 9], [240, root.x - 9]]),
      track("root", "y", [[0, root.y + 2], [60, root.y + 8], [120, root.y + 2], [180, root.y + 8], [240, root.y + 2]]),
      track("root", "rotation", [[0, 2.5], [120, -2.5], [240, 2.5]]),
      track("tailPivot", "rotation", [[0, -5], [120, 6], [240, -5]]),
    ]),
    // asking：等用户确认。这是唯一需要主动争取注意力的常驻状态，所以幅度
    // 明显大于其它循环——两次点头 + 一段静止凝视，循环起来像在反复催促。
    animation("asking", 168, "loop", [
      track("root", "y", [
        [0, root.y - 12], [18, root.y + 26], [36, root.y - 12],
        [54, root.y + 26], [72, root.y - 12], [168, root.y - 12],
      ]),
      track("root", "rotation", [
        [0, 0], [18, 10], [36, 0], [54, 10], [72, 0], [168, 0],
      ]),
      track("root", "scaleY", [[0, 1], [18, 0.95], [36, 1], [54, 0.95], [72, 1], [168, 1]]),
      track("root", "scaleX", [[0, 1], [18, 1.04], [36, 1], [54, 1.04], [72, 1], [168, 1]]),
      track("tailPivot", "rotation", [[0, -5], [42, 13], [84, -5], [126, 13], [168, -5]]),
    ]),
    animation("happy", 60, "oneShot", [
      track("root", "y", [[0, root.y], [22, root.y - 46], [42, root.y + 8], [60, root.y]]),
      track("root", "scaleY", [[0, 1], [22, 1.05], [42, 0.94], [60, 1]]),
      track("root", "scaleX", [[0, 1], [22, 0.96], [42, 1.05], [60, 1]]),
      track("tailPivot", "rotation", [[0, -5], [15, 14], [30, -11], [45, 13], [60, -5]]),
    ]),
    animation("success", 72, "oneShot", [
      track("root", "y", [[0, root.y], [24, root.y - 54], [48, root.y + 9], [72, root.y]]),
      track("root", "scaleX", [[0, 1], [24, 0.95], [48, 1.06], [72, 1]]),
      track("root", "scaleY", [[0, 1], [24, 1.06], [48, 0.93], [72, 1]]),
    ]),
    animation("error", 54, "oneShot", [
      track("root", "x", [[0, root.x], [9, root.x - 16], [18, root.x + 16], [27, root.x - 11], [36, root.x + 8], [54, root.x]]),
      track("root", "rotation", [[0, 0], [9, -4], [18, 4], [27, -3], [36, 2], [54, 0]]),
    ]),
    animation("land", 48, "oneShot", [
      track("root", "y", [[0, root.y - 40], [20, root.y + 14], [34, root.y - 6], [48, root.y]]),
      track("root", "scaleY", [[0, 1], [20, 0.86], [34, 1.06], [48, 1]]),
      track("root", "scaleX", [[0, 1], [20, 1.09], [34, 0.96], [48, 1]]),
    ]),
    animation("eat", 90, "oneShot", [
      track("root", "rotation", [[0, 0], [20, -9], [40, -4], [60, -9], [90, 0]]),
      track("root", "y", [[0, root.y], [20, root.y + 18], [40, root.y + 10], [60, root.y + 18], [90, root.y]]),
    ]),
    animation("play", 78, "oneShot", [
      track("root", "rotation", [[0, 0], [18, -9], [39, 9], [60, -6], [78, 0]]),
      track("root", "y", [[0, root.y], [18, root.y - 34], [39, root.y + 4], [60, root.y - 24], [78, root.y]]),
      track("tailPivot", "rotation", [[0, -5], [20, 14], [39, -11], [60, 12], [78, -5]]),
    ]),
    animation("tap-head", 42, "oneShot", [
      track("root", "y", [[0, root.y], [12, root.y + 16], [28, root.y - 7], [42, root.y]]),
      track("root", "scaleY", [[0, 1], [12, 0.90], [28, 1.05], [42, 1]]),
      track("root", "scaleX", [[0, 1], [12, 1.07], [28, 0.97], [42, 1]]),
    ]),
    animation("tap-body", 42, "oneShot", [
      track("root", "scaleX", [[0, 1], [12, 0.93], [28, 1.05], [42, 1]]),
      track("root", "scaleY", [[0, 1], [12, 1.07], [28, 0.95], [42, 1]]),
    ]),
    // confused：任务失败但不是"错"，是"没看懂"。与 error 的左右急抖刻意区分——
    // 这里是单向歪头 + 略微后缩，中段停住不动，读起来是疑惑而不是慌张。
    animation("confused", 78, "oneShot", [
      track("root", "rotation", [[0, 0], [16, -15], [46, -15], [62, 4], [78, 0]]),
      track("root", "x", [[0, root.x], [16, root.x + 20], [46, root.x + 20], [78, root.x]]),
      track("root", "y", [[0, root.y], [16, root.y + 12], [46, root.y + 12], [62, root.y - 6], [78, root.y]]),
      track("tailPivot", "rotation", [[0, -3], [16, -6], [46, -6], [78, -3]]),
    ]),
    // 目光端点姿势。由 GazeX / GazeY 两个 blend1d 层连续插值，取代原来的
    // 五个离散 look-* 动画——那种做法只有五档，跟不上鼠标。
    pose("gaze-x-left", [
      ["left-eyePivot", "x", eyeLeft.x - GAZE_X],
      ["right-eyePivot", "x", eyeRight.x - GAZE_X],
    ]),
    pose("gaze-x-center", [
      ["left-eyePivot", "x", eyeLeft.x],
      ["right-eyePivot", "x", eyeRight.x],
    ]),
    pose("gaze-x-right", [
      ["left-eyePivot", "x", eyeLeft.x + GAZE_X],
      ["right-eyePivot", "x", eyeRight.x + GAZE_X],
    ]),
    pose("gaze-y-up", [
      ["left-eyePivot", "y", eyeLeft.y - GAZE_Y],
      ["right-eyePivot", "y", eyeRight.y - GAZE_Y],
    ]),
    pose("gaze-y-center", [
      ["left-eyePivot", "y", eyeLeft.y],
      ["right-eyePivot", "y", eyeRight.y],
    ]),
    pose("gaze-y-down", [
      ["left-eyePivot", "y", eyeLeft.y + GAZE_Y],
      ["right-eyePivot", "y", eyeRight.y + GAZE_Y],
    ]),
    // 眨眼层的静息姿势：把眼睛按在「睁开」，让 blink 有地方可回。
    pose("eyes-open", [
      ["left-eyePivot", "scaleY", 1],
      ["right-eyePivot", "scaleY", 1],
    ]),
    // 呼吸层的停止姿势，供 prefers-reduced-motion 切过去。
    pose("breath-hold", [
      ["breath", "scaleY", 1],
      ["breath", "scaleX", 1],
      ["breath", "y", 0],
    ]),
    // 常驻呼吸。挂在 breath 组上而非 root——root 的 y 被各活动动画占用，
    // 同一属性被两层写会互相覆盖。y 的反向补偿让脚保持踩地。
    animation("breathe", 246, "loop", [
      track("breath", "scaleY", [[0, 1], [123, 1.01], [246, 1]]),
      track("breath", "scaleX", [[0, 1], [123, 0.996], [246, 1]]),
      track("breath", "y", [[0, 0], [123, -1.8], [246, 0]]),
    ]),
    animation("blink", 18, "oneShot", [
      track("left-eyePivot", "scaleY", [[0, 1], [8, 0.12], [18, 1]]),
      track("right-eyePivot", "scaleY", [[0, 1], [8, 0.12], [18, 1]]),
    ]),
    // 只转 near 腿。**far 腿不能转**——build-canonical-rig-layers.py 刻意
    // 不把 far 腿从 base 上挖掉（它们盖在完整底图上），所以一转就会露出底图
    // 里的原腿。实测柴犬 1°、比熊 2° 就能看出来。
    animation("sit", 60, "oneShot", [
      track("root", "y", [[0, root.y], [60, root.y + 8]]),
      track("rear-near-legPivot", "rotation", [[0, 0], [60, 4]]),
    ]),
    animation("crawl", 72, "loop", [
      track("root", "y", [[0, root.y + 7], [18, root.y + 5], [36, root.y + 7], [54, root.y + 5], [72, root.y + 7]]),
      track("front-near-legPivot", "rotation", [[0, -6], [36, 6], [72, -6]]),
      track("rear-near-legPivot", "rotation", [[0, 6], [36, -6], [72, 6]]),
    ]),
  ];
}

function pivotPosition(joint) {
  return {
    x: (joint[0] - sourceCenter) * scale,
    y: (joint[1] - sourceCenter) * scale,
  };
}

function layerImage(breed, name, metadata, parent) {
  const [left, top, right, bottom] = metadata.sourceBox;
  const [jointX, jointY] = metadata.joint;
  return {
    id: name,
    pngPath: path.join(workspace, "artwork", "rive", "canonical-parts", breed, `${name}.png`),
    x: ((left + right) / 2 - jointX) * scale,
    y: ((top + bottom) / 2 - jointY) * scale,
    scale,
    parent,
  };
}

function buildScene(breed, breedConfig) {
  const partsDir = path.join(workspace, "artwork", "rive", "canonical-parts", breed);
  const layout = JSON.parse(readFileSync(path.join(partsDir, "rig-layout.json"), "utf8"));
  const allMetadata = { ...layout.parts, ...layout.eyes };
  const groupPositions = Object.fromEntries(
    Object.entries(allMetadata).map(([name, metadata]) => [name, pivotPosition(metadata.joint)]),
  );
  // breath 夹在 root 和各 pivot 之间，位置为 (0,0) 所以不改变任何既有几何，
  // 但给呼吸层一个独立于 root 的变换目标。
  const groups = [
    { id: "root", x: root.x, y: root.y },
    { id: "breath", x: 0, y: 0, parent: "root" },
    ...Object.entries(groupPositions).map(([name, position]) => ({
      id: `${name}Pivot`,
      x: position.x,
      y: position.y,
      parent: "breath",
    })),
  ];
  const imageOrder = [
    "tail",
    "front-near-leg",
    "rear-near-leg",
    "left-eye",
    "right-eye",
  ];
  const images = [
    {
      id: "base",
      pngPath: path.join(partsDir, "base.png"),
      x: 0,
      y: 0,
      scale,
      parent: "breath",
    },
    ...imageOrder.map((name) =>
      layerImage(breed, name, allMetadata[name], `${name}Pivot`),
    ),
  ];
  const animationList = animations(groupPositions);
  return {
    artboard: { name: breedConfig.artboard, width: 512, height: 512 },
    groups,
    images,
    animations: animationList,
    stateMachine: buildStateMachine(animationList),
  };
}

/** 动画时长（毫秒），用于把一次性反应的退出时机对准动画结束。 */
function durationMs(animationList, name) {
  const found = animationList.find((item) => item.name === name);
  if (!found) throw new Error(`Animation '${name}' not found`);
  return Math.round((found.duration / found.fps) * 1000);
}

/**
 * 四层状态机，取代渲染层的 stop()/play() 硬切。
 *
 *   Body     八种活动互切，180ms 混合过渡
 *   GazeX    blend1d，由 lookX 连续驱动
 *   GazeY    blend1d，由 lookY 连续驱动
 *   Breath   常驻呼吸，永远在播
 *   Blink    静息睁眼 + trigger 眨眼
 *
 * 分层的前提是各层写不同属性：Body 写 root，Breath 写 breath，
 * GazeX/GazeY 写眼睛的 x / y，Blink 写眼睛的 scaleY——互不覆盖。
 */
function buildStateMachine(animationList) {
  const activityNames = Object.keys(ACTIVITY_VALUE);

  const bodyStates = activityNames.map((name) => ({ name, animation: name }));
  const bodyTransitions = [{ from: "entry", to: "idle" }];

  // 活动之间两两显式连线。用 any→state 更短，但那样每次条件求值都可能
  // 重启当前状态；显式连线的语义是确定的。
  for (const from of activityNames) {
    for (const to of activityNames) {
      if (from === to) continue;
      bodyTransitions.push({
        from,
        to,
        durationMs: 180,
        condition: { input: "activity", op: "==", value: ACTIVITY_VALUE[to] },
      });
    }
  }

  // 一次性反应：任意状态经 trigger 进入，播完后按当前 activity 回到对应状态。
  for (const reaction of REACTIONS) {
    bodyStates.push({ name: reaction, animation: reaction });
    bodyTransitions.push({
      from: "any",
      to: reaction,
      durationMs: 80,
      condition: { input: reaction, op: "==" },
    });
    for (const activityName of activityNames) {
      bodyTransitions.push({
        from: reaction,
        to: activityName,
        durationMs: 150,
        exitTimeMs: durationMs(animationList, reaction),
        condition: {
          input: "activity",
          op: "==",
          value: ACTIVITY_VALUE[activityName],
        },
      });
    }
  }

  return {
    name: "PetSM",
    inputs: [
      { name: "activity", type: "number", initial: ACTIVITY_VALUE.idle },
      { name: "lookX", type: "number", initial: 0 },
      { name: "lookY", type: "number", initial: 0 },
      { name: "motion", type: "bool", initial: true },
      { name: "blink", type: "trigger" },
      ...REACTIONS.map((name) => ({ name, type: "trigger" })),
    ],
    layers: [
      { name: "Body", states: bodyStates, transitions: bodyTransitions },
      {
        name: "GazeX",
        states: [
          {
            name: "gazeX",
            blend1d: {
              input: "lookX",
              animations: [
                { animation: "gaze-x-left", value: -1 },
                { animation: "gaze-x-center", value: 0 },
                { animation: "gaze-x-right", value: 1 },
              ],
            },
          },
        ],
        transitions: [{ from: "entry", to: "gazeX" }],
      },
      {
        name: "GazeY",
        states: [
          {
            name: "gazeY",
            blend1d: {
              input: "lookY",
              animations: [
                { animation: "gaze-y-up", value: -1 },
                { animation: "gaze-y-center", value: 0 },
                { animation: "gaze-y-down", value: 1 },
              ],
            },
          },
        ],
        transitions: [{ from: "entry", to: "gazeY" }],
      },
      {
        name: "Breath",
        states: [
          { name: "breathing", animation: "breathe" },
          { name: "breathStill", animation: "breath-hold" },
        ],
        // bool 条件在 Rive 里是与 true 比较：'==' 表示为真，'!=' 表示为假。
        transitions: [
          { from: "entry", to: "breathing" },
          {
            from: "breathing",
            to: "breathStill",
            durationMs: 200,
            condition: { input: "motion", op: "!=" },
          },
          {
            from: "breathStill",
            to: "breathing",
            durationMs: 200,
            condition: { input: "motion", op: "==" },
          },
        ],
      },
      {
        name: "Blink",
        states: [
          { name: "eyesOpen", animation: "eyes-open" },
          { name: "blinking", animation: "blink" },
        ],
        transitions: [
          { from: "entry", to: "eyesOpen" },
          {
            from: "any",
            to: "blinking",
            durationMs: 40,
            condition: { input: "blink", op: "==" },
          },
          {
            from: "blinking",
            to: "eyesOpen",
            durationMs: 60,
            exitTimeMs: durationMs(animationList, "blink"),
          },
        ],
      },
    ],
  };
}

const outputDir = path.join(workspace, "artwork", "rive", "specs");
mkdirSync(outputDir, { recursive: true });
for (const [breed, config] of Object.entries(breeds)) {
  const scene = buildScene(breed, config);
  const outputPath = path.join(outputDir, `${breed}-canonical-v6.scene.json`);
  writeFileSync(outputPath, `${JSON.stringify(scene, null, 2)}\n`);
  console.log(outputPath);
}
