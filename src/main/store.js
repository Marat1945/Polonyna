'use strict';
// Зберігання даних Полонини: профіль, налаштування, контакти, чати, повідомлення, черга відправки.
// Формат — прості JSON-файли в папці даних програми (AppData\Roaming\Polonyna).
// Медіафайли (фото, відео, голосові, файли) лежать у Документи\Полонина.

const fs = require('fs');
const path = require('path');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_SUBDIRS = { PHOTO: 'Фото', VIDEO: 'Відео', AUDIO: 'Голосові', FILE: 'Файли' };

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function summary(msg) {
  if (!msg) return null;
  return {
    id: msg.id,
    kind: msg.kind,
    text: (msg.text || '').slice(0, 200),
    senderId: msg.senderId,
    senderName: msg.senderName,
    outgoing: !!msg.outgoing,
    status: msg.status,
    timestamp: msg.timestamp,
    duration: msg.duration || 0,
    fileName: msg.file ? msg.file.name : '',
    call: msg.call || null,
    private: !!msg.private,
  };
}

class Store {
  constructor({ dataDir, defaultMediaDir, defaults }) {
    this.dataDir = dataDir;
    this.msgDir = path.join(dataDir, 'messages');
    this.avatarDir = path.join(dataDir, 'avatars');
    this.tempDir = path.join(dataDir, 'tmp');
    this.privateDir = path.join(dataDir, 'private');
    this.soundsDir = path.join(dataDir, 'sounds');
    for (const d of [this.dataDir, this.msgDir, this.avatarDir, this.tempDir, this.privateDir, this.soundsDir]) fs.mkdirSync(d, { recursive: true });
    // незавершені прийоми файлів з минулого запуску
    for (const f of fs.readdirSync(this.tempDir)) fs.rmSync(path.join(this.tempDir, f), { force: true, recursive: true });

    this.file = path.join(dataDir, 'state.json');
    const s = readJson(this.file, {});
    this.profile = Object.assign({}, defaults.profile, s.profile || {});
    this.settings = Object.assign({}, defaults.settings, s.settings || {});
    if (!this.settings.mediaDir) this.settings.mediaDir = defaultMediaDir;
    this.contacts = s.contacts || {};
    this.chats = s.chats || {};
    this.outbox = Array.isArray(s.outbox) ? s.outbox : [];
    if (!this.chats.lan) {
      this.chats.lan = { id: 'lan', type: 'lan', pinned: true, unread: 0, updatedAt: 0, lastMessage: null };
    }
    this.messages = new Map();
    this.dirtyChats = new Set();
    this.saveTimer = null;
    this.ensureMediaDirs();
  }

  ensureMediaDirs() {
    for (const sub of Object.values(MEDIA_SUBDIRS)) {
      try {
        fs.mkdirSync(path.join(this.settings.mediaDir, sub), { recursive: true });
      } catch {
        /* папку створимо пізніше, коли знадобиться */
      }
    }
  }

  mediaDirFor(kind) {
    const dir = path.join(this.settings.mediaDir, MEDIA_SUBDIRS[kind] || MEDIA_SUBDIRS.FILE);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Унікальний шлях для нового медіафайлу: «2026-10-08 14-31-05 назва.ext» */
  uniqueMediaPath(kind, baseName) {
    const dir = this.mediaDirFor(kind);
    const safe = String(baseName || 'file')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .slice(-120) || 'file';
    const ext = path.extname(safe);
    const stem = safe.slice(0, safe.length - ext.length) || 'file';
    let candidate = path.join(dir, safe);
    let i = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${stem} (${i})${ext}`);
      i += 1;
    }
    return candidate;
  }

  isSafeId(id) {
    return typeof id === 'string' && SAFE_ID.test(id);
  }

  getMessages(chatId) {
    if (!this.isSafeId(chatId)) return [];
    if (!this.messages.has(chatId)) {
      const list = readJson(path.join(this.msgDir, chatId + '.json'), []);
      this.messages.set(chatId, Array.isArray(list) ? list : []);
    }
    return this.messages.get(chatId);
  }

  hasMessage(chatId, id) {
    return this.getMessages(chatId).some((m) => m.id === id);
  }

  findMessage(chatId, id) {
    return this.getMessages(chatId).find((m) => m.id === id) || null;
  }

  addMessage(msg) {
    const list = this.getMessages(msg.chatId);
    list.push(msg);
    list.sort((a, b) => a.timestamp - b.timestamp);
    const chat = this.chats[msg.chatId];
    if (chat) {
      const last = list[list.length - 1];
      chat.lastMessage = summary(last);
      chat.updatedAt = Math.max(chat.updatedAt || 0, last.timestamp);
    }
    this.dirtyChats.add(msg.chatId);
    this.scheduleSave();
    return msg;
  }

  updateMessage(chatId, id, patch) {
    const msg = this.findMessage(chatId, id);
    if (!msg) return null;
    Object.assign(msg, patch);
    const chat = this.chats[chatId];
    if (chat && chat.lastMessage && chat.lastMessage.id === id) chat.lastMessage = summary(msg);
    this.dirtyChats.add(chatId);
    this.scheduleSave();
    return msg;
  }

  deleteMessage(chatId, id) {
    const list = this.getMessages(chatId);
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    const chat = this.chats[chatId];
    if (chat) chat.lastMessage = summary(list[list.length - 1]);
    this.outbox = this.outbox.filter((j) => j.messageId !== id || j.kind === 'delete');
    this.dirtyChats.add(chatId);
    this.scheduleSave();
    return true;
  }

  clearChat(chatId) {
    this.messages.set(chatId, []);
    const chat = this.chats[chatId];
    if (chat) {
      chat.lastMessage = null;
      chat.unread = 0;
    }
    this.outbox = this.outbox.filter((j) => j.chatId !== chatId);
    this.dirtyChats.add(chatId);
    this.scheduleSave();
  }

  deleteChat(chatId) {
    if (chatId === 'lan') return this.clearChat(chatId);
    this.clearChat(chatId);
    delete this.chats[chatId];
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 400);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      writeJsonAtomic(this.file, {
        version: 1,
        profile: this.profile,
        settings: this.settings,
        contacts: this.contacts,
        chats: this.chats,
        outbox: this.outbox,
      });
      for (const chatId of this.dirtyChats) {
        writeJsonAtomic(path.join(this.msgDir, chatId + '.json'), this.getMessages(chatId));
      }
      this.dirtyChats.clear();
    } catch (e) {
      console.error('[store] save failed', e);
    }
  }
}

module.exports = { Store, summary, MEDIA_SUBDIRS };
