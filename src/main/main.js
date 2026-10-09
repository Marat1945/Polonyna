'use strict';
// Полонина для Windows — головний процес Electron.

const {
  app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, nativeImage, session, clipboard, crashReporter,
} = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Store } = require('./store');
const { Network, DISCOVERY_PORT, TCP_PORT } = require('./network');

// ---------- профіль запуску (для двох копій на одному ПК: --profile=2) ----------
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
const PROFILE = profileArg ? profileArg.slice(10).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) : '';
app.setPath('userData', path.join(app.getPath('appData'), PROFILE ? `Polonyna-${PROFILE}` : 'Polonyna'));
// якщо програма аварійно завершиться, звіт лишиться локально (нікуди не надсилається) — для діагностики
try {
  crashReporter.start({ uploadToServer: false });
} catch {
  /* ignore */
}

// Справжні IP-адреси для голосових дзвінків у локальній мережі (замість прихованих mDNS-імен).
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// Мелодія вхідного дзвінка має звучати, навіть якщо вікно згорнуте.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const APP_ID = 'com.polonyna.desktop';
const ASSETS = path.join(__dirname, '..', 'renderer', 'assets');
const ICON_PATH = path.join(ASSETS, 'emblem-256.png');
const MAX_FILE = 2 * 1024 * 1024 * 1024 - 1;
const KINDS = ['TEXT', 'PHOTO', 'AUDIO', 'VIDEO', 'FILE', 'SYSTEM', 'CALL'];
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MAIN_TEXT = {
  uk: {
    trayOpen: 'Відкрити Полонину', trayQuit: 'Вийти', bgTitle: 'Полонина працює у фоні',
    bgBody: 'Повідомлення й дзвінки надходитимуть далі. Повністю вийти можна через значок біля годинника.',
    incomingCall: 'Вхідний дзвінок', photo: '📷 Фото', voice: '🎤 Голосове повідомлення', video: '📹 Відеоповідомлення',
    file: '📎', images: 'Зображення', allFiles: 'Усі файли', chooseFolder: 'Оберіть папку для медіа', lan: 'Локальний Wi-Fi',
    cut: 'Вирізати', copy: 'Копіювати', paste: 'Вставити', selectAll: 'Виділити все', group: 'Група', device: 'Пристрій',
    chooseAvatar: 'Оберіть фото профілю', sysGroup: 'створює групу',
  },
  ru: {
    trayOpen: 'Открыть Полонину', trayQuit: 'Выйти', bgTitle: 'Полонина работает в фоне',
    bgBody: 'Сообщения и звонки будут приходить дальше. Полностью выйти можно через значок возле часов.',
    incomingCall: 'Входящий звонок', photo: '📷 Фото', voice: '🎤 Голосовое сообщение', video: '📹 Видеосообщение',
    file: '📎', images: 'Изображения', allFiles: 'Все файлы', chooseFolder: 'Выберите папку для медиа', lan: 'Локальный Wi-Fi',
    cut: 'Вырезать', copy: 'Копировать', paste: 'Вставить', selectAll: 'Выделить всё', group: 'Группа', device: 'Устройство',
    chooseAvatar: 'Выберите фото профиля', sysGroup: 'создаёт группу',
  },
  pl: {
    trayOpen: 'Otwórz Polonynę', trayQuit: 'Zakończ', bgTitle: 'Polonyna działa w tle',
    bgBody: 'Wiadomości i połączenia nadal będą docierać. Całkowicie zamkniesz program ikoną obok zegara.',
    incomingCall: 'Połączenie przychodzące', photo: '📷 Zdjęcie', voice: '🎤 Wiadomość głosowa', video: '📹 Wiadomość wideo',
    file: '📎', images: 'Obrazy', allFiles: 'Wszystkie pliki', chooseFolder: 'Wybierz folder na multimedia', lan: 'Lokalne Wi-Fi',
    cut: 'Wytnij', copy: 'Kopiuj', paste: 'Wklej', selectAll: 'Zaznacz wszystko', group: 'Grupa', device: 'Urządzenie',
    chooseAvatar: 'Wybierz zdjęcie profilowe', sysGroup: 'tworzy grupę',
  },
  en: {
    trayOpen: 'Open Polonyna', trayQuit: 'Quit', bgTitle: 'Polonyna keeps running',
    bgBody: 'Messages and calls will keep arriving. Quit completely from the icon next to the clock.',
    incomingCall: 'Incoming call', photo: '📷 Photo', voice: '🎤 Voice message', video: '📹 Video message',
    file: '📎', images: 'Images', allFiles: 'All files', chooseFolder: 'Choose a folder for media', lan: 'Local Wi-Fi',
    cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', group: 'Group', device: 'Device',
    chooseAvatar: 'Choose a profile photo', sysGroup: 'creates the group',
  },
};

Object.assign(MAIN_TEXT.uk, { audio: 'Аудіо', chooseSound: 'Оберіть мелодію', privateMsg: '🔥 Приватне повідомлення', saveAs: 'Зберегти як', incomingVideoCall: 'Вхідний відеодзвінок' });
Object.assign(MAIN_TEXT.ru, { audio: 'Аудио', chooseSound: 'Выберите мелодию', privateMsg: '🔥 Приватное сообщение', saveAs: 'Сохранить как', incomingVideoCall: 'Входящий видеозвонок' });
Object.assign(MAIN_TEXT.pl, { audio: 'Audio', chooseSound: 'Wybierz dźwięk', privateMsg: '🔥 Wiadomość prywatna', saveAs: 'Zapisz jako', incomingVideoCall: 'Przychodząca rozmowa wideo' });
Object.assign(MAIN_TEXT.en, { audio: 'Audio', chooseSound: 'Choose a sound', privateMsg: '🔥 Private message', saveAs: 'Save as', incomingVideoCall: 'Incoming video call' });
Object.assign(MAIN_TEXT.uk, { bgTitle: 'Полонина згорнута', bgBody: 'Програма працює далі — значок унизу на панелі завдань. Вийти: меню ⋮ → «Вийти з програми».' });
Object.assign(MAIN_TEXT.ru, { bgTitle: 'Полонина свёрнута', bgBody: 'Программа работает дальше — значок внизу на панели задач. Выйти: меню ⋮ → «Выйти из программы».' });
Object.assign(MAIN_TEXT.pl, { bgTitle: 'Polonyna zminimalizowana', bgBody: 'Program działa dalej — ikona jest na pasku zadań. Zamknięcie: menu ⋮ → „Zamknij program”.' });
Object.assign(MAIN_TEXT.en, { bgTitle: 'Polonyna is minimized', bgBody: 'The app keeps running — its icon stays on the taskbar. To quit: menu ⋮ → “Quit the app”.' });
const TTL_CHOICES = [0, 10, 30, 60, 300, 3600, 86400];
const SOUND_KINDS = ['message', 'ring', 'ringVideo', 'ringback'];

let store = null;
let network = null;
let win = null;
let splash = null;
let tray = null;
let quitting = false;
let activeChatId = null;
let trayHintShown = false;
const avatarRequests = new Map();
const LOG_FILE = () => path.join(app.getPath('userData'), 'polonyna.log');

function tm(key) {
  const lang = (store && store.settings.lang) || 'uk';
  return (MAIN_TEXT[lang] || MAIN_TEXT.uk)[key] || MAIN_TEXT.uk[key] || key;
}

function log(...args) {
  try {
    const file = LOG_FILE();
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + '.old');
    const line = new Date().toISOString() + ' ' + args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
    fs.appendFileSync(file, line);
  } catch {
    /* журнал не критичний */
  }
}

process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

// ---------- допоміжне ----------

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}
function osName() {
  return process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
}
function isInside(file, dir) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
async function moveFile(src, dest) {
  try {
    await fs.promises.rename(src, dest);
  } catch {
    await fs.promises.copyFile(src, dest);
    await fs.promises.rm(src, { force: true });
  }
}
function sanitizeWave(w) {
  if (!Array.isArray(w)) return null;
  return w.slice(0, 96).map((x) => num(x, 0, 31) | 0);
}
function sanitizeFileName(name) {
  return str(name, 160).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
}
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', m4a: 'audio/mp4', mp3: 'audio/mpeg',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
function guessMime(file) {
  return MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
}
function extFromMime(mime, kind) {
  const m = String(mime || '');
  if (m.includes('webm')) return '.webm';
  if (m.includes('mp4')) return kind === 'AUDIO' ? '.m4a' : '.mp4';
  if (m.includes('ogg')) return '.ogg';
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg')) return '.jpg';
  if (m.includes('gif')) return '.gif';
  if (m.includes('webp')) return '.webp';
  return kind === 'PHOTO' ? '.jpg' : kind === 'VIDEO' ? '.mp4' : kind === 'AUDIO' ? '.m4a' : '.bin';
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- профіль та налаштування за замовчуванням ----------

function defaults() {
  let user = '';
  try {
    user = os.userInfo().username || '';
  } catch {
    user = '';
  }
  const host = (os.hostname() || 'PC').slice(0, 40);
  const nick = (user || host).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24) || 'user' + Math.floor(1000 + Math.random() * 9000);
  return {
    profile: {
      id: crypto.randomUUID(),
      name: (user || host).slice(0, 40),
      username: nick,
      deviceName: host,
      deviceType: 'computer',
      avatarHash: '',
      avatarFile: '',
    },
    settings: {
      lang: 'uk',
      networkEnabled: true,
      notifications: true,
      sound: true,
      minimizeToTray: true,
      mediaDir: '',
      manualHosts: [],
      sounds: { message: null, ring: null, ringVideo: null, ringback: null },
      devices: { audio: '', video: '' },
    },
  };
}

function identity() {
  const p = store.profile;
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    deviceName: p.deviceName,
    deviceType: p.deviceType || 'computer',
    os: osName(),
    avatar: p.avatarHash || '',
  };
}

// ---------- контакти та чати ----------

function upsertContact(id, info) {
  if (!SAFE_ID.test(String(id)) || id === store.profile.id) return null;
  let c = store.contacts[id];
  const created = !c;
  if (!c) c = store.contacts[id] = { id, createdAt: Date.now(), name: '', saved: false };
  for (const k of ['name', 'username', 'deviceName', 'deviceType', 'os', 'address']) {
    if (info && info[k]) c[k] = info[k];
  }
  if (info && info.port) c.port = info.port;
  if (info && info.lastSeen) c.lastSeen = info.lastSeen;
  if (!c.name) c.name = tm('device');
  store.scheduleSave();
  if (created) send('contact', c);
  return c;
}

function ensureDirectChat(peerId) {
  if (!SAFE_ID.test(String(peerId))) return null;
  let chat = store.chats[peerId];
  if (!chat) {
    chat = store.chats[peerId] = { id: peerId, type: 'direct', unread: 0, updatedAt: Date.now(), lastMessage: null };
    store.scheduleSave();
  }
  const c = store.contacts[peerId] || upsertContact(peerId, {});
  if (c && !c.saved) {
    c.saved = true;
    send('contact', c);
  }
  send('chat', chat);
  return chat;
}

function requestAvatar(peerId, hash) {
  const prev = avatarRequests.get(peerId);
  if (prev && prev.hash === hash && Date.now() - prev.at < 15000) return;
  avatarRequests.set(peerId, { hash, at: Date.now() });
  network.send(peerId, { type: 'profile_request' }).then((ok) => {
    if (!ok) avatarRequests.delete(peerId);
  });
}

/** Звірка кожні кілька секунд: якщо в когось змінилося фото, а до нас ще не дійшло — запитуємо ще раз. */
function syncProfiles() {
  if (!network || !network.running) return;
  for (const p of network.listPeers()) {
    if (!p.online) continue;
    const c = store.contacts[p.id];
    if (!c || (p.avatar || '') === (c.avatarHash || '')) continue;
    if (p.avatar) requestAvatar(p.id, p.avatar);
    else {
      c.avatarHash = '';
      c.avatarFile = '';
      store.scheduleSave();
      send('contact', c);
    }
  }
}

/** Свої зміни (фото, ім'я) одразу надсилаємо всім, хто в мережі, — не чекаємо запитів. */
function broadcastProfile() {
  if (!network || !network.running) return;
  for (const p of network.listPeers()) if (p.online) sendProfile(p.id);
}

function onPeer(peer) {
  const c = upsertContact(peer.id, peer);
  if (!c) return;
  if (peer.avatar && peer.avatar !== c.avatarHash) requestAvatar(peer.id, peer.avatar);
  if (!peer.avatar && c.avatarHash) {
    c.avatarHash = '';
    c.avatarFile = '';
  }
  send('peer', peer);
  send('contact', c);
  if (peer.online) processOutbox();
  else {
    // широкомовні повідомлення «Локальний Wi-Fi» тим, хто пішов, уже не відправляємо
    const before = store.outbox.length;
    store.outbox = store.outbox.filter((j) => !(j.oneShot && j.targetId === peer.id));
    if (store.outbox.length !== before) refreshAllStatuses();
    else refreshStatusesForTarget(peer.id);
  }
}

// ---------- відправка: черга доставки ----------

function chatTargets(chat) {
  const me = store.profile.id;
  if (chat.type === 'direct') return [chat.id];
  if (chat.type === 'group') return (chat.members || []).map((m) => m.id).filter((id) => id !== me);
  return network ? network.listPeers().filter((p) => p.online).map((p) => p.id) : [];
}

function messageHeader(msg) {
  const chat = store.chats[msg.chatId];
  const h = {
    type: 'message',
    messageId: msg.id,
    chatType: chat ? chat.type : 'direct',
    messageKind: msg.kind,
    text: msg.text || '',
    mimeType: msg.file ? msg.file.mime : '',
    fileName: msg.file ? msg.file.name : '',
    fileSize: msg.file ? msg.file.size : 0,
    duration: msg.duration || 0,
    waveform: msg.waveform || null,
    timestamp: msg.timestamp,
    forwarded: !!msg.forwarded,
    system: msg.system || null,
    ttl: msg.ttl || 0,
  };
  if (chat && chat.type !== 'direct') h.chatId = chat.id;
  if (chat && chat.type === 'group') {
    h.group = {
      id: chat.id,
      title: chat.title,
      members: (chat.members || []).map((m) => ({ id: m.id, name: m.id === store.profile.id ? store.profile.name : (store.contacts[m.id] || m).name || m.name || '' })),
    };
  }
  return h;
}

function computeStatus(msg) {
  if (!msg.outgoing || msg.kind === 'CALL') return msg.status;
  if (msg.status === 'read') return 'read';
  const jobs = store.outbox.filter((j) => j.messageId === msg.id);
  const chat = store.chats[msg.chatId];
  if (chat && chat.type === 'direct') {
    if (!jobs.length) return msg.delivered > 0 ? 'delivered' : 'failed';
    const job = jobs[0];
    return job.failures >= 2 && network.isOnline(job.targetId) ? 'failed' : 'pending';
  }
  if (!jobs.length) return msg.delivered > 0 ? 'delivered' : msg.targets === 0 ? 'sent' : 'failed';
  return msg.delivered > 0 ? 'sent' : 'pending';
}

function refreshStatus(chatId, messageId) {
  const msg = store.findMessage(chatId, messageId);
  if (!msg) return;
  const status = computeStatus(msg);
  if (status !== msg.status) {
    store.updateMessage(chatId, messageId, { status });
    send('message:update', { chatId, message: msg });
    const chat = store.chats[chatId];
    if (chat) send('chat', chat);
  }
}

function refreshStatusesForTarget(targetId) {
  for (const j of store.outbox.filter((x) => x.targetId === targetId)) refreshStatus(j.chatId, j.messageId);
}

function refreshAllStatuses() {
  const seen = new Set();
  for (const chat of Object.values(store.chats)) {
    for (const m of store.getMessages(chat.id)) {
      if (m.outgoing && (m.status === 'pending' || m.status === 'sent') && !seen.has(m.id)) {
        seen.add(m.id);
        refreshStatus(chat.id, m.id);
      }
    }
  }
}

const targetBusy = new Set();
function processOutbox() {
  if (!network || !network.running) return;
  const now = Date.now();
  // задачі, старші за 7 днів, прибираємо
  const expired = store.outbox.filter((j) => now - j.createdAt > 7 * 24 * 3600 * 1000);
  if (expired.length) {
    store.outbox = store.outbox.filter((j) => !expired.includes(j));
    for (const j of expired) refreshStatus(j.chatId, j.messageId);
  }
  const targets = new Set(store.outbox.map((j) => j.targetId));
  for (const t of targets) {
    if (!targetBusy.has(t) && network.isOnline(t)) runTarget(t);
  }
}

async function runTarget(targetId) {
  targetBusy.add(targetId);
  try {
    for (;;) {
      const job = store.outbox.find((j) => j.targetId === targetId && !(j.nextTry && j.nextTry > Date.now()));
      if (!job || !network.isOnline(targetId)) break;
      if (job.kind === 'delete') {
        // «Видалити у всіх»: просимо співрозмовника стерти повідомлення
        const okDel = await network.send(targetId, { type: 'delete', messageIds: [job.messageId], chatType: job.chatType, chatId: job.chatType === 'direct' ? undefined : job.chatId });
        if (okDel) store.outbox = store.outbox.filter((j) => j !== job);
        else {
          job.failures = (job.failures || 0) + 1;
          job.nextTry = Date.now() + Math.min(60000, 3000 * job.failures);
        }
        store.scheduleSave();
        if (!okDel) break;
        continue;
      }
      const msg = store.findMessage(job.chatId, job.messageId);
      if (!msg) {
        store.outbox = store.outbox.filter((j) => j !== job);
        continue;
      }
      if (msg.file && !fs.existsSync(msg.file.path)) {
        store.outbox = store.outbox.filter((j) => j !== job);
        refreshStatus(job.chatId, job.messageId);
        continue;
      }
      const ok = await network.send(targetId, messageHeader(msg), msg.file ? msg.file.path : null);
      if (ok) {
        store.outbox = store.outbox.filter((j) => j !== job);
        msg.delivered = (msg.delivered || 0) + 1;
        msg.recipients = [...new Set([...(msg.recipients || []), targetId])];
        store.scheduleSave();
      } else {
        job.failures = (job.failures || 0) + 1;
        job.nextTry = Date.now() + Math.min(60000, 3000 * job.failures);
        if (job.oneShot && job.failures >= 3) store.outbox = store.outbox.filter((j) => j !== job);
        store.scheduleSave();
      }
      refreshStatus(job.chatId, job.messageId);
      if (!ok) break;
    }
  } finally {
    targetBusy.delete(targetId);
  }
}

function createOutgoing(chat, fields) {
  const me = store.profile;
  const msg = {
    id: crypto.randomUUID(),
    chatId: chat.id,
    senderId: me.id,
    senderName: me.name,
    outgoing: true,
    kind: fields.kind,
    text: str(fields.text, 20000),
    file: fields.file || null,
    duration: num(fields.duration, 0, 24 * 3600),
    waveform: sanitizeWave(fields.waveform),
    timestamp: Date.now(),
    status: 'pending',
    forwarded: !!fields.forwarded,
    system: fields.system || null,
    ttl: chat.type === 'direct' ? num(fields.ttl, 0, 7 * 86400) : 0,
    private: chat.type === 'direct' && num(fields.ttl, 0, 7 * 86400) > 0,
    targets: 0,
    delivered: 0,
  };
  const targets = chatTargets(chat);
  msg.targets = targets.length;
  store.addMessage(msg);
  for (const t of targets) {
    store.outbox.push({ messageId: msg.id, chatId: chat.id, targetId: t, createdAt: Date.now(), failures: 0, oneShot: chat.type === 'lan' });
  }
  msg.status = computeStatus(msg);
  if (!targets.length) msg.status = chat.type === 'lan' ? 'sent' : 'failed';
  store.updateMessage(chat.id, msg.id, { status: msg.status });
  send('chat', chat);
  processOutbox();
  return msg;
}

async function prepareFile(filePath, kind, mime, isPrivate) {
  const src = path.resolve(String(filePath));
  const st = await fs.promises.stat(src);
  if (!st.isFile()) throw new Error('notFile');
  if (st.size > MAX_FILE) throw new Error('tooLarge');
  let dest = src;
  if (isPrivate) {
    // приватні файли — не в «Документи», а в закриту папку програми; після зникнення видаляються
    dest = path.join(store.privateDir, crypto.randomUUID() + path.extname(src).slice(0, 10));
    if (isInside(src, store.settings.mediaDir) && /^(voice|video|image) /.test(path.basename(src))) await moveFile(src, dest);
    else await fs.promises.copyFile(src, dest);
  } else if (!isInside(src, store.settings.mediaDir)) {
    dest = store.uniqueMediaPath(kind === 'TEXT' ? 'FILE' : kind, path.basename(src));
    await fs.promises.copyFile(src, dest);
  }
  return { path: dest, name: isPrivate ? path.basename(src) : path.basename(dest), size: st.size, mime: str(mime, 100) || guessMime(dest), private: !!isPrivate };
}

// ---------- прийом ----------

function sendReadReceipt(chatId, ids) {
  if (!ids.length) return;
  const chat = store.chats[chatId];
  if (!chat || chat.type !== 'direct') return;
  network.send(chatId, { type: 'receipt', status: 'read', messageIds: ids.slice(-500) });
}

function markRead(chatId) {
  const chat = store.chats[chatId];
  if (!chat) return;
  const ids = [];
  for (const m of store.getMessages(chatId)) {
    if (!m.outgoing && !m.readSent && m.kind !== 'CALL') {
      m.readSent = true;
      ids.push(m.id);
    }
  }
  if (chat.unread || ids.length) {
    chat.unread = 0;
    store.dirtyChats.add(chatId);
    store.scheduleSave();
    send('chat', chat);
  }
  sendReadReceipt(chatId, ids);
  updateBadge();
}

function previewText(msg) {
  if (msg.private) return tm('privateMsg');
  switch (msg.kind) {
    case 'PHOTO':
      return msg.text ? `${tm('photo')} · ${msg.text}` : tm('photo');
    case 'AUDIO':
      return tm('voice');
    case 'VIDEO':
      return tm('video');
    case 'FILE':
      return `${tm('file')} ${msg.file ? msg.file.name : ''}`;
    case 'SYSTEM':
      return msg.system && msg.system.title ? `${msg.senderName} ${tm('sysGroup')} «${msg.system.title}»` : '';
    default:
      return msg.text || '';
  }
}

function chatTitle(chat) {
  if (chat.type === 'lan') return tm('lan');
  if (chat.type === 'group') return chat.title || tm('group');
  const c = store.contacts[chat.id];
  return (c && c.name) || tm('device');
}

function notifyIncoming(chat, msg) {
  if (!store.settings.notifications || chat.muted) return;
  const visible = win && win.isVisible() && !win.isMinimized();
  const focused = visible && win.isFocused();
  if (focused && activeChatId === chat.id) return;
  const title = chatTitle(chat);
  const body = (chat.type !== 'direct' ? `${msg.senderName}: ` : '') + previewText(msg);
  send('notify', { chatId: chat.id, title, body, sound: !!store.settings.sound, toast: focused });
  if (!focused) {
    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title, body: body.slice(0, 180), icon: ICON_PATH, silent: true });
        n.on('click', () => {
          showWindow();
          send('open-chat', chat.id);
        });
        n.show();
      }
    } catch (e) {
      log('notification failed', e);
    }
    if (win) win.flashFrame(true);
  }
}

function updateBadge() {
  if (!win || win.isDestroyed()) return;
  const total = Object.values(store.chats).reduce((s, c) => s + (c.unread || 0), 0);
  win.setTitle(total ? `(${total}) Полонина` : 'Полонина');
  if (tray) tray.setToolTip(total ? `Полонина — ${total}` : 'Полонина');
}

async function onFrame(h, tmpPath, remoteAddress) {
  const senderId = h.senderId;
  if (senderId === store.profile.id) return false;
  switch (h.type) {
    case 'hello': {
      if (remoteAddress) {
        network.manualHosts.add(remoteAddress);
        const hosts = new Set(store.settings.manualHosts || []);
        hosts.add(remoteAddress);
        store.settings.manualHosts = [...hosts].slice(-20);
        store.scheduleSave();
        network.sendBeacon(true, remoteAddress);
      }
      return true;
    }
    case 'message':
      return onMessageFrame(h, tmpPath);
    case 'receipt': {
      const ids = Array.isArray(h.messageIds) ? h.messageIds.slice(0, 1000) : [];
      for (const id of ids) {
        const msg = store.findMessage(senderId, String(id));
        if (msg && msg.outgoing && msg.status !== 'read') {
          store.outbox = store.outbox.filter((j) => j.messageId !== msg.id);
          msg.delivered = Math.max(1, msg.delivered || 0);
          store.updateMessage(senderId, msg.id, { status: 'read' });
          send('message:update', { chatId: senderId, message: msg });
        }
      }
      const chat = store.chats[senderId];
      if (chat) send('chat', chat);
      return true;
    }
    case 'ping':
      return true;
    case 'opened': {
      const ids = Array.isArray(h.messageIds) ? h.messageIds.slice(0, 200) : [];
      for (const id of ids) {
        const msg = store.findMessage(senderId, String(id));
        if (msg && msg.outgoing && msg.private && !msg.expiresAt) {
          const now = Date.now();
          store.updateMessage(senderId, msg.id, { openedAt: now, expiresAt: now + (msg.ttl || 10) * 1000, status: 'read' });
          send('message:update', { chatId: senderId, message: msg });
        }
      }
      if (store.chats[senderId]) send('chat', store.chats[senderId]);
      return true;
    }
    case 'delete': {
      const type = h.chatType === 'group' || h.chatType === 'lan' ? h.chatType : 'direct';
      const chatId = type === 'direct' ? senderId : type === 'lan' ? 'lan' : String(h.chatId || '');
      if (!store.chats[chatId]) return true;
      for (const id of (Array.isArray(h.messageIds) ? h.messageIds : []).slice(0, 200)) {
        const msg = store.findMessage(chatId, String(id));
        if (!msg) continue;
        if (type !== 'direct' && msg.senderId !== senderId) continue; // у групах кожен видаляє лише своє
        const file = msg.file && !msg.outgoing ? msg.file.path : null;
        deleteMessageFully(chatId, msg);
        if (file && !fileInUse(file)) fs.rm(file, { force: true }, () => {});
      }
      return true;
    }
    case 'profile_request': {
      setTimeout(() => sendProfile(senderId), 50);
      return true;
    }
    case 'profile':
      return onProfileFrame(h, tmpPath);
    case 'call_offer':
    case 'call_answer':
    case 'call_reject':
    case 'call_busy':
    case 'call_end':
    case 'call_cancel': {
      const data = { type: h.type, callId: str(h.callId, 64), sdp: str(h.sdp, 60000), reason: str(h.reason, 32), video: !!h.video };
      if (h.type === 'call_offer') {
        upsertContact(senderId, { name: str(h.senderName, 64) });
        if (!win || win.isDestroyed()) return false;
        showWindow();
        if (store.settings.notifications && !win.isFocused()) {
          try {
            const c = store.contacts[senderId];
            const n = new Notification({ title: h.video ? tm('incomingVideoCall') : tm('incomingCall'), body: (c && c.name) || str(h.senderName, 64), icon: ICON_PATH, silent: true });
            n.on('click', showWindow);
            n.show();
          } catch {
            /* ignore */
          }
        }
      }
      send('call:signal', { peerId: senderId, peerName: str(h.senderName, 64), data });
      return true;
    }
    default:
      return false;
  }
}

async function onMessageFrame(h, tmpPath) {
  const senderId = h.senderId;
  const contact = upsertContact(senderId, { name: str(h.senderName, 64) });
  if (!contact) return false;
  const chatType = h.chatType === 'group' || h.chatType === 'lan' ? h.chatType : 'direct';
  let chat;
  if (chatType === 'direct') {
    chat = ensureDirectChat(senderId);
  } else if (chatType === 'lan') {
    chat = store.chats.lan;
  } else {
    const gid = String(h.chatId || '');
    if (!SAFE_ID.test(gid) || gid === 'lan') return false;
    const g = h.group && typeof h.group === 'object' ? h.group : {};
    chat = store.chats[gid];
    if (!chat) {
      chat = store.chats[gid] = { id: gid, type: 'group', title: str(g.title, 64) || tm('group'), members: [], unread: 0, updatedAt: Date.now(), lastMessage: null, createdBy: senderId };
    }
    if (g.title) chat.title = str(g.title, 64);
    if (Array.isArray(g.members)) {
      chat.members = g.members
        .filter((m) => m && SAFE_ID.test(String(m.id)))
        .slice(0, 200)
        .map((m) => ({ id: String(m.id), name: str(m.name, 64) }));
      for (const m of chat.members) {
        if (m.id !== store.profile.id && !store.contacts[m.id]) upsertContact(m.id, { name: m.name });
      }
    }
  }
  const id = String(h.messageId || '');
  if (!SAFE_ID.test(id)) return false;
  if (store.hasMessage(chat.id, id)) return true; // повтор — уже маємо
  const kind = KINDS.includes(h.messageKind) && h.messageKind !== 'CALL' ? h.messageKind : 'TEXT';
  const ttl = chatType === 'direct' ? num(h.ttl, 0, 7 * 86400) : 0;
  let file = null;
  if (tmpPath) {
    const name = sanitizeFileName(h.fileName) || `${stamp()}${extFromMime(h.mimeType, kind)}`;
    const dest = ttl
      ? path.join(store.privateDir, crypto.randomUUID() + (path.extname(name).slice(0, 10) || extFromMime(h.mimeType, kind)))
      : store.uniqueMediaPath(['PHOTO', 'AUDIO', 'VIDEO'].includes(kind) ? kind : 'FILE', name);
    await moveFile(tmpPath, dest);
    const st = await fs.promises.stat(dest);
    file = { path: dest, name: ttl ? name : path.basename(dest), size: st.size, mime: str(h.mimeType, 100) || guessMime(dest), private: !!ttl };
  } else if (['PHOTO', 'AUDIO', 'VIDEO', 'FILE'].includes(kind)) {
    return false;
  }
  const msg = {
    id,
    chatId: chat.id,
    senderId,
    senderName: str(h.senderName, 64) || contact.name,
    outgoing: false,
    kind,
    text: str(h.text, 20000),
    file,
    duration: num(h.duration, 0, 24 * 3600),
    waveform: sanitizeWave(h.waveform),
    timestamp: Date.now(),
    sentAt: num(h.timestamp, 0, 9e15),
    status: 'received',
    forwarded: !!h.forwarded,
    ttl,
    private: ttl > 0,
    system: h.system && typeof h.system === 'object' ? { event: str(h.system.event, 32), title: str(h.system.title, 64) } : null,
  };
  store.addMessage(msg);
  const focusedHere = win && win.isVisible() && win.isFocused() && activeChatId === chat.id;
  if (focusedHere) {
    msg.readSent = true;
    if (chat.type === 'direct') sendReadReceipt(chat.id, [msg.id]);
  } else {
    chat.unread = (chat.unread || 0) + 1;
  }
  store.scheduleSave();
  send('message:new', { chatId: chat.id, message: msg });
  send('chat', chat);
  updateBadge();
  notifyIncoming(chat, msg);
  return true;
}

function sendProfile(peerId) {
  const p = store.profile;
  const file = p.avatarFile && fs.existsSync(p.avatarFile) ? p.avatarFile : null;
  network.send(peerId, { type: 'profile', avatarHash: file ? p.avatarHash : '', name: p.name, username: p.username }, file);
}

async function onProfileFrame(h, tmpPath) {
  const c = upsertContact(h.senderId, { name: str(h.name, 64), username: str(h.username, 40) });
  if (!c) return false;
  const hash = str(h.avatarHash, 40);
  if (tmpPath && /^[a-f0-9]{8,40}$/.test(hash)) {
    const st = await fs.promises.stat(tmpPath);
    if (st.size > 3 * 1024 * 1024) return false;
    const dest = path.join(store.avatarDir, `${h.senderId}-${hash}.jpg`);
    await moveFile(tmpPath, dest);
    if (c.avatarFile && c.avatarFile !== dest) fs.rm(c.avatarFile, { force: true }, () => {});
    c.avatarHash = hash;
    c.avatarFile = dest;
  } else if (!hash) {
    c.avatarHash = '';
    c.avatarFile = '';
  }
  store.scheduleSave();
  send('contact', c);
  return true;
}

// ---------- приватні повідомлення: автоматичне зникнення ----------

function deleteMessageFully(chatId, msg) {
  if (msg.file && (msg.private || msg.file.private)) fs.rm(msg.file.path, { force: true }, () => {});
  if (store.deleteMessage(chatId, msg.id)) {
    send('message:deleted', { chatId, messageId: msg.id });
    if (store.chats[chatId]) send('chat', store.chats[chatId]);
  }
}

function checkExpired() {
  const now = Date.now();
  for (const chatId of Object.keys(store.chats)) {
    const list = store.messages.get(chatId);
    if (!list) continue;
    for (const m of list.filter((x) => x.expiresAt && x.expiresAt <= now)) deleteMessageFully(chatId, m);
  }
}

// ---------- сховище: розміри й очищення ----------

async function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  const walk = async (d) => {
    let entries;
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        try {
          bytes += (await fs.promises.stat(p)).size;
          files += 1;
        } catch {
          /* файл зник */
        }
      }
    }
  };
  await walk(dir);
  return { bytes, files };
}

async function clearDir(dir, keep, minAgeMs) {
  let freed = 0;
  const walk = async (d) => {
    let entries;
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (keep.has(path.resolve(p))) continue;
      try {
        const st = await fs.promises.stat(p);
        if (minAgeMs && Date.now() - st.mtimeMs < minAgeMs) continue;
        await fs.promises.rm(p, { force: true });
        freed += st.size;
      } catch {
        /* файл зайнятий іншою програмою */
      }
    }
  };
  await walk(dir);
  return freed;
}

// службові кеші Chromium (GPUCache тощо) зайняті, поки програма працює, тому їх не рахуємо й не чіпаємо
const CACHE_DIRS = ['Cache', 'Code Cache'];
const STORAGE_CATS = {
  photos: () => [store.mediaDirFor('PHOTO')],
  videos: () => [store.mediaDirFor('VIDEO')],
  voice: () => [store.mediaDirFor('AUDIO')],
  files: () => [store.mediaDirFor('FILE')],
  temp: () => [store.tempDir],
  cache: () => CACHE_DIRS.map((n) => path.join(app.getPath('userData'), n)),
};

async function storageStats() {
  const cats = {};
  for (const [k, fn] of Object.entries(STORAGE_CATS)) {
    let bytes = 0;
    let files = 0;
    for (const d of fn()) {
      const r = await dirStats(d);
      bytes += r.bytes;
      files += r.files;
    }
    cats[k] = { bytes, files };
  }
  return { cats, mediaDir: store.settings.mediaDir };
}

async function storageClear(list) {
  const cats = (Array.isArray(list) ? list : []).filter((c) => STORAGE_CATS[c]);
  const keep = new Set();
  for (const j of store.outbox) {
    const m = store.findMessage(j.chatId, j.messageId);
    if (m && m.file) keep.add(path.resolve(m.file.path)); // ще не доставлені файли не чіпаємо
  }
  let freed = 0;
  for (const c of cats) {
    if (c === 'cache') {
      let before = 0;
      for (const d of STORAGE_CATS.cache()) before += (await dirStats(d)).bytes;
      try {
        await session.defaultSession.clearCache();
      } catch {
        /* ignore */
      }
      try {
        await session.defaultSession.clearCodeCaches({});
      } catch {
        /* ignore */
      }
      for (const d of STORAGE_CATS.cache()) await clearDir(d, new Set(), 0);
      let after = 0;
      for (const d of STORAGE_CATS.cache()) after += (await dirStats(d)).bytes;
      freed += Math.max(0, before - after);
    } else {
      for (const d of STORAGE_CATS[c]()) freed += await clearDir(d, keep, c === 'temp' ? 120000 : 0);
    }
  }
  const changed = new Set();
  for (const chatId of Object.keys(store.chats)) {
    for (const m of store.getMessages(chatId)) {
      if (m.file && !m.file.deleted && !m.private && !fs.existsSync(m.file.path)) {
        m.file.deleted = true;
        changed.add(chatId);
        store.dirtyChats.add(chatId);
      }
    }
  }
  store.scheduleSave();
  for (const id of changed) send('messages:refresh', id);
  log('storage cleared', cats, freed);
  return { freed };
}

// ---------- власні мелодії ----------

async function setSound(kind, src) {
  if (!SOUND_KINDS.includes(kind)) return { error: 'kind' };
  const file = path.resolve(String(src || ''));
  const st = await fs.promises.stat(file);
  if (!st.isFile() || st.size > 20 * 1024 * 1024) return { error: 'tooLarge' };
  fs.mkdirSync(store.soundsDir, { recursive: true });
  const dest = path.join(store.soundsDir, `${kind}-${Date.now()}${path.extname(file).toLowerCase().slice(0, 8) || '.mp3'}`);
  await fs.promises.copyFile(file, dest);
  const sounds = Object.assign({ message: null, ring: null, ringVideo: null, ringback: null }, store.settings.sounds || {});
  if (sounds[kind] && sounds[kind].path) fs.rm(sounds[kind].path, { force: true }, () => {});
  sounds[kind] = { path: dest, name: path.basename(file) };
  store.settings.sounds = sounds;
  store.scheduleSave();
  send('settings', store.settings);
  return store.settings;
}

function resetSound(kind) {
  if (!SOUND_KINDS.includes(kind)) return store.settings;
  const sounds = Object.assign({ message: null, ring: null, ringVideo: null, ringback: null }, store.settings.sounds || {});
  if (sounds[kind] && sounds[kind].path) fs.rm(sounds[kind].path, { force: true }, () => {});
  sounds[kind] = null;
  store.settings.sounds = sounds;
  store.scheduleSave();
  send('settings', store.settings);
  return store.settings;
}

// ---------- буфер обміну, «зберегти як» ----------

function fileInUse(p) {
  const target = path.resolve(p);
  for (const chatId of Object.keys(store.chats)) {
    if (store.getMessages(chatId).some((m) => m.file && path.resolve(m.file.path) === target)) return true;
  }
  return false;
}

/** PowerShell (лише Windows): справжнє копіювання файлу в буфер — як «Копіювати» у Провіднику. */
function runPs(script, env) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 15000, windowsHide: true, env: Object.assign({}, process.env, env || {}), encoding: 'utf8' },
      (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

async function psCopyFile(p, isImage) {
  const script = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
    "$d = New-Object System.Windows.Forms.DataObject; $c = New-Object System.Collections.Specialized.StringCollection; " +
    "[void]$c.Add($env:PL_PATH); $d.SetFileDropList($c); " +
    "if ($env:PL_IMAGE -eq '1') { try { $d.SetImage([System.Drawing.Image]::FromFile($env:PL_PATH)) } catch {} }; " +
    "[System.Windows.Forms.Clipboard]::SetDataObject($d, $true); 'ok'";
  const out = await runPs(script, { PL_PATH: p, PL_IMAGE: isImage ? '1' : '0' });
  return !!(out && out.includes('ok'));
}

async function psClipboardFiles() {
  const script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " +
    "foreach ($f in [System.Windows.Forms.Clipboard]::GetFileDropList()) { [Console]::Out.WriteLine($f) }";
  const out = await runPs(script);
  return out ? out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
}

// ---------- вікно, трей ----------

let mainReady = false;
let splashDone = false;

function revealMain() {
  if (!win || win.isDestroyed() || process.argv.includes('--hidden')) return;
  if (!mainReady || (splash && !splashDone)) return;
  if (!win.isVisible()) win.show();
  if (splash && !splash.isDestroyed()) {
    const s = splash;
    setTimeout(() => {
      if (!s.isDestroyed()) s.close();
    }, 120);
  }
}

/** Та сама заставка поверх вікна програми (натискання на логотип). Кліки проходять крізь неї. */
function showSplashOver() {
  if (!win || win.isDestroyed()) return false;
  const b = win.getBounds();
  const w = 640;
  const h = 380;
  const s = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(b.x + (b.width - w) / 2),
    y: Math.round(b.y + (b.height - h) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  s.setIgnoreMouseEvents(true);
  s.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  s.once('ready-to-show', () => {
    s.showInactive();
    setTimeout(() => {
      if (!s.isDestroyed()) s.close();
    }, 3300);
  });
  return true;
}

/** Заставка ~3 с: емблема, хвилі Wi-Fi, «ПОЛОНИНА» друкарською машинкою. */
function createSplash() {
  splash = new BrowserWindow({
    width: 640,
    height: 380,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Полонина',
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  splash.once('ready-to-show', () => {
    splash.show();
    setTimeout(() => {
      splashDone = true;
      revealMain();
    }, 3100);
  });
  splash.on('closed', () => {
    splash = null;
    splashDone = true;
  });
  setTimeout(() => {
    splashDone = true;
    revealMain();
  }, 7000);
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 420,
    minHeight: 600,
    title: 'Полонина',
    icon: ICON_PATH,
    backgroundColor: '#FDFDFD',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    mainReady = true;
    revealMain();
    updateBadge();
  });
  win.on('close', (e) => {
    if (!quitting && store.settings.minimizeToTray) {
      // ✕ не закриває програму: вікно лише згортається, значок лишається внизу на панелі завдань
      e.preventDefault();
      win.minimize();
      log('window: close button → minimized');
      if (!trayHintShown) {
        trayHintShown = true;
        try {
          new Notification({ title: tm('bgTitle'), body: tm('bgBody'), icon: ICON_PATH, silent: true }).show();
        } catch {
          /* ignore */
        }
      }
    }
  });
  win.on('focus', () => {
    win.flashFrame(false);
    send('focus', true);
    if (activeChatId) markRead(activeChatId);
  });
  win.on('blur', () => send('focus', false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('context-menu', (e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push({ role: 'cut', label: tm('cut') }, { role: 'copy', label: tm('copy') }, { role: 'paste', label: tm('paste') }, { type: 'separator' }, { role: 'selectAll', label: tm('selectAll') });
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: tm('copy') });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'emblem-32.png')));
    tray.setToolTip('Полонина');
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    updateTrayMenu();
  } catch (e) {
    tray = null;
    log('tray unavailable', e);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tm('trayOpen'), click: showWindow },
    { type: 'separator' },
    { label: tm('trayQuit'), click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- мережа ----------

async function startNetwork() {
  if (!store.settings.networkEnabled) return;
  for (const h of store.settings.manualHosts || []) network.manualHosts.add(h);
  await network.start();
  log('network started', { tcp: network.tcpPort, udp: DISCOVERY_PORT });
  send('net', netInfo());
}

function stopNetwork() {
  network.stop();
  send('net', netInfo());
}

function netInfo() {
  return {
    running: network.running,
    tcpPort: network.tcpPort,
    udpPort: DISCOVERY_PORT,
    defaultTcpPort: TCP_PORT,
    addresses: network.addresses(),
    peersOnline: network.listPeers().filter((p) => p.online).length,
  };
}

// ---------- IPC ----------

function registerIpc() {
  const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log('ipc error', ch, err);
      return { error: String((err && err.message) || err) };
    }
  });

  handle('state:get', () => ({
    profile: store.profile,
    settings: store.settings,
    contacts: store.contacts,
    chats: store.chats,
    peers: network.listPeers(),
    net: netInfo(),
    version: app.getVersion(),
    platform: process.platform,
    focused: !!(win && win.isFocused()),
  }));

  handle('chat:messages', (chatId) => store.getMessages(String(chatId)));
  handle('chat:open', (chatId) => {
    activeChatId = chatId && store.chats[chatId] ? chatId : null;
    if (activeChatId && win && win.isFocused()) markRead(activeChatId);
    return activeChatId ? store.getMessages(activeChatId) : [];
  });
  handle('chat:close', () => {
    activeChatId = null;
    return true;
  });
  handle('chat:markRead', (chatId) => {
    if (store.chats[chatId]) markRead(chatId);
    return true;
  });
  handle('chat:direct', (peerId) => ensureDirectChat(String(peerId)));
  handle('chat:clear', (chatId) => {
    if (!store.chats[chatId]) return false;
    store.clearChat(chatId);
    send('chat', store.chats[chatId]);
    updateBadge();
    return true;
  });
  handle('chat:delete', (chatId) => {
    if (!store.chats[chatId]) return false;
    store.deleteChat(chatId);
    send('chat:deleted', chatId);
    if (store.chats[chatId]) send('chat', store.chats[chatId]);
    updateBadge();
    return true;
  });
  handle('chat:mute', (chatId, muted) => {
    const chat = store.chats[chatId];
    if (!chat) return false;
    chat.muted = !!muted;
    store.scheduleSave();
    send('chat', chat);
    return true;
  });

  handle('group:create', ({ title, memberIds }) => {
    const name = str(title, 64).trim();
    const ids = (Array.isArray(memberIds) ? memberIds : []).filter((id) => store.contacts[id]).slice(0, 100);
    if (!name || !ids.length) return { error: 'invalid' };
    const me = store.profile;
    const id = crypto.randomUUID();
    const chat = store.chats[id] = {
      id,
      type: 'group',
      title: name,
      members: [{ id: me.id, name: me.name }, ...ids.map((cid) => ({ id: cid, name: store.contacts[cid].name || '' }))],
      unread: 0,
      updatedAt: Date.now(),
      lastMessage: null,
      createdBy: me.id,
    };
    store.scheduleSave();
    send('chat', chat);
    const msg = createOutgoing(chat, { kind: 'SYSTEM', system: { event: 'group_created', title: name } });
    send('message:new', { chatId: chat.id, message: msg });
    return chat;
  });

  handle('msg:send', async (data) => {
    const chat = store.chats[data && data.chatId];
    if (!chat) return { error: 'noChat' };
    const kind = KINDS.includes(data.kind) && !['SYSTEM', 'CALL'].includes(data.kind) ? data.kind : 'TEXT';
    const ttl = chat.type === 'direct' && TTL_CHOICES.includes(Number(data.ttl)) ? Number(data.ttl) : 0;
    let file = null;
    if (kind !== 'TEXT') {
      if (!data.filePath) return { error: 'noFile' };
      file = await prepareFile(data.filePath, kind, data.mime, ttl > 0);
    }
    if (kind === 'TEXT' && !str(data.text, 20000).trim()) return { error: 'empty' };
    return createOutgoing(chat, { kind, text: data.text, file, duration: data.duration, waveform: data.waveform, ttl });
  });

  handle('msg:forward', ({ chatId, messageId, toChatIds }) => {
    const src = store.findMessage(chatId, messageId);
    if (!src || src.private || !['TEXT', 'PHOTO', 'AUDIO', 'VIDEO', 'FILE'].includes(src.kind)) return { error: 'notFound' };
    if (src.file && !fs.existsSync(src.file.path)) return { error: 'fileMissing' };
    const out = [];
    for (const id of (toChatIds || []).slice(0, 20)) {
      const chat = store.chats[id];
      if (!chat) continue;
      const msg = createOutgoing(chat, { kind: src.kind, text: src.text, file: src.file, duration: src.duration, waveform: src.waveform, forwarded: true });
      send('message:new', { chatId: chat.id, message: msg });
      out.push(msg);
    }
    return out;
  });

  handle('msg:retry', ({ chatId, messageId }) => {
    const msg = store.findMessage(chatId, messageId);
    const chat = store.chats[chatId];
    if (!msg || !chat || !msg.outgoing) return false;
    const jobs = store.outbox.filter((j) => j.messageId === msg.id);
    if (jobs.length) {
      for (const j of jobs) {
        j.failures = 0;
        j.nextTry = 0;
      }
    } else {
      for (const t of chatTargets(chat)) store.outbox.push({ messageId: msg.id, chatId, targetId: t, createdAt: Date.now(), failures: 0, oneShot: chat.type === 'lan' });
      msg.targets = Math.max(msg.targets || 0, store.outbox.filter((j) => j.messageId === msg.id).length);
    }
    store.updateMessage(chatId, messageId, { status: 'pending' });
    send('message:update', { chatId, message: msg });
    refreshStatus(chatId, messageId);
    processOutbox();
    return true;
  });

  handle('msg:delete', ({ chatId, messageId }) => {
    const target = store.findMessage(chatId, messageId);
    if (target && target.file && (target.private || target.file.private)) fs.rm(target.file.path, { force: true }, () => {});
    const ok = store.deleteMessage(chatId, messageId);
    if (ok) {
      send('message:deleted', { chatId, messageId });
      send('chat', store.chats[chatId]);
    }
    return ok;
  });

  handle('call:signal', async (peerId, data) => {
    if (!SAFE_ID.test(String(peerId)) || !data || typeof data.type !== 'string') return false;
    return network.send(peerId, {
      type: data.type,
      callId: str(data.callId, 64),
      sdp: str(data.sdp, 60000),
      reason: str(data.reason, 32),
      video: !!data.video,
    });
  });

  handle('call:log', (peerId, info) => {
    const chat = ensureDirectChat(String(peerId));
    if (!chat) return null;
    const me = store.profile;
    const msg = {
      id: crypto.randomUUID(),
      chatId: chat.id,
      senderId: info && info.outgoing ? me.id : chat.id,
      senderName: info && info.outgoing ? me.name : (store.contacts[chat.id] || {}).name || '',
      outgoing: !!(info && info.outgoing),
      kind: 'CALL',
      text: '',
      file: null,
      call: { result: str(info && info.result, 16), duration: num(info && info.duration, 0, 24 * 3600), video: !!(info && info.video) },
      timestamp: Date.now(),
      status: 'read',
      readSent: true,
    };
    store.addMessage(msg);
    if (!msg.outgoing && msg.call.result === 'missed' && activeChatId !== chat.id) chat.unread = (chat.unread || 0) + 1;
    send('message:new', { chatId: chat.id, message: msg });
    send('chat', chat);
    updateBadge();
    return msg;
  });

  handle('media:saveRecording', async ({ kind, mime, bytes }) => {
    const k = kind === 'VIDEO' ? 'VIDEO' : kind === 'PHOTO' ? 'PHOTO' : 'AUDIO';
    const prefix = k === 'VIDEO' ? 'video' : k === 'PHOTO' ? 'image' : 'voice';
    const dest = store.uniqueMediaPath(k, `${prefix} ${stamp()}${extFromMime(mime, k)}`);
    await fs.promises.writeFile(dest, Buffer.from(bytes));
    return dest;
  });

  handle('dialog:pickFiles', async (mode) => {
    // «Усі файли» — першими, тож вибрані за замовчуванням
    const filters = [{ name: tm('allFiles'), extensions: ['*'] }, { name: tm('images'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'] }];
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
    return r.canceled ? [] : r.filePaths.slice(0, 20);
  });

  handle('dialog:pickAvatar', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: tm('chooseAvatar'),
      properties: ['openFile'],
      filters: [{ name: tm('images'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('profile:update', (patch) => {
    const p = store.profile;
    if (patch && typeof patch === 'object') {
      if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 40);
      if (typeof patch.username === 'string') p.username = patch.username.trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_.]/g, '').slice(0, 24);
      if (typeof patch.deviceName === 'string' && patch.deviceName.trim()) p.deviceName = patch.deviceName.trim().slice(0, 40);
      if (['computer', 'laptop', 'tablet', 'phone'].includes(patch.deviceType)) p.deviceType = patch.deviceType;
    }
    store.scheduleSave();
    network.sendBeacon(false);
    broadcastProfile();
    send('profile', p);
    return p;
  });

  handle('profile:setAvatar', async (bytes) => {
    const p = store.profile;
    if (!bytes) {
      if (p.avatarFile) fs.rm(p.avatarFile, { force: true }, () => {});
      p.avatarFile = '';
      p.avatarHash = '';
    } else {
      const buf = Buffer.from(bytes);
      if (buf.length > 3 * 1024 * 1024) return { error: 'tooLarge' };
      const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
      const dest = path.join(store.avatarDir, `me-${hash}.jpg`);
      await fs.promises.writeFile(dest, buf);
      if (p.avatarFile && p.avatarFile !== dest) fs.rm(p.avatarFile, { force: true }, () => {});
      p.avatarFile = dest;
      p.avatarHash = hash;
    }
    store.scheduleSave();
    network.sendBeacon(false);
    broadcastProfile();
    send('profile', p);
    return p;
  });

  handle('settings:update', async (patch) => {
    const s = store.settings;
    const prevNet = s.networkEnabled;
    if (patch && typeof patch === 'object') {
      if (['uk', 'ru', 'pl', 'en'].includes(patch.lang)) s.lang = patch.lang;
      for (const k of ['networkEnabled', 'notifications', 'sound', 'minimizeToTray']) {
        if (typeof patch[k] === 'boolean') s[k] = patch[k];
      }
      if (patch.devices && typeof patch.devices === 'object') s.devices = { audio: str(patch.devices.audio, 400), video: str(patch.devices.video, 400) };
    }
    store.scheduleSave();
    updateTrayMenu();
    if (prevNet !== s.networkEnabled) {
      if (s.networkEnabled) await startNetwork();
      else stopNetwork();
    }
    send('settings', s);
    return s;
  });

  handle('settings:chooseMediaDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: tm('chooseFolder'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.settings.mediaDir = r.filePaths[0];
    store.ensureMediaDirs();
    store.scheduleSave();
    send('settings', store.settings);
    return store.settings.mediaDir;
  });

  handle('shell:openPath', async (p) => {
    if (typeof p !== 'string' || !fs.existsSync(p)) return 'missing';
    return shell.openPath(p);
  });
  handle('shell:showItem', (p) => {
    if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p);
    return true;
  });
  handle('shell:openMediaDir', () => {
    store.ensureMediaDirs();
    return shell.openPath(store.settings.mediaDir);
  });
  handle('shell:openLog', () => shell.showItemInFolder(LOG_FILE()));

  handle('net:info', () => netInfo());
  handle('net:refresh', () => {
    network.refresh();
    return true;
  });
  handle('net:connect', async (text) => {
    const r = await network.connectManual(text);
    if (r.ok) {
      const hosts = new Set(store.settings.manualHosts || []);
      hosts.add(r.host);
      store.settings.manualHosts = [...hosts].slice(-20);
      store.scheduleSave();
    }
    return r;
  });

  handle('files:stat', async (paths) => {
    const out = [];
    for (const p of (Array.isArray(paths) ? paths : []).slice(0, 20)) {
      try {
        const st = await fs.promises.stat(String(p));
        if (st.isFile()) out.push({ path: String(p), name: path.basename(String(p)), size: st.size });
      } catch {
        /* пропускаємо */
      }
    }
    return out;
  });
  handle('media:discard', async (p) => {
    if (typeof p === 'string' && isInside(p, store.settings.mediaDir)) await fs.promises.rm(p, { force: true });
    return true;
  });
  handle('msg:openPrivate', (chatId, messageId) => {
    const msg = store.findMessage(chatId, messageId);
    if (!msg || !msg.private || msg.outgoing) return null;
    if (!msg.openedAt) {
      const now = Date.now();
      store.updateMessage(chatId, messageId, { openedAt: now, expiresAt: now + (msg.ttl || 10) * 1000 });
      network.send(chatId, { type: 'opened', messageIds: [messageId] });
    }
    return msg;
  });
  handle('chat:setTtl', (chatId, ttl) => {
    const chat = store.chats[chatId];
    if (!chat || chat.type !== 'direct') return null;
    chat.ttl = TTL_CHOICES.includes(Number(ttl)) ? Number(ttl) : 0;
    store.scheduleSave();
    send('chat', chat);
    return chat;
  });
  handle('win:protect', (on) => {
    if (win && !win.isDestroyed()) win.setContentProtection(!!on);
    return true;
  });
  handle('storage:stats', () => storageStats());
  handle('storage:clear', (cats) => storageClear(cats));
  handle('sound:pick', async (kind) => {
    const r = await dialog.showOpenDialog(win, {
      title: tm('chooseSound'),
      defaultPath: store.mediaDirFor('AUDIO'),
      properties: ['openFile'],
      filters: [{ name: tm('audio'), extensions: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm'] }, { name: tm('allFiles'), extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return setSound(kind, r.filePaths[0]);
  });
  handle('sound:set', (kind, p) => setSound(kind, p));
  handle('sound:reset', (kind) => resetSound(kind));
  handle('net:check', async () => {
    await Promise.all(network.listPeers().filter((p) => p.online).map((p) => network.ping(p.id)));
    return { net: netInfo(), peers: network.listPeers() };
  });

  handle('msg:deleteAll', ({ chatId, messageId }) => {
    const chat = store.chats[chatId];
    const msg = store.findMessage(chatId, messageId);
    if (!chat || !msg || ['CALL', 'SYSTEM'].includes(msg.kind)) return { error: 'notFound' };
    if (chat.type !== 'direct' && !msg.outgoing) return { error: 'notAllowed' };
    const delivered = chat.type === 'direct' ? (msg.outgoing ? (msg.delivered || 0) > 0 || ['delivered', 'read'].includes(msg.status) : true) : true;
    const targets = chat.type === 'direct' ? (delivered ? [chat.id] : []) : (msg.recipients || []);
    // що ще не пішло — просто знімаємо з черги
    store.outbox = store.outbox.filter((j) => !(j.messageId === msg.id && j.kind !== 'delete'));
    for (const t of targets) {
      store.outbox.push({ kind: 'delete', messageId: msg.id, chatId: chat.id, chatType: chat.type, targetId: t, createdAt: Date.now(), failures: 0 });
    }
    deleteMessageFully(chatId, msg);
    store.scheduleSave();
    processOutbox();
    return { ok: true, targets: targets.length };
  });
  handle('clip:copyFile', async (p, isImage) => {
    if (typeof p !== 'string' || !fs.existsSync(p)) return false;
    if (await psCopyFile(p, !!isImage)) return true;
    if (isImage) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        clipboard.writeImage(img);
        return true;
      }
    }
    clipboard.writeText(p);
    return true;
  });
  handle('clip:read', async () => {
    let files = await psClipboardFiles();
    if (!files.length) {
      try {
        const b = clipboard.readBuffer('FileNameW');
        const p = b && b.length ? b.toString('ucs2').replace(/\u0000[\s\S]*$/, '') : '';
        if (p) files = [p];
      } catch {
        /* немає файлу в буфері */
      }
    }
    files = files.filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (files.length) return { files: files.slice(0, 20) };
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      const dest = store.uniqueMediaPath('PHOTO', `image ${stamp()}.png`);
      await fs.promises.writeFile(dest, img.toPNG());
      return { image: dest };
    }
    return { text: clipboard.readText() || '' };
  });
  handle('file:saveAs', async (p, name, target) => {
    if (typeof p !== 'string' || !fs.existsSync(p)) return { error: 'missing' };
    let dest = !app.isPackaged && typeof target === 'string' && target ? target : null; // target — лише для автотесту
    if (!dest) {
      const r = await dialog.showSaveDialog(win, { title: tm('saveAs'), defaultPath: path.join(app.getPath('downloads'), sanitizeFileName(name) || path.basename(p)) });
      if (r.canceled || !r.filePath) return { canceled: true };
      dest = r.filePath;
    }
    await fs.promises.copyFile(p, dest);
    return { ok: true, path: dest };
  });
  handle('sys:openSettings', (which) => {
    const map = { camera: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone', sound: 'ms-settings:sound' };
    if (process.platform === 'win32' && map[which]) return shell.openExternal(map[which]);
    return false;
  });

  handle('splash:show', () => showSplashOver());
  handle('app:quit', () => {
    quitting = true;
    app.quit();
    return true;
  });

  handle('qr:make', (text) => QRCode.toDataURL(String(text).slice(0, 500), { margin: 1, width: 320, color: { dark: '#0A1D3F', light: '#FFFFFF' } }));
  handle('win:focused', () => !!(win && win.isFocused()));
}

// ---------- запуск ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);
    Menu.setApplicationMenu(null);
    const docs = app.getPath('documents');
    store = new Store({
      dataDir: app.getPath('userData'),
      defaultMediaDir: path.join(docs, PROFILE ? `Полонина-${PROFILE}` : 'Полонина'),
      defaults: defaults(),
    });
    network = new Network({ identity, tempDir: store.tempDir, onFrame });
    network.on('peer', onPeer);
    network.on('warning', (where, err) => log('network warning', where, err));

    const allowed = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.includes(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.includes(permission));

    registerIpc();
    for (const id of Object.keys(store.chats)) store.getMessages(id);
    checkExpired();
    if (!process.argv.includes('--hidden')) createSplash();
    createWindow();
    createTray();
    // якщо сторінка інтерфейсу аварійно впала — перезапускаємо її, програма не зникає
    app.on('render-process-gone', (_e, wc, details) => {
      log('render-process-gone', details);
      if (win && !win.isDestroyed() && wc === win.webContents && details.reason !== 'clean-exit') {
        setTimeout(() => {
          if (win && !win.isDestroyed()) win.reload();
        }, 800);
      }
    });
    app.on('child-process-gone', (_e, details) => log('child-process-gone', details));
    win.webContents.on('unresponsive', () => log('window unresponsive'));
    win.on('hide', () => log('window hidden'));
    await startNetwork();
    setInterval(processOutbox, 5000);
    setInterval(checkExpired, 1000);
    setInterval(syncProfiles, 6000);

    if (!app.isPackaged) {
      const st = process.argv.find((a) => a.startsWith('--selftest='));
      if (st) {
        try {
          require(path.resolve(st.slice(11)))({ app, win, store, network, send, createOutgoing, ensureDirectChat, getSplash: () => splash });
        } catch (e) {
          console.error('selftest failed', e);
        }
      }
    }
  });

  app.on('before-quit', () => {
    log('app quitting');
    quitting = true;
    try {
      network && network.stop();
    } catch {
      /* ignore */
    }
    store && store.flush();
  });

  app.on('window-all-closed', () => app.quit());
}
