const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 5177);
const ROOT = __dirname;
const rooms = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade !== "websocket") {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const client = { id: crypto.randomBytes(4).toString("hex"), socket, room: null, role: null };
  socket.on("data", (chunk) => readFrames(chunk).forEach((text) => handleMessage(client, text)));
  socket.on("close", () => leave(client));
  socket.on("error", () => leave(client));
});

function handleMessage(client, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }

  if (msg.type === "create") {
    leave(client);
    const playerRole = normalizePlayerRole(msg.playerRole);
    const code = makeCode();
    rooms.set(code, { host: client, guest: null, hostPlayerRole: playerRole, guestPlayerRole: null });
    client.room = code;
    client.role = "host";
    client.playerRole = playerRole;
    send(client, { type: "room", role: "host", playerRole, room: code });
    return;
  }

  if (msg.type === "join") {
    const code = String(msg.room || "").trim().toUpperCase();
    const room = rooms.get(code);
    const playerRole = normalizePlayerRole(msg.playerRole);
    if (!room || room.guest) {
      send(client, { type: "error", message: "房间不存在或已满" });
      return;
    }
    if (playerRole === room.hostPlayerRole) {
      send(client, { type: "error", message: "这个角色已被房主选择，请换另一个角色" });
      return;
    }
    leave(client);
    room.guest = client;
    room.guestPlayerRole = playerRole;
    client.room = code;
    client.role = "guest";
    client.playerRole = playerRole;
    send(client, { type: "room", role: "guest", playerRole, room: code });
    send(room.host, { type: "peer", present: true, playerRole });
    return;
  }

  const room = rooms.get(client.room);
  if (!room) return;

  if (msg.type === "input" && client === room.guest && room.host) {
    send(room.host, { type: "remoteInput", input: msg.input || { keys: msg.keys || [], action: msg.action || null } });
  }

  if (msg.type === "state" && client === room.host && room.guest) {
    send(room.guest, { type: "state", snapshot: msg.snapshot });
  }
}

function leave(client) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (room?.host === client) {
    if (room.guest) send(room.guest, { type: "peer", present: false, message: "房主已离开" });
    rooms.delete(client.room);
  } else if (room?.guest === client) {
    room.guest = null;
    room.guestPlayerRole = null;
    if (room.host) send(room.host, { type: "peer", present: false });
  }
  client.room = null;
  client.role = null;
}

function send(client, data) {
  if (!client || client.socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(data));
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  client.socket.write(Buffer.concat([header, payload]));
}

function readFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset++];
    const second = buffer[offset++];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    if (length === 126) {
      if (offset + 2 > buffer.length) break;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (offset + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }
    const masked = (second & 0x80) !== 0;
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    offset += masked ? 4 : 0;
    if (offset + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    offset += length;
    if (opcode === 8) break;
    if (opcode !== 1) continue;
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    messages.push(payload.toString("utf8"));
  }
  return messages;
}

function makeCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function normalizePlayerRole(value) {
  return value === "stone" ? "stone" : "climber";
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Double Climb server: http://127.0.0.1:${PORT}`);
});
