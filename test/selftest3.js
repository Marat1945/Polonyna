'use strict';
// Автотест версії 0.3 (дві копії A і B на одному комп'ютері). У збірку EXE не потрапляє.
const fs = require('fs');
const path = require('path');
const { clipboard, nativeImage } = require('electron');

module.exports = async function selftest3({ app, win }) {
  const role = process.env.PL_ROLE || 'A';
  const out = process.env.PL_OUT || '/tmp/pl-shots4';
  const fx = path.join(__dirname, 'fixtures');
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log(`[t3 ${role}]`, ...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (v) => JSON.stringify(v);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    await wait(450);
    fs.writeFileSync(path.join(out, `${role}-${name}.png`), (await win.webContents.capturePage()).toPNG());
    log('shot', name);
  };
  const until = async (label, fn, timeout = 40000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await fn()) return true;
      } catch {
        /* ще ні */
      }
      await wait(250);
    }
    throw new Error('timeout: ' + label);
  };
  win.webContents.on('console-message', (...args) => {
    const e = args[0];
    const level = typeof args[1] === 'number' ? args[1] : e.level;
    const message = typeof args[2] === 'string' ? args[2] : e.message;
    if (level === 3 || level === 'error') log('renderer error:', message);
  });
  const msgs = (chatId) => js(`pl.getMessages(${q(chatId)})`);
  const sendText = (text) => js(`(async () => { const ta = document.getElementById('msgInput'); ta.value = ${q(text)}; ta.dispatchEvent(new Event('input')); await PL.chat.ACTIONS.sendText(); })()`);
  const rightClick = (msgId) => js(`(() => { const el = document.querySelector('#msgInner .msg[data-id=${q(msgId)}]'); const r = el.getBoundingClientRect(); el.querySelector('.bubble, .vn-wrap, .photo-box').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + 20 })); return !!document.querySelector('.popup-menu'); })()`);
  const menuItems = () => js(`[...document.querySelectorAll('.popup-menu .pm-item')].map((b) => b.textContent.trim())`);
  const menuPick = (label) => js(`(() => { const b = [...document.querySelectorAll('.popup-menu .pm-item')].find((x) => x.textContent.trim() === ${q(label)}); if (b) b.click(); return !!b; })()`);

  try {
    await until('ui ready', () => js('!!(window.PL && PL.state && PL.state.profile && document.body.classList.contains("ready"))'));
    const me = role === 'A'
      ? { name: 'Олена', username: 'olena', deviceName: 'Ноутбук Олени', deviceType: 'laptop' }
      : { name: 'Марія', username: 'maria', deviceName: 'Робочий ПК', deviceType: 'computer' };
    await js(`pl.updateProfile(${q(me)})`);
    await js(`pl.setAvatar(new Uint8Array(${q([...fs.readFileSync(path.join(fx, role === 'A' ? 'avatar-a.jpg' : 'avatar-b.jpg'))])}))`);
    const other = role === 'A' ? 'Марія' : 'Олена';
    await until('peer online', () => js(`Object.values(PL.state.peers).some((p) => p.online && p.name === ${q(other)})`), 60000);
    const peerId = await js(`Object.values(PL.state.peers).find((p) => p.online && p.name === ${q(other)}).id`);
    log('peer found');

    if (role === 'A') {
      // ---- налаштування: звуки, камера і мікрофон ----
      await js("PL.app.setTab('settings')");
      await wait(800);
      log('sound rows:', JSON.stringify(await js(`[...document.querySelectorAll('#soundsCard .snd-row')].map((r) => r.querySelector('b').textContent + ' = ' + r.querySelector('small').textContent)`)));
      await js(`document.getElementById('devCheck').click()`);
      await until('device test', () => js(`document.querySelectorAll('#devMsg div').length >= 2`), 15000);
      log('device test:', JSON.stringify(await js(`[...document.querySelectorAll('#devMsg div')].map((d) => d.textContent)`)));
      await js(`document.getElementById('soundsCard').scrollIntoView()`);
      await shot('settings-sounds');
      await js(`document.getElementById('devicesCard').scrollIntoView()`);
      await shot('settings-devices');
      // обраний «мікрофон» не існує → програма сама бере робочий
      await js(`pl.updateSettings({ devices: { audio: 'no-such-device', video: 'no-such-device' } }).then((s) => { PL.state.settings = s; })`);
      log('fallback audio:', await js(`PL.media.getAudio().then((s) => { const l = s.getAudioTracks()[0].label; s.getTracks().forEach((t) => t.stop()); return 'OK ' + l; }, (e) => 'FAIL ' + e.message)`));
      log('fallback video:', await js(`PL.media.getVideo().then((s) => { const l = s.getVideoTracks()[0].label; s.getTracks().forEach((t) => t.stop()); return 'OK ' + l; }, (e) => 'FAIL ' + e.message)`));
      await js(`pl.updateSettings({ devices: { audio: '', video: '' } }).then((s) => { PL.state.settings = s; })`);
      await js(`PL.media.deviceProblem(Object.assign(new Error('notFound'), { kind: 'video', detail: 'NotFoundError: Requested device not found' }))`);
      await shot('device-problem');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await js("PL.app.setTab('chats')");

      // ---- видалення у всіх ----
      await js(`PL.app.openDirect(${q(peerId)})`);
      await wait(600);
      await sendText('Повідомлення для видалення 🗑');
      await until('delivered', async () => (await msgs(peerId)).some((m) => m.text && m.text.startsWith('Повідомлення для видалення') && ['delivered', 'read'].includes(m.status)), 15000);
      const delId = (await msgs(peerId)).find((m) => m.text && m.text.startsWith('Повідомлення для видалення')).id;
      await wait(1500); // B встигає побачити
      await rightClick(delId);
      log('text menu:', JSON.stringify(await menuItems()));
      await menuPick('Видалити у всіх');
      await until('confirm', () => js(`!!document.querySelector('.modal .btn.danger')`));
      await js(`document.querySelector('.modal .btn.danger').click()`);
      await until('deleted locally', async () => !(await msgs(peerId)).some((m) => m.id === delId), 10000);
      log('DELETE-ALL sender: removed locally');

      // ---- меню файлу: копіювати, вставити, зберегти як ----
      await js(`pl.sendMessage({ chatId: ${q(peerId)}, kind: 'PHOTO', filePath: ${q(path.join(fx, 'school.jpg'))} }).then((m) => PL.chat.onNew(${q(peerId)}, m))`);
      await wait(1500);
      const photo = (await msgs(peerId)).find((m) => m.kind === 'PHOTO');
      clipboard.clear();
      await rightClick(photo.id);
      log('file menu:', JSON.stringify(await menuItems()));
      await shot('file-menu');
      await menuPick('Копіювати');
      await wait(800);
      log('clipboard after copy: image empty =', clipboard.readImage().isEmpty());
      const target = '/tmp/pl-save/збережене фото.jpg';
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const saved = await js(`pl.saveAs(${q(photo.file.path)}, ${q(photo.file.name)}, ${q(target)})`);
      log('save as:', JSON.stringify(saved), 'exists =', fs.existsSync(target), fs.existsSync(target) ? fs.statSync(target).size : 0);
      clipboard.writeImage(nativeImage.createFromPath(path.join(fx, 'avatar-b.jpg')));
      const photosBefore = (await msgs(peerId)).filter((m) => m.kind === 'PHOTO').length;
      js('PL.chat.paste()');
      await until('paste confirm', () => js(`!!document.querySelector('.attach-modal #apSend')`), 10000);
      await shot('paste-confirm');
      await js(`document.getElementById('apSend').click()`);
      await until('pasted photo sent', async () => (await msgs(peerId)).filter((m) => m.kind === 'PHOTO').length > photosBefore, 15000);
      log('PASTE OK: photo sent from clipboard');

      // ---- відеодзвінок ----
      await js(`PL.call.start(${q(peerId)}, { video: true })`);
      await until('video call active', () => js('(PL.call.debug() || {}).phase === "active"'), 40000);
      await until('remote video', () => js('!/^0x0$|^$/.test((PL.call.debug() || {}).remoteVideo)'), 15000).catch((e) => log('WARN', e.message));
      await wait(1500);
      log('VIDEO CALL A:', JSON.stringify(await js('PL.call.debug()')));
      await shot('video-call');
      await js(`document.querySelector('[data-call="cam"]') && document.querySelector('[data-call="cam"]').click()`);
      await wait(600);
      await shot('video-call-camoff');
      await js(`document.querySelector('[data-call="hangup"]').click()`);
      await wait(2500);
      await shot('chat-after-call');
      log('call log:', JSON.stringify((await msgs(peerId)).filter((m) => m.kind === 'CALL').map((m) => m.call)));
      await sendText('Готово ✅');
      log('RESULT OK');
    } else {
      await until('text from A', async () => (await msgs(peerId)).some((m) => !m.outgoing && String(m.text).startsWith('Повідомлення для видалення')), 90000);
      await js(`PL.app.openChat(${q(peerId)})`);
      log('received message to delete');
      await until('deleted by A', async () => !(await msgs(peerId)).some((m) => String(m.text).startsWith('Повідомлення для видалення')), 60000);
      log('DELETE-ALL receiver: message removed on B');
      await until('incoming video call', () => js('(PL.call.debug() || {}).phase === "incoming"'), 120000);
      log('INCOMING B:', JSON.stringify(await js('PL.call.debug()')));
      await wait(700);
      await shot('video-incoming');
      await js(`document.querySelector('[data-call="accept"]').click()`);
      await until('active B', () => js('(PL.call.debug() || {}).phase === "active"'), 40000);
      await until('remote video B', () => js('!/^0x0$|^$/.test((PL.call.debug() || {}).remoteVideo)'), 15000).catch((e) => log('WARN', e.message));
      await wait(1200);
      log('VIDEO CALL B:', JSON.stringify(await js('PL.call.debug()')));
      await shot('video-call');
      await until('done from A', async () => (await msgs(peerId)).some((m) => !m.outgoing && String(m.text).startsWith('Готово')), 120000);
      log('RESULT OK');
    }
  } catch (e) {
    log('RESULT FAIL', e && e.message);
    await shot('fail').catch(() => {});
  } finally {
    setTimeout(() => app.quit(), role === 'A' ? 4000 : 2000);
  }
};
