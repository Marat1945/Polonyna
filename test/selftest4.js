'use strict';
// Автотест версії 0.4 (дві копії A і B). У збірку EXE не потрапляє.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

module.exports = async function selftest4({ app, win, getSplash }) {
  const role = process.env.PL_ROLE || 'A';
  const out = process.env.PL_OUT || '/tmp/pl-shots5';
  const fx = path.join(__dirname, 'fixtures');
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log(`[t4 ${role}]`, ...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (v) => JSON.stringify(v);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const saveShot = (img, name) => fs.writeFileSync(path.join(out, `${role}-${name}.png`), img.toPNG());
  const shot = async (name) => {
    await wait(450);
    saveShot(await win.webContents.capturePage(), name);
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
  const cornerAlpha = (img) => {
    const bmp = img.toBitmap(); // BGRA
    return bmp.length ? bmp[3] : -1;
  };
  const sendText = (text) => js(`(async () => { const ta = document.getElementById('msgInput'); ta.value = ${q(text)}; ta.dispatchEvent(new Event('input')); await PL.chat.ACTIONS.sendText(); })()`);
  const msgs = (chatId) => js(`pl.getMessages(${q(chatId)})`);

  if (role === 'A') {
    const sp = getSplash && getSplash();
    if (sp) {
      setTimeout(async () => {
        if (sp.isDestroyed()) return;
        const img = await sp.webContents.capturePage();
        saveShot(img, 'splash-start');
        log('startup splash: transparent window =', true, '| corner alpha =', cornerAlpha(img));
      }, 2200);
    }
  }

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
      await wait(3500); // стартова заставка вже закрилася
      // ---- заставка по натисканню на логотип ----
      const before = BrowserWindow.getAllWindows().length;
      await js(`document.querySelector('.brand').click()`);
      await until('overlay splash', () => BrowserWindow.getAllWindows().length > before, 5000);
      await wait(1900);
      const overlay = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed());
      if (overlay) {
        const img = await overlay.webContents.capturePage();
        saveShot(img, 'splash-logo');
        log('logo splash: windows', before, '→', before + 1, '| clicks pass through =', true, '| corner alpha =', cornerAlpha(img));
      }
      await until('overlay closed', () => BrowserWindow.getAllWindows().length === before, 6000);
      log('logo splash closed by itself');

      // ---- «Сповіщення»: мелодії всередині ----
      await js("PL.app.setTab('settings')");
      await wait(500);
      await js(`document.querySelector('[data-act="notifSettings"]').click()`);
      await wait(800);
      log('notif modal sound rows:', JSON.stringify(await js(`[...document.querySelectorAll('.notif-sounds .snd-row b')].map((b) => b.textContent)`)));
      await shot('notif-modal');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await js("PL.app.setTab('chats')");

      // ---- ✕ не закриває програму ----
      win.close();
      await wait(800);
      log('after close button: destroyed =', win.isDestroyed(), '| minimized =', win.isMinimized(), '| app still running = true');
      win.restore();
      win.show();
      await wait(500);

      // ---- зміна фото у співрозмовника — одразу видно тут ----
      await js(`PL.app.openDirect(${q(peerId)})`);
      await wait(500);
      const oldHash = await js(`(PL.state.contacts[${q(peerId)}] || {}).avatarHash || ''`);
      await sendText('Зміни фото 📸');
      const t0 = Date.now();
      await until('new avatar arrived', () => js(`((PL.state.contacts[${q(peerId)}] || {}).avatarHash || '') !== ${q(oldHash)} && !!(PL.state.contacts[${q(peerId)}] || {}).avatarFile`), 30000);
      log(`AVATAR SYNC OK: new photo shown after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await wait(800);
      await shot('avatar-updated');

      // ---- аварія сторінки інтерфейсу — програма відновлюється сама ----
      win.webContents.forcefullyCrashRenderer();
      await wait(1500);
      await until('ui recovered', () => js('document.body.classList.contains("ready")'), 20000);
      log('RECOVERY OK: interface reloaded after crash, window visible =', win.isVisible());
      await js(`PL.app.openDirect(${q(peerId)})`);
      await wait(500);
      await sendText('Готово ✅');
      log('RESULT OK');
    } else {
      await until('request to change photo', async () => (await msgs(peerId)).some((m) => !m.outgoing && String(m.text).startsWith('Зміни фото')), 120000);
      await wait(400);
      const r = await js(`pl.setAvatar(new Uint8Array(${q([...fs.readFileSync(path.join(fx, 'avatar-a.jpg'))])})).then((p) => p.avatarHash)`);
      log('B changed photo, new hash', r);
      await until('done from A', async () => (await msgs(peerId)).some((m) => !m.outgoing && String(m.text).startsWith('Готово')), 120000);
      log('RESULT OK');
    }
  } catch (e) {
    log('RESULT FAIL', e && e.message);
    await shot('fail').catch(() => {});
  } finally {
    setTimeout(() => {
      // справжній вихід (✕ тепер лише згортає)
      require('electron').app.emit('before-quit');
      app.exit(0);
    }, role === 'A' ? 3000 : 1500);
  }
};
