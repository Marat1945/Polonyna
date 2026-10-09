'use strict';
// Безпечний місток між інтерфейсом і головним процесом: інтерфейс бачить лише ці функції.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = [
  'peer', 'contact', 'chat', 'chat:deleted', 'message:new', 'message:update', 'message:deleted',
  'call:signal', 'focus', 'open-chat', 'notify', 'settings', 'profile', 'net', 'messages:refresh',
];

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('pl', {
  getState: () => invoke('state:get'),
  getMessages: (chatId) => invoke('chat:messages', chatId),
  openChat: (chatId) => invoke('chat:open', chatId),
  closeChat: () => invoke('chat:close'),
  markRead: (chatId) => invoke('chat:markRead', chatId),
  directChat: (peerId) => invoke('chat:direct', peerId),
  clearChat: (chatId) => invoke('chat:clear', chatId),
  deleteChat: (chatId) => invoke('chat:delete', chatId),
  muteChat: (chatId, muted) => invoke('chat:mute', chatId, muted),
  createGroup: (title, memberIds) => invoke('group:create', { title, memberIds }),

  sendMessage: (data) => invoke('msg:send', data),
  forwardMessage: (chatId, messageId, toChatIds) => invoke('msg:forward', { chatId, messageId, toChatIds }),
  retryMessage: (chatId, messageId) => invoke('msg:retry', { chatId, messageId }),
  deleteMessage: (chatId, messageId) => invoke('msg:delete', { chatId, messageId }),

  callSignal: (peerId, data) => invoke('call:signal', peerId, data),
  logCall: (peerId, info) => invoke('call:log', peerId, info),

  saveRecording: (kind, mime, bytes) => invoke('media:saveRecording', { kind, mime, bytes }),
  pickFiles: (mode) => invoke('dialog:pickFiles', mode),
  statFiles: (paths) => invoke('files:stat', paths),
  discardFile: (p) => invoke('media:discard', p),
  openPrivate: (chatId, messageId) => invoke('msg:openPrivate', chatId, messageId),
  setChatTtl: (chatId, ttl) => invoke('chat:setTtl', chatId, ttl),
  setProtection: (on) => invoke('win:protect', on),
  storageStats: () => invoke('storage:stats'),
  storageClear: (cats) => invoke('storage:clear', cats),
  pickSound: (kind) => invoke('sound:pick', kind),
  setSound: (kind, p) => invoke('sound:set', kind, p),
  resetSound: (kind) => invoke('sound:reset', kind),
  netCheck: () => invoke('net:check'),
  deleteForAll: (chatId, messageId) => invoke('msg:deleteAll', { chatId, messageId }),
  copyFile: (p, isImage) => invoke('clip:copyFile', p, isImage),
  readClipboard: () => invoke('clip:read'),
  saveAs: (p, name, target) => invoke('file:saveAs', p, name, target),
  openSystemSettings: (which) => invoke('sys:openSettings', which),
  showSplash: () => invoke('splash:show'),
  quitApp: () => invoke('app:quit'),
  pickAvatar: () => invoke('dialog:pickAvatar'),

  updateProfile: (patch) => invoke('profile:update', patch),
  setAvatar: (bytes) => invoke('profile:setAvatar', bytes),
  updateSettings: (patch) => invoke('settings:update', patch),
  chooseMediaDir: () => invoke('settings:chooseMediaDir'),

  openPath: (p) => invoke('shell:openPath', p),
  showItem: (p) => invoke('shell:showItem', p),
  openMediaDir: () => invoke('shell:openMediaDir'),
  openLog: () => invoke('shell:openLog'),

  netInfo: () => invoke('net:info'),
  refreshPeers: () => invoke('net:refresh'),
  connectManual: (text) => invoke('net:connect', text),
  makeQr: (text) => invoke('qr:make', text),
  isFocused: () => invoke('win:focused'),

  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },

  on: (channel, cb) => {
    if (!EVENTS.includes(channel)) throw new Error('unknown channel ' + channel);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
