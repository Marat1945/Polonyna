'use strict';
// Мережа Полонини (без інтернету, тільки локальна мережа).
//
// 1) Пошук пристроїв: кожні 2,5 с UDP-«маячок» (JSON) на порт 45454 усім у мережі (broadcast)
//    через КОЖНЕ підключення комп'ютера — і кабель, і Wi-Fi.
// 2) Повідомлення, файли, сигнали дзвінків — пряме TCP-з'єднання на порт 45455.
//    Кадр = [4 байти довжини][JSON-заголовок][дані файлу]. Отримувач відповідає 1 байтом (1 = прийнято).
// 3) Перевірка «одна мережа» — не навмання: пристрій позначається як «та сама мережа», лише якщо
//    (а) його адреса належить до підмережі одного з наших підключень і
//    (б) він реально відповів на перевірочний кадр «ping» (вимірюємо час відповіді).
// Детальний опис — docs/PROTOCOL.md.

const dgram = require('dgram');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const DISCOVERY_PORT = 45454;
const TCP_PORT = 45455;
const BEACON_INTERVAL = 2500;
const OFFLINE_AFTER = 9000;
const SIGNAL_WINDOW = 12500;
const VERIFY_EVERY = 20000;
const MAX_HEADER = 256 * 1024;
const MAX_PAYLOAD = 2 * 1024 * 1024 * 1024;
const APP_TAG = 'polonyna';
const PROTOCOL_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_TYPES = ['wifi', 'cable', 'virtual', 'other'];

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// ---------- тип підключення: кабель / Wi-Fi ----------

let adapterInfo = {}; // ім'я адаптера -> { type, desc }
let adapterNames = '';

function guessType(name, desc) {
  const s = `${name} ${desc || ''}`;
  if (/virtual|vmware|vbox|virtualbox|hyper-v|vethernet|tap-|wintun|zerotier|radmin|hamachi|tailscale|bluetooth|loopback|teredo|docker|wsl|npcap/i.test(s)) return 'virtual';
  if (/wi-?fi|wlan|wireless|802\.11|беспровод|бездрот|bezprzewod/i.test(s)) return 'wifi';
  if (/ethernet|^eth\d|^en[a-z0-9]+$|^lan|gbe|realtek pcie|intel\(r\) ethernet|подключение по локальной|підключення по локальній|połączenie lokalne/i.test(s)) return 'cable';
  return 'other';
}

/** На Windows точно визначаємо тип через Get-NetAdapter (PhysicalMediaType: 802.3 = кабель, 802.11 = Wi-Fi). */
function refreshAdapterTypes() {
  if (process.platform !== 'win32') return;
  const cmd = 'Get-NetAdapter -IncludeHidden | Select-Object Name,InterfaceDescription,PhysicalMediaType,NdisPhysicalMedium | ConvertTo-Json -Compress';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 10000, windowsHide: true }, (err, stdout) => {
    if (err || !stdout) return;
    try {
      let list = JSON.parse(stdout);
      if (!Array.isArray(list)) list = [list];
      const map = {};
      for (const a of list) {
        if (!a || !a.Name) continue;
        const pm = `${a.PhysicalMediaType || ''} ${a.NdisPhysicalMedium || ''}`;
        let type = guessType(a.Name, a.InterfaceDescription);
        if (type !== 'virtual') {
          if (/802\.11|Wireless|\b9\b|\b1\b/i.test(pm)) type = 'wifi';
          else if (/802\.3|\b14\b/i.test(pm)) type = 'cable';
        }
        map[a.Name] = { type, desc: String(a.InterfaceDescription || '') };
      }
      adapterInfo = map;
    } catch {
      /* залишаємо визначення за назвою */
    }
  });
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => ((acc << 8) + (Number(o) & 255)) >>> 0, 0);
}
function maskBits(mask) {
  return String(mask || '255.255.255.0').split('.').reduce((n, o) => n + ((Number(o) >>> 0).toString(2).match(/1/g) || []).length, 0);
}
function inSubnet(ip, base, mask) {
  try {
    const m = ipToInt(mask);
    return (ipToInt(ip) & m) === (ipToInt(base) & m);
  } catch {
    return false;
  }
}

function ipv4Interfaces() {
  const result = [];
  const all = os.networkInterfaces();
  for (const [name, list] of Object.entries(all)) {
    for (const a of list || []) {
      const fam = typeof a.family === 'string' ? a.family : a.family === 4 ? 'IPv4' : 'IPv6';
      if (fam !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = String(a.netmask || '255.255.255.0').split('.').map(Number);
      const broadcast = ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join('.');
      const netAddr = ip.map((o, i) => o & mask[i]).join('.');
      const info = adapterInfo[name];
      const type = info ? info.type : guessType(name, '');
      result.push({ name, address: a.address, netmask: a.netmask, broadcast, network: `${netAddr}/${maskBits(a.netmask)}`, type });
    }
  }
  // спершу справжні підключення (кабель, Wi-Fi), віртуальні — в кінці
  const rank = { cable: 0, wifi: 1, other: 2, virtual: 3 };
  return result.sort((x, y) => rank[x.type] - rank[y.type]);
}

function parseHostPort(text) {
  const m = String(text || '').trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/);
  if (!m) return null;
  if (m[1].split('.').some((o) => Number(o) > 255)) return null;
  const port = m[2] ? Number(m[2]) : TCP_PORT;
  if (!(port > 0 && port < 65536)) return null;
  return { host: m[1], port };
}

class Network extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => object} opts.identity  — {id, name, username, deviceName, deviceType, os, avatar}
   * @param {string} opts.tempDir         — куди тимчасово писати файли, що приймаються
   * @param {(header, tmpPath, remoteAddress) => Promise<boolean>} opts.onFrame
   */
  constructor({ identity, tempDir, onFrame }) {
    super();
    this.identity = identity;
    this.tempDir = tempDir;
    this.onFrame = onFrame;
    this.peers = new Map();
    this.manualHosts = new Set();
    this.udp = null;
    this.server = null;
    this.tcpPort = 0;
    this.running = false;
    this.timers = [];
  }

  async start() {
    if (this.running) return;
    this.running = true;
    refreshAdapterTypes();
    await this.startTcp();
    this.startUdp();
    this.timers.push(setInterval(() => this.sendBeacon(false), BEACON_INTERVAL));
    this.timers.push(setInterval(() => this.sweep(), 1500));
    this.timers.push(setInterval(() => this.verifyAll(), VERIFY_EVERY));
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    try {
      this.udp && this.udp.close();
    } catch {
      /* already closed */
    }
    this.udp = null;
    try {
      this.server && this.server.close();
    } catch {
      /* already closed */
    }
    this.server = null;
    for (const p of this.peers.values()) {
      if (p.online) {
        p.online = false;
        this.emit('peer', this.peerInfo(p));
      }
    }
  }

  // ---------- пошук пристроїв (UDP) ----------

  startUdp() {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('message', (msg, rinfo) => this.onBeacon(msg, rinfo));
    sock.on('error', (err) => {
      this.emit('warning', 'udp', err);
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      if (this.udp === sock) this.udp = null;
      if (this.running) setTimeout(() => this.running && !this.udp && this.startUdp(), 5000);
    });
    sock.bind(DISCOVERY_PORT, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* ignore */
      }
      this.udp = sock;
      this.sendBeacon(true);
    });
  }

  beaconTargets(ifaces) {
    const set = new Set(['255.255.255.255']);
    for (const i of ifaces) set.add(i.broadcast);
    for (const h of this.manualHosts) set.add(h);
    return [...set];
  }

  sendBeacon(ask, onlyTo) {
    if (!this.udp || !this.running) return;
    const ifaces = ipv4Interfaces();
    const names = ifaces.map((i) => i.name + i.address).join('|');
    if (names !== adapterNames) {
      // підключення змінилися (вставили кабель, під'єдналися до Wi-Fi) — уточнюємо типи
      adapterNames = names;
      refreshAdapterTypes();
    }
    const me = this.identity();
    const payload = Buffer.from(
      JSON.stringify({
        app: APP_TAG,
        v: PROTOCOL_VERSION,
        id: me.id,
        name: me.name,
        username: me.username,
        deviceName: me.deviceName,
        deviceType: me.deviceType,
        os: me.os,
        avatar: me.avatar || '',
        port: this.tcpPort,
        links: ifaces.slice(0, 8).map((i) => ({ ip: i.address, prefix: maskBits(i.netmask), type: i.type })),
        ask: !!ask,
      }),
      'utf8'
    );
    const targets = onlyTo ? [onlyTo] : this.beaconTargets(ifaces);
    for (const host of targets) {
      try {
        this.udp.send(payload, DISCOVERY_PORT, host, () => {});
      } catch {
        /* мережевий інтерфейс міг зникнути */
      }
    }
  }

  /** Попросити всіх пристроїв поруч відповісти негайно (кнопка «Оновити»). */
  refresh() {
    this.sendBeacon(true);
  }

  onBeacon(buf, rinfo) {
    if (buf.length > 8192) return;
    let m;
    try {
      m = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    const me = this.identity();
    if (!m || m.app !== APP_TAG || !SAFE_ID.test(String(m.id)) || m.id === me.id) return;
    const port = Number(m.port);
    if (!(port > 0 && port < 65536)) return;
    if (m.ask) this.sendBeacon(false, rinfo.address);
    const links = Array.isArray(m.links)
      ? m.links.slice(0, 8).map((l) => ({ ip: str(l && l.ip, 15), prefix: Number(l && l.prefix) || 24, type: LINK_TYPES.includes(l && l.type) ? l.type : 'other' }))
      : [];
    this.touch(m.id, rinfo.address, port, {
      name: str(m.name, 64),
      username: str(m.username, 40),
      deviceName: str(m.deviceName, 64),
      deviceType: str(m.deviceType, 16),
      os: str(m.os, 24),
      avatar: str(m.avatar, 40),
      links,
    }, true);
  }

  /** Оновити відомості про пристрій (після маячка або будь-якого TCP-кадру від нього). */
  touch(id, address, port, info, fromBeacon) {
    if (!SAFE_ID.test(String(id))) return;
    const now = Date.now();
    let p = this.peers.get(id);
    const wasOnline = !!(p && p.online);
    if (!p) {
      p = { id, beacons: [], links: [] };
      this.peers.set(id, p);
    }
    const snapshot = () => JSON.stringify([p.name, p.username, p.deviceName, p.deviceType, p.os, p.avatar, p.address, p.port, this.signal(p), p.link, p.sameSubnet]);
    const before = snapshot();
    for (const [k, v] of Object.entries(info || {})) {
      if (k === 'avatar' && fromBeacon) p.avatar = v || '';
      else if (v && (!Array.isArray(v) || v.length)) p[k] = v;
    }
    if (address) p.address = address.replace(/^::ffff:/, '');
    if (port) p.port = port;
    this.classify(p);
    p.online = true;
    p.lastSeen = now;
    if (fromBeacon) {
      p.beacons.push(now);
      p.beacons = p.beacons.filter((t) => now - t < SIGNAL_WINDOW);
    }
    if (!wasOnline || before !== snapshot()) this.emit('peer', this.peerInfo(p), !wasOnline);
    if (!wasOnline) setTimeout(() => this.ping(id), 400);
  }

  /** Через що підключений співрозмовник і чи в тій самій ми підмережі. */
  classify(p) {
    const theirs = (p.links || []).find((l) => l.ip === p.address);
    p.link = theirs ? theirs.type : p.link || '';
    const mine = ipv4Interfaces().find((i) => p.address && inSubnet(p.address, i.address, i.netmask));
    p.sameSubnet = !!mine;
    p.localType = mine ? mine.type : '';
    p.network = mine ? mine.network : '';
  }

  signal(p) {
    const n = (p.beacons || []).length;
    if (n >= 5) return 4;
    if (n >= 4) return 3;
    if (n >= 2) return 2;
    return n ? 1 : 3;
  }

  sweep() {
    const now = Date.now();
    for (const p of this.peers.values()) {
      if (!p.online) continue;
      p.beacons = (p.beacons || []).filter((t) => now - t < SIGNAL_WINDOW);
      if (now - p.lastSeen > OFFLINE_AFTER) {
        p.online = false;
        p.verifiedAt = 0;
        this.emit('peer', this.peerInfo(p), false);
      } else if (p.lastSignal !== this.signal(p)) {
        this.emit('peer', this.peerInfo(p), false);
      }
    }
  }

  /** Перевірка зв'язку: TCP-кадр «ping», вимірюємо час до підтвердження. */
  async ping(id) {
    const p = this.peers.get(id);
    if (!p || !p.online || !p.address || !p.port) return null;
    const t0 = Date.now();
    const ok = await this.sendTo(p.address, p.port, { type: 'ping' }, null, 4000);
    if (ok) {
      p.rtt = Date.now() - t0;
      p.verifiedAt = Date.now();
    } else {
      p.rtt = null;
      p.verifiedAt = 0;
    }
    this.classify(p);
    this.emit('peer', this.peerInfo(p), false);
    return ok ? p.rtt : null;
  }

  async verifyAll() {
    const now = Date.now();
    for (const p of this.peers.values()) {
      if (p.online && (!p.verifiedAt || now - p.verifiedAt > VERIFY_EVERY - 1000)) await this.ping(p.id);
    }
  }

  peerInfo(p) {
    p.lastSignal = this.signal(p);
    return {
      id: p.id,
      name: p.name || '',
      username: p.username || '',
      deviceName: p.deviceName || '',
      deviceType: p.deviceType || '',
      os: p.os || '',
      avatar: p.avatar || '',
      address: p.address || '',
      port: p.port || 0,
      online: !!p.online,
      lastSeen: p.lastSeen || 0,
      signal: p.lastSignal,
      link: p.link || '',
      localType: p.localType || '',
      sameSubnet: !!p.sameSubnet,
      network: p.network || '',
      rtt: p.rtt == null ? null : p.rtt,
      verifiedAt: p.verifiedAt || 0,
    };
  }

  listPeers() {
    return [...this.peers.values()].map((p) => this.peerInfo(p));
  }

  isOnline(id) {
    const p = this.peers.get(id);
    return !!(p && p.online);
  }

  addresses() {
    return ipv4Interfaces();
  }

  // ---------- TCP: сервер ----------

  startTcp() {
    return new Promise((resolve) => {
      const server = net.createServer((s) => this.handleConnection(s));
      let triedRandom = false;
      server.on('listening', () => {
        this.tcpPort = server.address().port;
        this.server = server;
        resolve();
      });
      server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && !triedRandom) {
          triedRandom = true;
          server.listen(0);
        } else {
          this.emit('warning', 'tcp', err);
          resolve();
        }
      });
      server.listen(TCP_PORT);
    });
  }

  handleConnection(socket) {
    socket.setNoDelay(true);
    socket.setTimeout(30000, () => socket.destroy());
    const remoteAddress = String(socket.remoteAddress || '').replace(/^::ffff:/, '');
    let stage = 'len';
    let buffer = Buffer.alloc(0);
    let headerLength = 0;
    let header = null;
    let remaining = 0;
    let fileStream = null;
    let tmpPath = null;

    const cleanupTmp = () => {
      if (tmpPath) fs.rm(tmpPath, { force: true }, () => {});
    };
    const fail = () => {
      stage = 'failed';
      if (fileStream) fileStream.destroy();
      cleanupTmp();
      socket.destroy();
    };

    const complete = async () => {
      let ok = false;
      try {
        ok = (await this.onFrame(header, tmpPath, remoteAddress)) !== false;
      } catch (e) {
        console.error('[net] frame handler failed', e);
        ok = false;
      }
      cleanupTmp();
      try {
        socket.end(Buffer.from([ok ? 1 : 0]));
      } catch {
        /* ignore */
      }
    };

    const writePayload = (chunk) => {
      if (chunk.length > remaining) chunk = chunk.subarray(0, remaining);
      remaining -= chunk.length;
      if (!fileStream.write(chunk)) {
        socket.pause();
        fileStream.once('drain', () => socket.resume());
      }
      if (remaining === 0) {
        stage = 'done';
        fileStream.end(() => complete());
      }
    };

    socket.on('data', (chunk) => {
      if (stage === 'payload') return writePayload(chunk);
      if (stage !== 'len' && stage !== 'header') return;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      if (stage === 'len') {
        if (buffer.length < 4) return;
        headerLength = buffer.readUInt32BE(0);
        if (headerLength < 2 || headerLength > MAX_HEADER) return fail();
        buffer = buffer.subarray(4);
        stage = 'header';
      }
      if (stage === 'header') {
        if (buffer.length < headerLength) return;
        try {
          header = JSON.parse(buffer.subarray(0, headerLength).toString('utf8'));
        } catch {
          return fail();
        }
        const rest = buffer.subarray(headerLength);
        buffer = Buffer.alloc(0);
        if (!header || typeof header !== 'object' || typeof header.type !== 'string' || !SAFE_ID.test(String(header.senderId))) {
          return fail();
        }
        remaining = Number(header.payloadLength) || 0;
        if (!Number.isFinite(remaining) || remaining < 0 || remaining > MAX_PAYLOAD) return fail();
        const senderPort = Number(header.senderPort);
        this.touch(header.senderId, remoteAddress, senderPort > 0 && senderPort < 65536 ? senderPort : 0, {
          name: str(header.senderName, 64),
        }, false);
        if (remaining > 0) {
          tmpPath = path.join(this.tempDir, 'rx-' + crypto.randomUUID() + '.part');
          fileStream = fs.createWriteStream(tmpPath);
          fileStream.on('error', fail);
          stage = 'payload';
          if (rest.length) writePayload(rest);
        } else {
          stage = 'done';
          complete();
        }
      }
    });
    socket.on('error', () => {
      /* обробляється в close */
    });
    socket.on('close', () => {
      if (stage === 'payload' || stage === 'len' || stage === 'header') {
        if (fileStream) fileStream.destroy();
        cleanupTmp();
      }
    });
  }

  // ---------- TCP: відправка ----------

  /** Надіслати кадр пристрою за id. Повертає true, якщо отримувач підтвердив прийом. */
  send(peerId, header, payloadPath) {
    const p = this.peers.get(peerId);
    if (!p || !p.online || !p.address || !p.port) return Promise.resolve(false);
    return this.sendTo(p.address, p.port, header, payloadPath);
  }

  sendTo(host, port, header, payloadPath, timeoutMs = 15000) {
    return new Promise((resolve) => {
      if (!this.running) return resolve(false);
      let payloadLength = 0;
      if (payloadPath) {
        try {
          payloadLength = fs.statSync(payloadPath).size;
        } catch {
          return resolve(false);
        }
      }
      const me = this.identity();
      const full = Object.assign({}, header, {
        v: PROTOCOL_VERSION,
        senderId: me.id,
        senderName: me.name,
        senderPort: this.tcpPort,
        payloadLength,
      });
      let headBuf;
      try {
        const json = Buffer.from(JSON.stringify(full), 'utf8');
        if (json.length > MAX_HEADER) return resolve(false);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(json.length, 0);
        headBuf = Buffer.concat([len, json]);
      } catch {
        return resolve(false);
      }

      let done = false;
      let timer = null;
      const socket = net.createConnection({ host, port });
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(ok);
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(false), timeoutMs);
      };
      arm();
      socket.setNoDelay(true);
      socket.on('connect', () => {
        socket.write(headBuf);
        if (payloadPath && payloadLength > 0) {
          const rs = fs.createReadStream(payloadPath, { highWaterMark: 256 * 1024 });
          rs.on('data', arm);
          rs.on('error', () => finish(false));
          rs.pipe(socket, { end: false });
        }
      });
      socket.on('data', (d) => finish(d.length > 0 && d[0] === 1));
      socket.on('error', () => finish(false));
      socket.on('close', () => finish(false));
    });
  }

  /** Ручне підключення за адресою «192.168.1.25» або «192.168.1.25:45455». */
  async connectManual(text) {
    const hp = parseHostPort(text);
    if (!hp) return { ok: false, reason: 'format' };
    const ok = await this.sendTo(hp.host, hp.port, { type: 'hello' }, null);
    if (ok) {
      this.manualHosts.add(hp.host);
      this.sendBeacon(true, hp.host);
    }
    return { ok, host: hp.host };
  }
}

module.exports = { Network, DISCOVERY_PORT, TCP_PORT, PROTOCOL_VERSION, ipv4Interfaces, parseHostPort, guessType };
