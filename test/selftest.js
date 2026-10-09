'use strict';
// Автотест двох копій (A і B) на одному комп'ютері. У збірку EXE не потрапляє.
// Запуск: PL_ROLE=A electron . --profile=A --selftest=test/selftest.js (і так само B)
const fs = require('fs');
const path = require('path');

module.exports = async function selftest({ app, win }) {
  const role = process.env.PL_ROLE || 'A';
  const out = process.env.PL_OUT || '/tmp/pl-shots';
  const fx = path.join(__dirname, 'fixtures');
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log(`[selftest ${role}]`, ...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (v) => JSON.stringify(v);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    await wait(500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${role}-${name}.png`), img.toPNG());
    log('shot', name);
  };
  const until = async (label, fn, timeout = 40000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await fn()) return true;
      } catch {
        /* ще не готово */
      }
      await wait(250);
    }
    throw new Error('timeout: ' + label);
  };
  win.webContents.on('console-message', (...args) => {
    const e = args[0];
    const level = typeof args[1] === 'number' ? args[1] : e.level;
    const message = typeof args[2] === 'string' ? args[2] : e.message;
    if (level === 3 || level === 'error' || level === 2 || level === 'warning') log('renderer', level, message);
  });
  win.webContents.on('render-process-gone', (_e, d) => log('RENDERER GONE', d));
  const sendText = (text) => js(`(async () => { const ta = document.getElementById('msgInput'); ta.value = ${q(text)}; await PL.chat.ACTIONS.sendText(); })()`);
  const lastOf = (chatId) => js(`(PL.state.chats[${q(chatId)}] || {}).lastMessage || {}`);

  try {
    await until('ui ready', () => js('!!(window.PL && PL.state && PL.state.profile && document.body.classList.contains("ready"))'));
    const me = role === 'A'
      ? { name: 'Олена', username: 'olena', deviceName: 'Ноутбук Олени', deviceType: 'laptop' }
      : { name: 'Марія', username: 'maria', deviceName: 'Робочий ПК', deviceType: 'computer' };
    await js(`pl.updateProfile(${q(me)})`);
    const avatar = [...fs.readFileSync(path.join(fx, role === 'A' ? 'avatar-a.jpg' : 'avatar-b.jpg'))];
    await js(`pl.setAvatar(new Uint8Array(${q(avatar)}))`);
    const other = role === 'A' ? 'Марія' : 'Олена';
    await until('peer online', () => js(`Object.values(PL.state.peers).some(p => p.online && p.name === ${q(other)})`), 60000);
    const peerId = await js(`Object.values(PL.state.peers).find(p => p.online && p.name === ${q(other)}).id`);
    log('peer found', peerId);
    await until('peer avatar', () => js(`!!(PL.state.contacts[${q(peerId)}] || {}).avatarFile`), 20000).catch((e) => log('WARN', e.message));

    if (role === 'A') {
      await js(`PL.app.openDirect(${q(peerId)})`);
      await wait(600);
      await sendText('Привіт! Так, бачу тебе поруч у мережі 💙');
      await until('B replied', async () => String((await lastOf(peerId)).text || '').includes('офлайн'));
      await js(`pl.sendMessage({ chatId: ${q(peerId)}, kind: 'PHOTO', filePath: ${q(path.join(fx, 'school.jpg'))} }).then((m) => PL.chat.onNew(${q(peerId)}, m))`);
      await wait(1200);
      await js('PL.chat.ACTIONS.voiceStart()');
      await wait(3300);
      await shot('recording-voice');
      await js('PL.chat.ACTIONS.voiceSend()');
      await until('video note from B', async () => (await lastOf(peerId)).kind === 'VIDEO', 60000);
      await sendText('Чудово! Вже йду! 🚶');
      await js(`pl.sendMessage({ chatId: ${q(peerId)}, kind: 'FILE', filePath: ${q(path.join(fx, 'План походу.txt'))} }).then((m) => PL.chat.onNew(${q(peerId)}, m))`);
      await wait(2500);
      await js(`pl.markRead(${q(peerId)})`);
      await shot('chat');
      await js(`PL.call.start(${q(peerId)})`);
      await until('call active', () => js('(PL.call.debug() || {}).phase === "active"'), 40000);
      await wait(3000);
      await shot('call-active');
      await js('document.querySelector(\'[data-call="hangup"]\').click()');
      await wait(2500);
      const gid = await js(`pl.createGroup('Друзі з походів', [${q(peerId)}]).then((c) => c.id)`);
      await wait(800);
      await js(`pl.sendMessage({ chatId: ${q(gid)}, kind: 'TEXT', text: 'Фото з учорашнього маршруту вже в чаті. Було неймовірно! ✨' })`);
      await js(`pl.sendMessage({ chatId: 'lan', kind: 'TEXT', text: 'У районі запрацювала нова точка доступу біля школи. Підключайтеся!' })`);
      await wait(2500);
      await js(`PL.app.openChat(${q(peerId)})`);
      await wait(1200);
      await shot('chat-final');
      for (const tab of ['contacts', 'settings', 'profile']) {
        await js(`PL.app.setTab(${q(tab)})`);
        await shot(tab);
      }
      await js("PL.app.setTab('chats')");
      win.setSize(440, 900);
      await wait(900);
      await shot('narrow-chat');
      await js('PL.chat.close()');
      await shot('narrow-list');
      await js("PL.app.setTab('contacts')");
      await shot('narrow-contacts');
      await js("PL.app.setTab('settings')");
      await shot('narrow-settings');
      await js("pl.updateSettings({ lang: 'pl' })");
      await wait(700);
      await shot('narrow-settings-pl');
      await js("pl.updateSettings({ lang: 'uk' })");
      log('RESULT OK');
    } else {
      await until('first text from A', async () => String((await lastOf(peerId)).text || '').startsWith('Привіт! Так'), 60000);
      await js(`PL.app.openChat(${q(peerId)})`);
      await wait(500);
      await js(`pl.markRead(${q(peerId)})`);
      await sendText('Привіт! 👋');
      await sendText('Ми нарешті підключились через Полонину у школі! Все працює офлайн через локальний Wi-Fi 😍');
      await until('voice from A', async () => (await lastOf(peerId)).kind === 'AUDIO', 60000);
      await js(`pl.markRead(${q(peerId)})`);
      await sendText('Супер! Я вже майже там. Запишу ще коротке відео.');
      js('PL.chat.ACTIONS.videoNote()');
      await until('vn overlay', () => js('!!document.querySelector(".vn-overlay")'));
      await wait(900);
      await js('document.querySelector(\'[data-vn="rec"]\').click()');
      await wait(3600);
      await shot('vn-recorder');
      await js('document.querySelector(\'[data-vn="send"]\').click()');
      await until('incoming call', () => js('(PL.call.debug() || {}).phase === "incoming"'), 90000);
      await wait(800);
      await shot('call-incoming');
      await js('document.querySelector(\'[data-call="accept"]\').click()');
      await until('call active', () => js('(PL.call.debug() || {}).phase === "active"'), 40000);
      await until('call ended', () => js('!PL.call.debug() || PL.call.debug().phase === "ended"'), 60000);
      await until('group arrived', () => js('Object.values(PL.state.chats).some((c) => c.type === "group" && c.lastMessage && c.lastMessage.kind === "TEXT")'), 40000);
      await until('lan arrived', () => js('!!PL.state.chats.lan.lastMessage'), 40000);
      await js(`PL.app.openChat(${q(peerId)})`);
      await wait(800);
      await js(`pl.markRead(${q(peerId)})`);
      await shot('chat');
      log('RESULT OK');
    }
  } catch (e) {
    log('RESULT FAIL', e && e.message);
    await shot('fail').catch(() => {});
  } finally {
    setTimeout(() => app.quit(), role === 'A' ? 3000 : 9000);
  }
};
