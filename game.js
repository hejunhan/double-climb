const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  stability: document.getElementById("stabilityText"),
  height: document.getElementById("heightText"),
  stone: document.getElementById("stoneText"),
  message: document.getElementById("message"),
  limbPanel: document.getElementById("limbPanel"),
  netStatus: document.getElementById("netStatus"),
  roleText: document.getElementById("roleText"),
  roomCode: document.getElementById("roomCode"),
  playerRole: document.getElementById("playerRole"),
  createRoom: document.getElementById("createRoom"),
  joinRoom: document.getElementById("joinRoom"),
};

const CFG = {
  wallWidth: 520,
  wallHeight: 2300,
  gravity: 700,
  bodyFollow: 4,
  fatigueRate: 0.08,
  fatigueRecover: 0.15,
  segmentWearRate: 0.018,
  segmentRecover: 0.035,
  stoneMaxLoadTime: 4,
  stoneRecover: 1,
  gripRadius: 34,
  maxReach: 150,
  moveRadius: 260,
  footMaxLift: 18,
  bodyFootLiftAllowance: 70,
  bodyMinFootReach: 64,
  bodyExtensionMax: 95,
  ropeSegments: 13,
  ropeGravity: 10000,
  ropeDamping: 0.52,
  ropeConstraintIterations: 12,
  bodyRadius: 30,
  topY: 130,
};

const wall = {
  x: (canvas.width - CFG.wallWidth) / 2,
  y: 0,
  get right() {
    return this.x + CFG.wallWidth;
  },
};

const limbDefs = [
  { id: "leftHand", label: "左手", key: "q", side: -1, joint: "elbow", root: { x: -25, y: -36 }, rest: { x: -74, y: -74 }, upper: 58, lower: 55, bend: -1, color: "#f2cf75" },
  { id: "rightHand", label: "右手", key: "e", side: 1, joint: "elbow", root: { x: 25, y: -36 }, rest: { x: 74, y: -74 }, upper: 58, lower: 55, bend: 1, color: "#f2cf75" },
  { id: "leftFoot", label: "左脚", key: "a", side: -1, joint: "knee", root: { x: -18, y: 40 }, rest: { x: -58, y: 118 }, upper: 72, lower: 70, bend: 1, color: "#82c7d1" },
  { id: "rightFoot", label: "右脚", key: "d", side: 1, joint: "knee", root: { x: 18, y: 40 }, rest: { x: 58, y: 118 }, upper: 72, lower: 70, bend: -1, color: "#82c7d1" },
];

const state = {
  cameraY: 1180,
  selected: "leftHand",
  dragging: false,
  won: false,
  messageTimer: 0,
  stability: 1,
  stabilityInfo: null,
  body: { x: wall.x + CFG.wallWidth / 2, y: 1880, vx: 0, vy: 0, angle: 0 },
  limbTarget: null,
  bodyExtensionTarget: null,
  supplyPickerOpen: false,
  supplyPromptLimb: null,
  ropePoints: null,
  targetLocked: false,
  lastPointer: null,
  ignorePointerUntilMove: false,
  pointerIgnoreOrigin: null,
  keys: new Set(),
};

const NET = {
  ws: null,
  connected: false,
  role: "offline",
  playerRole: "climber",
  room: "",
  remoteStoneKeys: new Set(),
  lastSnapshotSent: 0,
  lastGuestInput: "",
};

const gaps = [
  { y: 1510, h: 220, name: "横向缺口" },
  { y: 980, h: 240, name: "高脚点缺口" },
  { y: 515, h: 260, name: "顶部缺口" },
];

const roughPatches = [
  { x: wall.x + 62, y: 1740, w: 170, h: 130, grip: 0.62 },
  { x: wall.x + 290, y: 1370, w: 160, h: 150, grip: 0.58 },
  { x: wall.x + 74, y: 760, w: 150, h: 140, grip: 0.6 },
  { x: wall.x + 300, y: 300, w: 150, h: 130, grip: 0.56 },
];

const holds = buildHolds();

function defaultSupplies() {
  return [
    { id: "water", label: "水", color: "#6bb7ff", useTarget: "mouth" },
    { id: "biscuit", label: "压缩饼干", color: "#d6a85b", useTarget: "mouth" },
    { id: "bandage", label: "绷带", color: "#f2f0df", useTarget: "injury" },
  ];
}

function createSegments() {
  return {
    upper: { condition: 1 },
    lower: { condition: 1 },
  };
}

const stone = {
  x: state.body.x + 110,
  y: state.body.y - 40,
  r: 22,
  isFixed: false,
  currentLoadTime: 0,
  load: 0,
  shake: 0,
  grip: 0.95,
  kind: "stone",
  supplies: defaultSupplies(),
};

const limbs = Object.fromEntries(
  limbDefs.map((def) => [
    def.id,
    {
      ...def,
      x: state.body.x + def.rest.x,
      y: state.body.y + def.rest.y,
      rootX: state.body.x + def.root.x,
      rootY: state.body.y + def.root.y,
      jointX: state.body.x + (def.root.x + def.rest.x) / 2,
      jointY: state.body.y + (def.root.y + def.rest.y) / 2,
      attached: false,
      target: null,
      heldSupply: null,
      segments: createSegments(),
      grip: 1,
      fatigue: 0,
      load: 0,
    },
  ]),
);

ui.limbPanel.innerHTML = limbDefs
  .map(
    (def) => `
      <div class="limb-row" data-limb="${def.id}">
        <span>${def.label}</span>
        <div class="limb-meter"><div class="limb-fill"></div></div>
        <strong>0%</strong>
      </div>
    `,
  )
  .join("");

attachInitialLimbs();
let lastTime = performance.now();
requestAnimationFrame(loop);

ui.createRoom.addEventListener("click", () => connectOnline("host"));
ui.joinRoom.addEventListener("click", () => connectOnline("guest", ui.roomCode.value));
ui.roomCode.addEventListener("input", () => {
  ui.roomCode.value = ui.roomCode.value.toUpperCase().replace(/[^A-F0-9]/g, "");
});
updateNetUi();

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (event.ctrlKey && key === "c") {
    event.preventDefault();
    capturePoseSnapshot();
    return;
  }
  state.keys.add(key);
  if (isStoneControl(event)) {
    event.preventDefault();
    if (!controlsStone()) return;
    if (NET.role === "guest") {
      sendGuestInput({ kind: "stone", action: event.code === "Space" ? "toggle" : null });
      return;
    }
    if (event.code === "Space") toggleStone();
    return;
  }
  if (!controlsClimber()) return;
  const def = limbDefs.find((item) => item.key === key);
  if (def) {
    if (NET.role === "guest") {
      selectLimb(def.id);
      sendGuestInput({ kind: "climber", action: "select", limbId: def.id });
    } else {
      selectLimb(def.id);
    }
  }
  if (key === "f") handleSupplyKey();
  if (key === "r" && NET.role !== "guest") resetGame();
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.key.toLowerCase());
  if (NET.role === "guest" && controlsStone() && isStoneControl(event)) {
    event.preventDefault();
    sendGuestInput({ kind: "stone", action: null });
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!controlsClimber()) return;
  if (state.supplyPickerOpen) {
    pickSupplyFromPointer(event);
    return;
  }
  if (limbs[state.selected]?.heldSupply) return;
  tryAttachSelectedFromPointer(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (!controlsClimber()) return;
  if (state.supplyPickerOpen) return;
  setLimbTargetFromPointer(event);
});

window.addEventListener("pointerup", () => {
  state.dragging = false;
});

function buildHolds() {
  const items = [];
  let i = 0;
  for (let y = 2050; y > 180; y -= 105) {
    if (gaps.some((gap) => y > gap.y && y < gap.y + gap.h)) continue;
    const row = Math.round((2050 - y) / 105);
    const xs = row % 2 === 0 ? [170, 300, 420] : [120, 250, 385];
    for (const x of xs) {
      if (row % 5 === 2 && x === 250) continue;
      items.push({
        id: `h${i++}`,
        x: wall.x + x + Math.sin(row * 1.8 + x) * 12,
        y,
        r: 13 + (row % 3) * 2,
        grip: 1,
        kind: "hold",
      });
    }
  }
  return items;
}

function attachInitialLimbs() {
  const start = [
    nearestHold(state.body.x - 55, state.body.y - 60),
    nearestHold(state.body.x + 55, state.body.y - 60),
    nearestHold(state.body.x - 45, state.body.y + 70),
    nearestHold(state.body.x + 45, state.body.y + 70),
  ];
  limbDefs.forEach((def, index) => attachLimb(limbs[def.id], start[index]));
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt) {
  if (NET.role === "guest") {
    state.messageTimer = Math.max(0, state.messageTimer - dt);
    return;
  }
  if (state.won) return;
  state.messageTimer = Math.max(0, state.messageTimer - dt);
  updateClimberControl(dt);
  updateStone(dt);
  updateSupplyPrompt();
  updatePose(dt);
  applyRopeConstraint();
  updateRope(dt);
  updateFatigue(dt);
  updateCamera(dt);
  if (state.body.y <= CFG.topY) {
    state.won = true;
    say("到达顶部，合作成功。按 R 重新开始。", 999);
  }
  sendHostSnapshot(dt);
}

function updateStone(dt) {
  if (!stone.isFixed) {
    const speed = 250;
    const stoneKeys = getStoneKeys();
    const dx = (stoneKeys.has("arrowright") ? 1 : 0) - (stoneKeys.has("arrowleft") ? 1 : 0);
    const dy = (stoneKeys.has("arrowdown") ? 1 : 0) - (stoneKeys.has("arrowup") ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    stone.x += (dx / len) * speed * dt;
    stone.y += (dy / len) * speed * dt;
    constrainStoneNearBody();
    stone.currentLoadTime = Math.max(0, stone.currentLoadTime - CFG.stoneRecover * dt);
  } else {
    stone.load = Object.values(limbs).filter((limb) => limb.target === stone).reduce((sum, limb) => sum + limb.load, 0);
    if (stone.load > 0) {
      stone.currentLoadTime += stone.load * dt;
      stone.shake = stone.currentLoadTime > CFG.stoneMaxLoadTime * 0.72 ? Math.random() * 7 : 0;
    } else {
      stone.currentLoadTime = Math.max(0, stone.currentLoadTime - CFG.stoneRecover * dt);
      stone.shake = 0;
    }
    if (stone.currentLoadTime >= CFG.stoneMaxLoadTime) {
      releaseStone("攀岩机器人承重过久，已经松脱。");
    }
  }
}

function connectOnline(mode, roomCode = "") {
  if (!("WebSocket" in window)) {
    say("当前浏览器不支持 WebSocket。");
    return;
  }
  if (NET.ws) NET.ws.close();
  NET.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  NET.ws.addEventListener("open", () => {
    NET.connected = true;
    NET.playerRole = ui.playerRole.value;
    if (mode === "host") {
      NET.ws.send(JSON.stringify({ type: "create", playerRole: NET.playerRole }));
    } else {
      const room = roomCode.trim().toUpperCase();
      if (!room) {
        say("请输入房间码。");
        NET.ws.close();
        return;
      }
      NET.ws.send(JSON.stringify({ type: "join", room, playerRole: NET.playerRole }));
    }
    updateNetUi();
  });
  NET.ws.addEventListener("message", (event) => handleNetMessage(event.data));
  NET.ws.addEventListener("close", () => {
    NET.connected = false;
    NET.role = "offline";
    NET.playerRole = ui.playerRole.value;
    NET.room = "";
    NET.remoteStoneKeys.clear();
    updateNetUi();
    say("已断开联机，回到单机模式。");
  });
}

function handleNetMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === "room") {
    NET.role = msg.role;
    NET.playerRole = msg.playerRole || NET.playerRole;
    NET.room = msg.room;
    ui.roomCode.value = msg.room;
    ui.playerRole.value = NET.playerRole;
    updateNetUi();
    say(msg.role === "host" ? `房间 ${msg.room} 已创建，你选择了${roleLabel(NET.playerRole)}。` : `已加入房间 ${msg.room}，你选择了${roleLabel(NET.playerRole)}。`);
  }
  if (msg.type === "peer") {
    say(msg.present ? "伙伴已加入。" : msg.message || "伙伴已离开。");
  }
  if (msg.type === "remoteInput" && NET.role === "host") {
    handleRemoteInput(msg.input || msg);
  }
  if (msg.type === "state" && NET.role === "guest" && msg.snapshot) {
    applySnapshot(msg.snapshot);
  }
  if (msg.type === "error") {
    say(msg.message || "联机出错。");
  }
}

function sendGuestInput(input) {
  if (!NET.ws || NET.ws.readyState !== WebSocket.OPEN) return;
  const payload = input.kind === "stone" ? { ...input, keys: [...state.keys].filter((key) => key.startsWith("arrow")) } : input;
  const next = JSON.stringify(payload);
  if (!payload.action && next === NET.lastGuestInput) return;
  NET.lastGuestInput = next;
  NET.ws.send(JSON.stringify({ type: "input", input: payload }));
}

function sendHostSnapshot(dt) {
  if (NET.role !== "host" || !NET.ws || NET.ws.readyState !== WebSocket.OPEN) return;
  NET.lastSnapshotSent += dt;
  if (NET.lastSnapshotSent < 0.05) return;
  NET.lastSnapshotSent = 0;
  NET.ws.send(JSON.stringify({ type: "state", snapshot: makeSnapshot() }));
}

function makeSnapshot() {
  return {
    state: {
      cameraY: state.cameraY,
      selected: state.selected,
      won: state.won,
      stability: state.stability,
      stabilityInfo: state.stabilityInfo,
      body: state.body,
      limbTarget: state.limbTarget,
      targetLocked: state.targetLocked,
    },
    stone: { ...stone },
    limbs: Object.fromEntries(
      Object.entries(limbs).map(([id, limb]) => [
        id,
        {
          x: limb.x,
          y: limb.y,
          rootX: limb.rootX,
          rootY: limb.rootY,
          jointX: limb.jointX,
          jointY: limb.jointY,
          attached: limb.attached,
          targetId: limb.target === stone ? "stone" : limb.target?.id || null,
          targetKind: limb.target?.kind || null,
          grip: limb.grip,
          fatigue: limb.fatigue,
          load: limb.load,
        },
      ]),
    ),
  };
}

function applySnapshot(snapshot) {
  Object.assign(state, snapshot.state);
  Object.assign(stone, snapshot.stone);
  for (const [id, data] of Object.entries(snapshot.limbs || {})) {
    const limb = limbs[id];
    if (!limb) continue;
    Object.assign(limb, data);
    limb.target = restoreTarget(data);
  }
}

function restoreTarget(data) {
  if (!data.targetId) return null;
  if (data.targetId === "stone") return stone;
  const hold = holds.find((item) => item.id === data.targetId);
  if (hold) return hold;
  return { id: data.targetId, x: data.x, y: data.y, grip: data.grip || 0.32, kind: data.targetKind || "smooth" };
}

function handleRemoteInput(input) {
  if (!input) return;
  if (input.kind === "climber") {
    if (input.action === "select") selectLimb(input.limbId);
    if (input.action === "target" || input.action === "move") {
      state.selected = input.limbId || state.selected;
      state.lastPointer = { x: Number(input.x), y: Number(input.y) };
      state.limbTarget = { ...state.lastPointer };
    }
    if (input.action === "attach") {
      state.selected = input.limbId || state.selected;
      tryAttachSelectedAt(Number(input.x), Number(input.y));
    }
    return;
  }
  NET.remoteStoneKeys = new Set((input.keys || []).map((key) => String(key).toLowerCase()));
  if (input.action === "toggle") toggleStone();
}

function getStoneKeys() {
  if (NET.role === "host") return NET.playerRole === "stone" ? state.keys : NET.remoteStoneKeys;
  return state.keys;
}

function isStoneControl(event) {
  return event.code === "Space" || event.key.toLowerCase().startsWith("arrow");
}

function controlsClimber() {
  return NET.role === "offline" || NET.playerRole === "climber";
}

function controlsStone() {
  return NET.role === "offline" || NET.playerRole === "stone";
}

function roleLabel(role) {
  return role === "stone" ? "攀岩机器人" : "攀岩者";
}

function updateNetUi() {
  if (NET.role === "host") {
    ui.netStatus.textContent = `房主 ${NET.room}`;
    ui.roleText.textContent = `你控制${roleLabel(NET.playerRole)}；伙伴控制另一个角色。状态会实时同步给对方。`;
  } else if (NET.role === "guest") {
    ui.netStatus.textContent = `加入 ${NET.room}`;
    ui.roleText.textContent = `你控制${roleLabel(NET.playerRole)}；物理状态由房主同步。`;
  } else {
    ui.netStatus.textContent = "离线单机";
    ui.roleText.textContent = "创建或加入房间前，先选择自己想控制的角色。";
  }
}

function constrainStoneNearBody() {
  stone.x = clamp(stone.x, wall.x + stone.r, wall.right - stone.r);
  stone.y = clamp(stone.y, CFG.topY + 20, CFG.wallHeight - 30);
  const dx = stone.x - state.body.x;
  const dy = stone.y - state.body.y;
  const dist = Math.hypot(dx, dy);
  if (dist > CFG.moveRadius) {
    stone.x = state.body.x + (dx / dist) * CFG.moveRadius;
    stone.y = state.body.y + (dy / dist) * CFG.moveRadius;
  }
  if (Math.hypot(stone.x - state.body.x, stone.y - state.body.y) < CFG.bodyRadius + stone.r + 8) {
    stone.x += Math.sign(dx || 1) * 4;
    stone.y += Math.sign(dy || -1) * 4;
  }
}

function applyRopeConstraint() {
  const dx = stone.x - state.body.x;
  const dy = stone.y - state.body.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= CFG.moveRadius || dist < 0.001) return;
  const excess = dist - CFG.moveRadius;
  const ux = dx / dist;
  const uy = dy / dist;

  if (stone.isFixed) {
    state.body.x += ux * excess;
    state.body.y += uy * excess;
    state.body.vx = 0;
    state.body.vy = 0;
  } else {
    stone.x -= ux * excess;
    stone.y -= uy * excess;
  }

  state.body.x = clamp(state.body.x, wall.x + 70, wall.right - 70);
  state.body.y = clamp(state.body.y, CFG.topY, CFG.wallHeight - 120);
  stone.x = clamp(stone.x, wall.x + stone.r, wall.right - stone.r);
  stone.y = clamp(stone.y, CFG.topY + 20, CFG.wallHeight - 30);
}

function ropeAnchor() {
  return bodyPoint({ x: 0, y: -18 });
}

function ensureRopePoints() {
  const start = ropeAnchor();
  const end = { x: stone.x, y: stone.y };
  if (state.ropePoints?.length === CFG.ropeSegments) return;
  state.ropePoints = Array.from({ length: CFG.ropeSegments }, (_, index) => {
    const t = index / (CFG.ropeSegments - 1);
    const sag = Math.sin(Math.PI * t) * 28;
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t + sag,
      px: start.x + (end.x - start.x) * t,
      py: start.y + (end.y - start.y) * t + sag,
    };
  });
}

function pinRopeEnds() {
  const start = ropeAnchor();
  const end = { x: stone.x, y: stone.y };
  const first = state.ropePoints[0];
  const last = state.ropePoints[state.ropePoints.length - 1];
  first.x = start.x;
  first.y = start.y;
  last.x = end.x;
  last.y = end.y;
}

function updateRope(dt) {
  ensureRopePoints();
  const points = state.ropePoints;
  const segmentLength = CFG.moveRadius / (CFG.ropeSegments - 1);
  pinRopeEnds();

  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const vx = (point.x - point.px) * CFG.ropeDamping;
    const vy = (point.y - point.py) * CFG.ropeDamping;
    point.px = point.x;
    point.py = point.y;
    point.x += vx;
    point.y += vy + CFG.ropeGravity * dt * dt;
  }

  for (let iteration = 0; iteration < CFG.ropeConstraintIterations; iteration++) {
    pinRopeEnds();
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const diff = (dist - segmentLength) / dist;
      const offsetX = dx * diff * 0.5;
      const offsetY = dy * diff * 0.5;
      if (i !== 0) {
        a.x += offsetX;
        a.y += offsetY;
      }
      if (i + 1 !== points.length - 1) {
        b.x -= offsetX;
        b.y -= offsetY;
      }
    }
  }
  smoothRopeKinks();
  pinRopeEnds();
}

function smoothRopeKinks() {
  const points = state.ropePoints;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const point = points[i];
    const next = points[i + 1];
    const avgX = (prev.x + next.x) / 2;
    const avgY = (prev.y + next.y) / 2;
    point.x += (avgX - point.x) * 0.08;
    point.y += (avgY - point.y) * 0.08;
  }
}

function updatePose(dt) {
  const attached = Object.values(limbs).filter((limb) => limb.attached);
  let targetBody = attached.length
    ? averagePoint(attached.map((limb) => ({
        x: limb.x - limb.rest.x * 0.62,
        y: limb.y - limb.rest.y * 0.62,
      })))
    : { x: state.body.x, y: state.body.y + 120 };
  if (state.bodyExtensionTarget) {
    const extension = state.bodyExtensionTarget;
    if (!canBodyMoveTo({ ...state.body, x: extension.x, y: extension.y }, extension.limb)) {
      state.bodyExtensionTarget = null;
    } else {
    const weight = Math.min(0.78, extension.weight);
    targetBody = {
      x: targetBody.x + (extension.x - targetBody.x) * weight,
      y: extension.y < targetBody.y
        ? Math.min(targetBody.y, extension.y)
        : targetBody.y + (extension.y - targetBody.y) * weight,
    };
    state.bodyExtensionTarget.weight *= Math.pow(0.55, dt);
    if (state.bodyExtensionTarget.weight < 0.02) state.bodyExtensionTarget = null;
    }
  }

  const com = getCenterOfMass();
  const supportMinX = attached.length ? Math.min(...attached.map((limb) => limb.x)) : state.body.x;
  const supportMaxX = attached.length ? Math.max(...attached.map((limb) => limb.x)) : state.body.x;
  const outside = Math.max(supportMinX - com.x, 0, com.x - supportMaxX, 0);
  const stretch = Object.values(limbs).reduce((max, limb) => {
    const reach = limbMaxReach(limb);
    return Math.max(max, Math.max(0, distance(limb, limbRoot(limb)) - reach) / reach);
  }, 0);
  const supportScore = clamp(attached.length / 4, 0, 1);
  const centerPenalty = clamp(outside / 170, 0, 0.7);
  const rotationPenalty = clamp(Math.abs(state.body.angle) / 0.9, 0, 0.35);
  state.stability = clamp(supportScore - centerPenalty - stretch * 0.55 - rotationPenalty, 0, 1);
  state.stabilityInfo = {
    com,
    supportMinX,
    supportMaxX,
    outside,
    attachedCount: attached.length,
    stretch,
  };

  if (attached.length >= 2) {
    const follow = CFG.bodyFollow * (state.bodyExtensionTarget ? 1.8 : 1);
    state.body.x += (targetBody.x - state.body.x) * follow * dt;
    state.body.y += (targetBody.y - state.body.y) * follow * dt;
    state.body.vy = 0;
  }

  if (state.stability < 0.4 || attached.length < 2) {
    const slide = state.stability < 0.2 ? 1 : 0.45;
    state.body.vy += CFG.gravity * slide * dt;
    state.body.y += state.body.vy * dt;
  }

  state.body.x = clamp(state.body.x, wall.x + 70, wall.right - 70);
  state.body.y = clamp(state.body.y, CFG.topY, CFG.wallHeight - 120);
  state.body.angle += ((com.x - (supportMinX + supportMaxX) / 2) / 210 - state.body.angle) * 4 * dt;

  for (const limb of Object.values(limbs)) {
    if (!limb.attached) {
      if (state.supplyPickerOpen && limb.id === state.supplyPromptLimb) {
        solveLimbIK(limb);
        continue;
      }
      const targetX = state.body.x + limb.rest.x;
      const targetY = state.body.y + limb.rest.y;
      limb.x += (targetX - limb.x) * 6 * dt;
      limb.y += (targetY - limb.y) * 6 * dt;
    }
    solveLimbIK(limb);
  }
}

function updateFatigue(dt) {
  const attached = Object.values(limbs).filter((limb) => limb.attached);
  for (const limb of Object.values(limbs)) {
    if (limb.attached) {
      const reachLoad = clamp(distance(limb, limbRoot(limb)) / limbMaxReach(limb), 0, 1.4);
      const power = limbPower(limb);
      limb.load = ((1 / Math.max(attached.length, 1)) * (1.1 + reachLoad + (1 - state.stability))) / power;
      applySegmentWear(limb, reachLoad, dt);
      limb.fatigue += limb.load * dt * CFG.fatigueRate;
      if (limb.fatigue >= 1 || distance(limb, limbRoot(limb)) > limbMaxReach(limb) * 1.12) {
        detachLimb(limb, limb.fatigue >= 1 ? `${limb.label}疲劳松脱。` : `${limb.label}过度伸展松脱。`);
      }
    } else {
      limb.load = 0;
      const recoveryBoost = attached.length < 2 ? 3.5 : 1;
      limb.fatigue = Math.max(0, limb.fatigue - CFG.fatigueRecover * recoveryBoost * dt);
      recoverSegments(limb, dt * recoveryBoost);
    }
  }
}

function applySegmentWear(limb, reachLoad, dt) {
  const upperLoad = limb.load * (1.15 - reachLoad * 0.3);
  const lowerLoad = limb.load * (0.75 + reachLoad * 0.55);
  limb.segments.upper.condition = clamp(limb.segments.upper.condition - upperLoad * CFG.segmentWearRate * dt, 0, 1);
  limb.segments.lower.condition = clamp(limb.segments.lower.condition - lowerLoad * CFG.segmentWearRate * dt, 0, 1);
}

function recoverSegments(limb, dt) {
  for (const segment of Object.values(limb.segments)) {
    const cap = segment.condition < 0.66 ? 0.72 : 1;
    segment.condition = Math.min(cap, segment.condition + CFG.segmentRecover * dt);
  }
}

function updateClimberControl(dt) {
  if (!state.limbTarget) return;
  const limb = limbs[state.selected];
  if (!limb) return;
  const follow = 13;
  const nextX = limb.x + (state.limbTarget.x - limb.x) * Math.min(1, follow * dt);
  const nextY = limb.y + (state.limbTarget.y - limb.y) * Math.min(1, follow * dt);
  moveSelectedLimbTo(nextX, nextY);
}

function updateCamera(dt) {
  const target = clamp(state.body.y - 380, 0, CFG.wallHeight - canvas.height);
  state.cameraY += (target - state.cameraY) * Math.min(1, dt * 3);
}

function bodyPoint(offset) {
  return bodyPointFrom(state.body, offset);
}

function bodyPointFrom(body, offset) {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  return {
    x: body.x + offset.x * cos - offset.y * sin,
    y: body.y + offset.x * sin + offset.y * cos,
  };
}

function limbRoot(limb) {
  return bodyPoint(limb.root);
}

function limbRootFromBody(limb, body) {
  return bodyPointFrom(body, limb.root);
}

function limbMaxReach(limb) {
  const reserve = 1;
  return Math.max(20, (limb.upper + limb.lower - reserve) * (0.82 + limbPower(limb) * 0.18));
}

function limbPower(limb) {
  const condition = Math.min(limb.segments.upper.condition, limb.segments.lower.condition);
  if (condition > 0.66) return 1;
  if (condition > 0.33) return 0.75;
  return 0.45;
}

function segmentColor(limb, segmentKey) {
  const condition = limb.segments[segmentKey].condition;
  if (condition > 0.66) return limb.attached ? limb.color : "#8a9397";
  if (condition > 0.33) return "#e0b44d";
  return "#ef6960";
}

function segmentLabel(limb, segmentKey) {
  if (limb.joint === "elbow") return segmentKey === "upper" ? `${limb.label}上臂` : `${limb.label}前臂`;
  return segmentKey === "upper" ? `${limb.label}大腿` : `${limb.label}小腿`;
}

function solveLimbIK(limb) {
  const root = limbRoot(limb);
  const maxReach = limbMaxReach(limb);
  let dx = limb.x - root.x;
  let dy = limb.y - root.y;
  let dist = Math.hypot(dx, dy);
  if (dist > maxReach) {
    dx = (dx / dist) * maxReach;
    dy = (dy / dist) * maxReach;
    limb.x = root.x + dx;
    limb.y = root.y + dy;
    dist = maxReach;
  }
  if (dist < 8) {
    dx = limb.side * 8;
    dy = 0;
    dist = 8;
    limb.x = root.x + dx;
    limb.y = root.y + dy;
  }

  const a = limb.upper;
  const b = limb.lower;
  const straightStart = Math.max(20, a + b - 18);
  const straightEnd = a + b - 1;
  const straightT = clamp((dist - straightStart) / (straightEnd - straightStart), 0, 1);
  const straightEase = straightT * straightT * (3 - 2 * straightT);
  const along = clamp((a * a - b * b + dist * dist) / (2 * dist), 0, a);
  const height = Math.sqrt(Math.max(0, a * a - along * along)) * (1 - straightEase);
  const ux = dx / dist;
  const uy = dy / dist;
  const bend = limb.bend || limb.side || 1;

  limb.rootX = root.x;
  limb.rootY = root.y;
  limb.jointX = root.x + ux * along + -uy * height * bend;
  limb.jointY = root.y + uy * along + ux * height * bend;
}

function moveSelectedLimbTo(x, y) {
  const limb = limbs[state.selected];
  setBodyExtensionTarget(limb, x, y);
  limb.x = clamp(x, wall.x + 8, wall.right - 8);
  limb.y = clamp(y, CFG.topY, CFG.wallHeight - 20);
  limb.attached = false;
  limb.target = null;
  const root = limbRoot(limb);
  if (limb.joint === "knee") {
    limb.y = Math.max(limb.y, root.y - CFG.footMaxLift);
  }
  const reach = limbMaxReach(limb);
  if (distance(limb, root) > reach) {
    const dx = limb.x - root.x;
    const dy = limb.y - root.y;
    const len = Math.hypot(dx, dy);
    limb.x = root.x + (dx / len) * reach;
    limb.y = root.y + (dy / len) * reach;
  }
  if (limb.joint === "knee") {
    limb.y = Math.max(limb.y, root.y - CFG.footMaxLift);
  }
  solveLimbIK(limb);
}

function setBodyExtensionTarget(limb, targetX, targetY) {
  if (!limb || limb.joint !== "elbow") return;
  const root = limbRoot(limb);
  const reach = limbMaxReach(limb);
  const dx = targetX - root.x;
  const dy = targetY - root.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= reach * 0.92) return;

  const pull = Math.min(CFG.bodyExtensionMax, dist - reach * 0.82);
  for (let scale = 1; scale >= 0.15; scale -= 0.15) {
    const candidate = {
      ...state.body,
      x: clamp(state.body.x + (dx / dist) * pull * 0.45 * scale, wall.x + 70, wall.right - 70),
      y: clamp(state.body.y + (dy / dist) * pull * scale, CFG.topY, CFG.wallHeight - 120),
    };
    if (!canBodyMoveTo(candidate, limb)) continue;
    state.bodyExtensionTarget = {
      x: candidate.x,
      y: candidate.y,
      limb,
      weight: state.bodyExtensionTarget ? Math.min(0.9, state.bodyExtensionTarget.weight + 0.22) : 0.72,
    };
    return;
  }
}

function canBodyMoveTo(body, movingLimb) {
  for (const limb of Object.values(limbs)) {
    if (limb === movingLimb || !limb.attached) continue;
    const root = limbRootFromBody(limb, body);
    const rootDistance = distance(limb, root);
    if (rootDistance > limbMaxReach(limb) * 1.02) return false;
    if (limb.joint === "knee") {
      if (rootDistance < CFG.bodyMinFootReach) return false;
      if (limb.y < root.y - CFG.bodyFootLiftAllowance) return false;
    }
  }
  return true;
}

function tryAttachSelectedAt(x, y) {
  const limb = limbs[state.selected];
  if (!limb || distance(limb, limbRoot(limb)) > limbMaxReach(limb) * 1.06) {
    say("距离太远，够不到。");
    return;
  }
  const target = gripAt(x, y);
  attachLimb(limb, target);
  state.targetLocked = true;
  state.limbTarget = null;
  say(`${limb.label}已固定，抓力 ${Math.round(target.grip * 100)}%。`);
}

function handAtRobot() {
  return Object.values(limbs)
    .filter((limb) => limb.joint === "elbow")
    .find((limb) => distance(limb, stone) <= CFG.gripRadius + stone.r);
}

function updateSupplyPrompt() {
  if (state.supplyPickerOpen) return;
  state.supplyPromptLimb = handAtRobot()?.id || null;
}

function openSupplyPicker() {
  updateSupplyPrompt();
  if (!state.supplyPromptLimb) return;
  if (!stone.supplies.length) {
    say("攀岩机器人没有剩余物资。");
    return;
  }
  state.supplyPickerOpen = true;
  state.limbTarget = null;
  state.targetLocked = true;
  say("选择要拿取的物资。");
}

function handleSupplyKey() {
  const carrying = Object.values(limbs).find((limb) => limb.heldSupply);
  if (carrying) {
    tryUseHeldSupply(carrying);
    return;
  }
  openSupplyPicker();
}

function supplySlots() {
  const slotSize = 34;
  const gap = 8;
  const total = stone.supplies.length * slotSize + Math.max(0, stone.supplies.length - 1) * gap;
  const startX = stone.x - total / 2;
  const y = stone.y - stone.r - 54;
  return stone.supplies.map((supply, index) => ({
    supply,
    x: startX + index * (slotSize + gap),
    y,
    w: slotSize,
    h: slotSize,
  }));
}

function pickSupplyFromPointer(event) {
  const pos = screenToWorld(event);
  const slot = supplySlots().find((item) => (
    pos.x >= item.x && pos.x <= item.x + item.w && pos.y >= item.y && pos.y <= item.y + item.h
  ));
  if (!slot) {
    state.supplyPickerOpen = false;
    state.targetLocked = false;
    return;
  }
  const hand = limbs[state.supplyPromptLimb] || limbs[state.selected];
  if (!hand || hand.joint !== "elbow") return;
  hand.heldSupply = slot.supply;
  stone.supplies = stone.supplies.filter((item) => item.id !== slot.supply.id);
  state.selected = hand.id;
  state.supplyPickerOpen = false;
  state.targetLocked = false;
  state.limbTarget = { x: hand.x, y: hand.y };
  say(`${hand.label}拿到了${slot.supply.label}。`);
}

function supplyUsePoint(supply) {
  if (supply.useTarget === "mouth") return bodyPoint({ x: 0, y: -72 });
  const injured = mostInjuredSegment();
  if (injured) return injured.mid;
  return bodyPoint({ x: 0, y: 0 });
}

function limbSegments(limb) {
  return [
    {
      limb,
      key: "upper",
      condition: limb.segments.upper.condition,
      start: { x: limb.rootX, y: limb.rootY },
      end: { x: limb.jointX, y: limb.jointY },
      mid: { x: (limb.rootX + limb.jointX) / 2, y: (limb.rootY + limb.jointY) / 2 },
    },
    {
      limb,
      key: "lower",
      condition: limb.segments.lower.condition,
      start: { x: limb.jointX, y: limb.jointY },
      end: { x: limb.x, y: limb.y },
      mid: { x: (limb.jointX + limb.x) / 2, y: (limb.jointY + limb.y) / 2 },
    },
  ];
}

function allBodySegments() {
  return Object.values(limbs).flatMap((limb) => limbSegments(limb));
}

function mostInjuredSegment() {
  return allBodySegments()
    .filter((segment) => segment.condition < 0.85)
    .sort((a, b) => a.condition - b.condition)[0] || null;
}

function nearestInjuredSegment(point) {
  return allBodySegments()
    .filter((segment) => segment.condition < 0.85)
    .map((segment) => ({ ...segment, d: distance(point, segment.mid) }))
    .filter((segment) => segment.d <= 38)
    .sort((a, b) => a.d - b.d || a.condition - b.condition)[0] || null;
}

function tryUseHeldSupply(limb) {
  const supply = limb.heldSupply;
  if (!supply) return;
  if (supply.id === "bandage") {
    if (!nearestInjuredSegment(limb)) {
      say("绷带还没送到受伤部位。");
      return;
    }
    useHeldSupply(limb);
    return;
  }
  const target = supplyUsePoint(supply);
  if (distance(limb, target) > 34) {
    say(`${supply.label}还没送到可使用位置。`);
    return;
  }
  useHeldSupply(limb);
}

function useHeldSupply(limb) {
  const supply = limb.heldSupply;
  if (!supply) return;
  if (supply.id === "water") {
    for (const item of Object.values(limbs)) item.fatigue = Math.max(0, item.fatigue - 0.1);
  } else if (supply.id === "biscuit") {
    for (const item of Object.values(limbs)) item.fatigue = Math.max(0, item.fatigue - 0.16);
  } else if (supply.id === "bandage") {
    const injured = nearestInjuredSegment(limb);
    if (!injured) {
      say("绷带还没对准受伤部位。");
      return;
    }
    injured.limb.segments[injured.key].condition = Math.min(0.85, injured.limb.segments[injured.key].condition + 0.45);
    injured.limb.fatigue = Math.max(0, injured.limb.fatigue - 0.18);
    say(`${limb.label}包扎了${segmentLabel(injured.limb, injured.key)}。`);
    limb.heldSupply = null;
    return;
  }
  say(`${limb.label}使用了${supply.label}。`);
  limb.heldSupply = null;
}

function gripAt(x, y) {
  const candidates = [...holds];
  if (stone.isFixed) candidates.push(stone);
  const nearest = candidates
    .map((item) => ({ item, d: Math.hypot(item.x - x, item.y - y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearest && nearest.d <= CFG.gripRadius) {
    return { ...nearest.item, grip: nearest.item.grip ?? 1, kind: nearest.item === stone ? "robot" : "hold" };
  }
  const rough = roughPatches.find((patch) => x >= patch.x && x <= patch.x + patch.w && y >= patch.y && y <= patch.y + patch.h);
  if (rough) return { id: `rough-${Math.round(x)}-${Math.round(y)}`, x, y, grip: rough.grip, kind: "rough" };
  return { id: `smooth-${Math.round(x)}-${Math.round(y)}`, x, y, grip: 0.32, kind: "smooth" };
}

function nearestHold(x, y) {
  return holds
    .map((item) => ({ item, d: Math.hypot(item.x - x, item.y - y) }))
    .sort((a, b) => a.d - b.d)[0].item;
}

function capturePoseSnapshot() {
  const snapshot = {
    capturedAt: new Date().toISOString(),
    selected: state.selected,
    body: roundPose(state.body),
    stability: roundNumber(state.stability),
    stabilityInfo: state.stabilityInfo ? {
      outside: roundNumber(state.stabilityInfo.outside),
      stretch: roundNumber(state.stabilityInfo.stretch),
      attachedCount: state.stabilityInfo.attachedCount,
      supportMinX: roundNumber(state.stabilityInfo.supportMinX),
      supportMaxX: roundNumber(state.stabilityInfo.supportMaxX),
      com: roundPoint(state.stabilityInfo.com),
    } : null,
    limbTarget: state.limbTarget ? roundPoint(state.limbTarget) : null,
    bodyExtensionTarget: state.bodyExtensionTarget ? {
      x: roundNumber(state.bodyExtensionTarget.x),
      y: roundNumber(state.bodyExtensionTarget.y),
      weight: roundNumber(state.bodyExtensionTarget.weight),
      limbId: state.bodyExtensionTarget.limb?.id || null,
    } : null,
    limbs: Object.fromEntries(Object.entries(limbs).map(([id, limb]) => {
      const root = limbRoot(limb);
      const reach = limbMaxReach(limb);
      const rootToEnd = distance(limb, root);
      const upper = Math.hypot(limb.jointX - root.x, limb.jointY - root.y);
      const lower = Math.hypot(limb.x - limb.jointX, limb.y - limb.jointY);
      return [id, {
        label: limb.label,
        joint: limb.joint,
        attached: limb.attached,
        targetId: limb.target?.id || null,
        targetKind: limb.target?.kind || null,
        heldSupply: limb.heldSupply ? limb.heldSupply.id : null,
        endpoint: roundPoint(limb),
        root: roundPoint(root),
        jointPoint: { x: roundNumber(limb.jointX), y: roundNumber(limb.jointY) },
        rest: roundPoint(limb.rest),
        rootOffset: roundPoint(limb.root),
        rootToEnd: roundNumber(rootToEnd),
        maxReach: roundNumber(reach),
        reachRatio: roundNumber(rootToEnd / reach),
        power: roundNumber(limbPower(limb)),
        segments: {
          upper: {
            label: segmentLabel(limb, "upper"),
            condition: roundNumber(limb.segments.upper.condition),
          },
          lower: {
            label: segmentLabel(limb, "lower"),
            condition: roundNumber(limb.segments.lower.condition),
          },
        },
        segmentLengths: {
          upper: roundNumber(upper),
          lower: roundNumber(lower),
        },
        relativeToBody: {
          endpoint: roundPoint({ x: limb.x - state.body.x, y: limb.y - state.body.y }),
          root: roundPoint({ x: root.x - state.body.x, y: root.y - state.body.y }),
          joint: roundPoint({ x: limb.jointX - state.body.x, y: limb.jointY - state.body.y }),
        },
        load: roundNumber(limb.load),
        fatigue: roundNumber(limb.fatigue),
        grip: roundNumber(limb.grip),
      }];
    })),
  };
  const text = JSON.stringify(snapshot, null, 2);
  console.log("POSE_SNAPSHOT", text);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => say("姿态数据已复制到剪贴板。"),
      () => say("姿态数据已输出到控制台。"),
    );
  } else {
    say("姿态数据已输出到控制台。");
  }
}

function roundNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function roundPoint(point) {
  return {
    x: roundNumber(point.x),
    y: roundNumber(point.y),
  };
}

function roundPose(body) {
  return {
    x: roundNumber(body.x),
    y: roundNumber(body.y),
    vx: roundNumber(body.vx),
    vy: roundNumber(body.vy),
    angle: roundNumber(body.angle),
  };
}

function selectLimb(limbId) {
  const limb = limbs[limbId];
  if (!limb) return;
  state.selected = limbId;
  state.targetLocked = false;
  state.limbTarget = { x: limb.x, y: limb.y };
  state.ignorePointerUntilMove = true;
  state.pointerIgnoreOrigin = state.lastPointer ? { ...state.lastPointer } : null;
  say(`已选择${limb.label}。`);
}

function setLimbTargetFromPointer(event) {
  if (state.targetLocked) return;
  const pos = screenToWorld(event);
  state.lastPointer = pos;
  if (state.ignorePointerUntilMove) {
    if (!state.pointerIgnoreOrigin) {
      state.pointerIgnoreOrigin = pos;
      return;
    }
    if (distance(pos, state.pointerIgnoreOrigin) < 10) return;
    state.ignorePointerUntilMove = false;
    state.pointerIgnoreOrigin = null;
  }
  state.limbTarget = { x: pos.x, y: pos.y };
  if (NET.role === "guest") {
    sendGuestInput({ kind: "climber", action: "target", limbId: state.selected, x: pos.x, y: pos.y });
  }
}

function tryAttachSelectedFromPointer(event) {
  const limb = limbs[state.selected];
  if (!limb) return;
  if (NET.role === "guest") {
    state.targetLocked = true;
    state.limbTarget = null;
    sendGuestInput({ kind: "climber", action: "attach", limbId: state.selected, x: limb.x, y: limb.y });
    return;
  }
  tryAttachSelectedAt(limb.x, limb.y);
}

function attachLimb(limb, target) {
  limb.x = target.x;
  limb.y = target.y;
  limb.attached = true;
  limb.target = target;
  limb.grip = target.grip ?? 1;
  limb.fatigue = Math.min(limb.fatigue, 0.82);
  solveLimbIK(limb);
}

function detachLimb(limb, message) {
  limb.attached = false;
  limb.target = null;
  limb.grip = 1;
  limb.fatigue = Math.min(limb.fatigue, 0.92);
  say(message);
}

function toggleStone() {
  if (stone.isFixed) {
    releaseStone("攀岩机器人解除固定。");
    return;
  }
  constrainStoneNearBody();
  stone.isFixed = true;
  stone.currentLoadTime = Math.min(stone.currentLoadTime, CFG.stoneMaxLoadTime * 0.5);
  say("攀岩机器人已固定，可作为临时手点、脚点或物资点。");
}

function releaseStone(message) {
  stone.isFixed = false;
  stone.shake = 0;
  for (const limb of Object.values(limbs)) {
    if (limb.target === stone) detachLimb(limb, "抓住攀岩机器人的肢体已脱落。");
  }
  say(message);
}

function resetGame() {
  state.body = { x: wall.x + CFG.wallWidth / 2, y: 1880, vx: 0, vy: 0, angle: 0 };
  state.cameraY = 1180;
  state.selected = "leftHand";
  state.won = false;
  state.supplyPickerOpen = false;
  state.supplyPromptLimb = null;
  state.bodyExtensionTarget = null;
  state.ropePoints = null;
  stone.x = state.body.x + 110;
  stone.y = state.body.y - 40;
  stone.isFixed = false;
  stone.currentLoadTime = 0;
  stone.supplies = defaultSupplies();
  for (const def of limbDefs) {
    const limb = limbs[def.id];
    limb.x = state.body.x + def.rest.x;
    limb.y = state.body.y + def.rest.y;
    limb.rootX = state.body.x + def.root.x;
    limb.rootY = state.body.y + def.root.y;
    limb.jointX = state.body.x + (def.root.x + def.rest.x) / 2;
    limb.jointY = state.body.y + (def.root.y + def.rest.y) / 2;
    limb.attached = false;
    limb.target = null;
    limb.heldSupply = null;
    limb.segments = createSegments();
    limb.grip = 1;
    limb.fatigue = 0;
  }
  attachInitialLimbs();
  say("已重新开始。");
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(0, -state.cameraY);
  drawWall();
  drawHolds();
  drawRope();
  drawStone();
  drawClimber();
  ctx.restore();
  drawHud();
  updateUi();
}

function drawWall() {
  ctx.fillStyle = "#2a3032";
  ctx.fillRect(wall.x, 0, CFG.wallWidth, CFG.wallHeight);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let y = 0; y < CFG.wallHeight; y += 80) {
    ctx.beginPath();
    ctx.moveTo(wall.x, y);
    ctx.lineTo(wall.right, y + 28);
    ctx.stroke();
  }
  for (const gap of gaps) {
    ctx.fillStyle = "rgba(15,17,18,0.68)";
    ctx.fillRect(wall.x + 36, gap.y, CFG.wallWidth - 72, gap.h);
    ctx.strokeStyle = "rgba(238,177,78,0.52)";
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(wall.x + 36, gap.y, CFG.wallWidth - 72, gap.h);
    ctx.setLineDash([]);
  }
  for (const patch of roughPatches) {
    ctx.fillStyle = "rgba(142, 167, 137, 0.18)";
    ctx.fillRect(patch.x, patch.y, patch.w, patch.h);
    ctx.strokeStyle = "rgba(176, 207, 160, 0.28)";
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(patch.x, patch.y, patch.w, patch.h);
    ctx.setLineDash([]);
  }
  ctx.fillStyle = "rgba(118,210,164,0.25)";
  ctx.fillRect(wall.x, CFG.topY - 18, CFG.wallWidth, 18);
}

function drawHolds() {
  for (const hold of holds) {
    const dy = hold.y - state.cameraY;
    if (dy < -50 || dy > canvas.height + 50) continue;
    ctx.fillStyle = "#a86e4b";
    ctx.strokeStyle = "#d79b73";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(hold.x, hold.y, hold.r * 1.35, hold.r, Math.sin(hold.y) * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawStone() {
  const x = stone.x + stone.shake * (Math.random() - 0.5);
  const y = stone.y + stone.shake * (Math.random() - 0.5);
  ctx.fillStyle = stone.isFixed ? "#5fb7c8" : "#9aa7ad";
  ctx.strokeStyle = stone.isFixed ? "#d3fbff" : "#dce4e7";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x - stone.r, y - stone.r, stone.r * 2, stone.r * 2, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#182024";
  ctx.fillRect(x - 9, y - 5, 6, 6);
  ctx.fillRect(x + 3, y - 5, 6, 6);
  ctx.strokeStyle = "#182024";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 9);
  ctx.lineTo(x + 8, y + 9);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "11px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("攀岩机器人", x, y + stone.r + 16);
  ctx.textAlign = "left";
  if (!stone.isFixed) {
    ctx.strokeStyle = "rgba(107,209,213,0.22)";
    ctx.beginPath();
    ctx.arc(state.body.x, state.body.y, CFG.moveRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (state.supplyPromptLimb && !state.supplyPickerOpen) {
    drawRobotPrompt(x, y);
  }
  if (state.supplyPickerOpen) {
    drawSupplyPicker();
  }
}

function drawRope() {
  ensureRopePoints();
  pinRopeEnds();
  const points = state.ropePoints;
  const anchor = points[0];
  const end = points[points.length - 1];
  const dist = Math.hypot(end.x - anchor.x, end.y - anchor.y);
  const tension = clamp(dist / CFG.moveRadius, 0, 1);
  ctx.save();
  ctx.strokeStyle = tension > 0.92 ? "#f2cf75" : "rgba(216,226,228,0.72)";
  ctx.lineWidth = 2 + tension * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.fillStyle = "#d8e2e4";
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRobotPrompt(x, y) {
  ctx.fillStyle = "rgba(16,20,22,0.86)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  const text = "按 F 拿取物资";
  ctx.font = "13px Segoe UI, sans-serif";
  const w = ctx.measureText(text).width + 22;
  const h = 28;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - stone.r - 42, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y - stone.r - 23);
  ctx.textAlign = "left";
}

function drawSupplyPicker() {
  for (const slot of supplySlots()) {
    ctx.fillStyle = "rgba(16,20,22,0.9)";
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.w, slot.h, 7);
    ctx.fill();
    ctx.stroke();
    drawSupplyIcon(slot.supply, slot.x + slot.w / 2, slot.y + slot.h / 2, 11);
    ctx.fillStyle = "#ffffff";
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(slot.supply.label, slot.x + slot.w / 2, slot.y + slot.h + 12);
    ctx.textAlign = "left";
  }
}

function drawSupplyIcon(supply, x, y, size) {
  ctx.fillStyle = supply.color;
  ctx.strokeStyle = "#1c2225";
  ctx.lineWidth = 2;
  if (supply.id === "water") {
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.62, size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (supply.id === "biscuit") {
    ctx.beginPath();
    ctx.roundRect(x - size, y - size * 0.65, size * 2, size * 1.3, 4);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.roundRect(x - size, y - size * 0.45, size * 2, size * 0.9, 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#c86464";
    ctx.beginPath();
    ctx.moveTo(x - size * 0.45, y);
    ctx.lineTo(x + size * 0.45, y);
    ctx.moveTo(x, y - size * 0.45);
    ctx.lineTo(x, y + size * 0.45);
    ctx.stroke();
  }
}

function drawClimber() {
  const attached = Object.values(limbs).filter((limb) => limb.attached);
  drawStabilityGuide(attached);

  if (attached.length >= 2) {
    ctx.strokeStyle = stabilityColor();
    ctx.globalAlpha = 0.35 + Math.sin(performance.now() / 90) * 0.12;
    ctx.lineWidth = 3;
    ctx.beginPath();
    attached.forEach((limb, index) => {
      if (index === 0) ctx.moveTo(limb.x, limb.y);
      else ctx.lineTo(limb.x, limb.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(state.body.x, state.body.y);
  ctx.rotate(state.body.angle);
  ctx.fillStyle = "#ed765f";
  ctx.strokeStyle = "#ffd0c7";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-24, -46, 48, 92, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f7c4a7";
  ctx.beginPath();
  ctx.arc(0, -70, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (const limb of Object.values(limbs)) {
    if (limb.heldSupply) drawSupplyUseTarget(limb.heldSupply);
  }

  for (const limb of Object.values(limbs)) {
    solveLimbIK(limb);
    ctx.lineWidth = limb.id.includes("Hand") ? 6 : 7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = segmentColor(limb, "upper");
    ctx.beginPath();
    ctx.moveTo(limb.rootX, limb.rootY);
    ctx.lineTo(limb.jointX, limb.jointY);
    ctx.stroke();
    ctx.strokeStyle = segmentColor(limb, "lower");
    ctx.beginPath();
    ctx.moveTo(limb.jointX, limb.jointY);
    ctx.lineTo(limb.x, limb.y);
    ctx.stroke();
    ctx.fillStyle = "#1b2023";
    ctx.strokeStyle = limb.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(limb.jointX, limb.jointY, limb.joint === "knee" ? 6 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = state.selected === limb.id ? "#ffffff" : limb.color;
    ctx.beginPath();
    ctx.arc(limb.x, limb.y, state.selected === limb.id ? 11 : 8, 0, Math.PI * 2);
    ctx.fill();
    if (limb.heldSupply) {
      drawSupplyIcon(limb.heldSupply, limb.x + 13 * limb.side, limb.y - 12, 8);
    }
    if (limb.attached) {
      ctx.fillStyle = limb.grip > 0.8 ? "#7be08f" : limb.grip > 0.5 ? "#e0b44d" : "#ef6960";
      ctx.font = "10px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`抓${Math.round(limb.grip * 100)}%`, limb.x, limb.y - 12);
      ctx.textAlign = "left";
    }
    if (limb.fatigue > 0.15) {
      const fatigue = clamp(limb.fatigue, 0, 1);
      ctx.fillStyle = "rgba(12,14,15,0.82)";
      ctx.fillRect(limb.x - 20, limb.y + 15, 40, 14);
      ctx.fillStyle = fatigue > 0.72 ? "#ef6960" : fatigue > 0.42 ? "#e0b44d" : "#7be08f";
      ctx.fillRect(limb.x - 18, limb.y + 17, 36 * fatigue, 4);
      ctx.fillStyle = "#ffffff";
      ctx.font = "10px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("疲劳", limb.x, limb.y + 28);
      ctx.textAlign = "left";
    }
  }

  const com = getCenterOfMass();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(com.x, com.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawSupplyUseTarget(supply) {
  const holder = Object.values(limbs).find((limb) => limb.heldSupply === supply);
  if (supply.id === "bandage") {
    const injured = allBodySegments().filter((segment) => segment.condition < 0.85);
    for (const segment of injured) {
      drawSupplyTargetCircle(supply, segment.mid);
    }
    const near = holder ? nearestInjuredSegment(holder) : null;
    if (holder && near) drawSupplyPrompt(`按 F 包扎${segmentLabel(near.limb, near.key)}`, near.mid);
    return;
  }
  const target = supplyUsePoint(supply);
  drawSupplyTargetCircle(supply, target);
  if (holder && distance(holder, target) <= 34) {
    drawSupplyPrompt(`按 F 使用${supply.label}`, target);
  }
}

function drawSupplyTargetCircle(supply, target) {
  ctx.strokeStyle = supply.color;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(target.x, target.y, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSupplyPrompt(text, target) {
  ctx.fillStyle = "rgba(16,20,22,0.86)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.font = "13px Segoe UI, sans-serif";
  const w = ctx.measureText(text).width + 22;
  ctx.beginPath();
  ctx.roundRect(target.x - w / 2, target.y - 48, w, 28, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(text, target.x, target.y - 29);
  ctx.textAlign = "left";
}

function drawStabilityGuide(attached) {
  const info = state.stabilityInfo;
  if (!info) return;
  const guideY = state.body.y + 124;
  const minX = info.supportMinX;
  const maxX = info.supportMaxX;
  const comX = info.com.x;

  ctx.save();
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.strokeStyle = info.attachedCount >= 2 ? "rgba(123,224,143,0.85)" : "rgba(239,105,96,0.85)";
  ctx.beginPath();
  ctx.moveTo(minX, guideY);
  ctx.lineTo(maxX, guideY);
  ctx.stroke();

  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = state.stability >= 0.7 ? "rgba(255,255,255,0.78)" : "rgba(239,105,96,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(comX, guideY - 118);
  ctx.lineTo(comX, guideY + 18);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(12,14,15,0.78)";
  ctx.fillRect(state.body.x - 86, guideY + 18, 172, 34);
  ctx.fillStyle = stabilityColor();
  ctx.font = "14px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  const status = state.stability >= 0.7 ? "稳定" : state.stability >= 0.4 ? "晃动" : "危险";
  ctx.fillText(`重心 ${status}`, state.body.x, guideY + 40);

  if (info.outside > 0) {
    ctx.strokeStyle = "rgba(239,105,96,0.82)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(clamp(comX, minX, maxX), guideY - 18);
    ctx.lineTo(comX, guideY - 18);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHud() {
  ctx.fillStyle = "rgba(12,14,15,0.64)";
  ctx.fillRect(14, 14, 250, 86);
  ctx.fillStyle = "#f5f8f9";
  ctx.font = "16px Segoe UI, sans-serif";
  ctx.fillText(`当前肢体: ${limbs[state.selected].label}`, 28, 42);
  ctx.fillText(`稳定度: ${Math.round(state.stability * 100)}%`, 28, 70);
  ctx.fillText(state.won ? "胜利" : "R 重新开始", 28, 94);
}

function updateUi() {
  ui.stability.textContent = `${Math.round(state.stability * 100)}%`;
  ui.stability.style.color = stabilityColor();
  ui.height.textContent = `${Math.max(0, Math.round((1880 - state.body.y) / 18))} m`;
  ui.stone.textContent = stone.isFixed
    ? `${Math.max(0, CFG.stoneMaxLoadTime - stone.currentLoadTime).toFixed(1)}s`
    : "可移动";
  updateLimbPanel();
  if (state.messageTimer <= 0 && !state.won) {
    ui.message.textContent = state.stability < 0.4 ? "姿态不稳定，尽快增加支点或调整重心。" : "协作移动攀岩机器人，跨过无抓点缺口。";
  }
}

function updateLimbPanel() {
  for (const limb of Object.values(limbs)) {
    const row = ui.limbPanel.querySelector(`[data-limb="${limb.id}"]`);
    const fill = row.querySelector(".limb-fill");
    const value = row.querySelector("strong");
    const fatigue = clamp(limb.fatigue, 0, 1);
    row.classList.toggle("active", state.selected === limb.id);
    fill.style.width = `${Math.round(fatigue * 100)}%`;
    fill.style.backgroundColor = fatigue > 0.72 ? "#ef6960" : fatigue > 0.42 ? "#e0b44d" : "#7be08f";
    value.textContent = limb.attached ? `${Math.round(fatigue * 100)}%/${Math.round(limb.grip * 100)}%` : "休息";
    value.style.color = limb.attached ? fill.style.backgroundColor : "#9aa5a8";
  }
}

function screenToWorld(event) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * sx,
    y: (event.clientY - rect.top) * sy + state.cameraY,
  };
}

function getCenterOfMass() {
  const avg = averagePoint(Object.values(limbs));
  return {
    x: state.body.x * 0.7 + avg.x * 0.3,
    y: state.body.y * 0.7 + avg.y * 0.3,
  };
}

function averagePoint(points) {
  return points.reduce((acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }), { x: 0, y: 0 });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stabilityColor() {
  if (state.stability >= 0.7) return "#7be08f";
  if (state.stability >= 0.4) return "#e0b44d";
  return "#ef6960";
}

function say(message, duration = 2.4) {
  ui.message.textContent = message;
  state.messageTimer = duration;
}
