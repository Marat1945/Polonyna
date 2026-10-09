'use strict';
// Автотест версії 0.2 (дві копії A і B на одному комп'ютері). У збірку EXE не потрапляє.
const fs = require('fs');
const path = require('path');

module.exports = async function selftest2({ app, win, getSplash }) {
  const role = process.env.PL_ROLE || 'A';
  const out = process.env.PL_OUT || '/tmp/pl-shots3';
  const fx = path.join(__dirname, 'fixtures');
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => console.log(`[t2 ${role}]`, ...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (v) => JSON.stringify(v);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shotOf = async (w, name) => {
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${role}-${name}.png`), img.toPNG());
    log('shot', name);
  };
  const shot = async (name) => {
    await wait(450);
    await shotOf(win, name);
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
    if (level === 3 || level === 'error' || level === 2 || level === 'warning') log('renderer', level, message);
  });

  if (role === 'A') {
    const sp = getSplash && getSplash();
    if (sp) {
      setTimeout(() => !sp.isDestroyed() && shotOf(sp, 'splash-1').catch(() => {}), 1150);
      setTimeout(() => !sp.isDestroyed() && shotOf(sp, 'splash-2').catch(() => {}), 2700);
    } else log('WARN no splash');
  }

  const sendText = (text) => js(`(async () => { const ta = document.getElementById('msgInput'); ta.value = ${q(text)}; ta.dispatchEvent(new Event('input')); await PL.chat.ACTIONS.sendText(); })()`);
  const msgs = (chatId) => js(`pl.getMessages(${q(chatId)})`);
  const press = (ms) => js(`(async () => { const b = document.getElementById('recBtn'); b.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true })); await new Promise((r) => setTimeout(r, ${ms})); b.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, bubbles: true })); })()`);
  const key = (k) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${q(k)}, bubbles: true, cancelable: true }))`);
  const click = (sel) => js(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true; })()`);
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
    log('peer found', peerId);

    if (role === 'A') {
      await until('peer verified', () => js(`!!(PL.state.peers[${q(peerId)}] || {}).verifiedAt`), 20000).catch((e) => log('WARN', e.message));
      log('NET peer', JSON.stringify(await js(`(() => { const p = PL.state.peers[${q(peerId)}]; return { link: p.link, localType: p.localType, sameSubnet: p.sameSubnet, network: p.network, rtt: p.rtt }; })()`)));
      log('NET own', JSON.stringify(await js('PL.state.net.addresses.map((a) => a.name + ":" + a.type + ":" + a.network)')));
      await js(`PL.app.openDirect(${q(peerId)})`);
      await wait(700);
      await sendText('Привіт! Тестуємо нову версію 0.2 💙');

      // 1) підтвердження перед надсиланням
      const files = ['school.jpg', 'clip.webm', 'Мій сигнал.wav', 'План походу.txt'].map((f) => path.join(fx, f));
      js(`PL.chat.confirmAttach(${q(files)})`);
      await until('attach modal', () => js(`!!document.querySelector('.attach-modal #apSend')`));
      await js(`document.getElementById('apCaption').value = 'Наша школа 🏫'`);
      await wait(900);
      await shot('attach-dialog');
      await click('#apSend');
      await until('attachments sent', async () => (await msgs(peerId)).filter((m) => m.outgoing && ['PHOTO', 'FILE'].includes(m.kind)).length >= 4, 30000);
      await wait(2500);

      // 2) поки є текст — кружечок ховається
      await js(`(() => { const ta = document.getElementById('msgInput'); ta.value = 'Друкую повідомлення…'; ta.dispatchEvent(new Event('input')); })()`);
      await shot('composer-typing');
      log('circle hidden while typing:', await js(`getComputedStyle(document.getElementById('recBtn')).opacity`));
      await js(`(() => { const ta = document.getElementById('msgInput'); ta.value = ''; ta.dispatchEvent(new Event('input')); })()`);

      // 3) голосове: утримання → запис → пауза → прослухати → продовжити → Enter
      if ((await js('PL.chat.mode()')) !== 'voice') await press(60);
      await press(600);
      await until('voice recording', () => js('!!PL.chat.recording()'), 10000);
      await wait(1600);
      await shot('voice-recording');
      await click('[data-act="voicePause"]');
      await wait(500);
      await click('[data-act="voicePreview"]');
      await wait(700);
      await shot('voice-paused');
      await click('[data-act="voicePause"]');
      await wait(1100);
      log('voice before Enter', JSON.stringify(await js('PL.chat.recording()')));
      await key('Enter');
      await until('voice sent', async () => (await msgs(peerId)).some((m) => m.outgoing && m.kind === 'AUDIO'), 20000);
      log('voice duration s', (await msgs(peerId)).find((m) => m.kind === 'AUDIO').duration.toFixed(2));

      // 4) коротке натискання — відеокружечок; утримання — запис із паузою
      await press(60);
      log('mode after short press:', await js('PL.chat.mode()'));
      await shot('mode-video');
      await press(600);
      await until('vn overlay', () => js('!!document.querySelector(".vn-overlay")'), 15000);
      await wait(1600);
      await click('[data-vn="pause"]');
      await wait(1000);
      await shot('vn-paused');
      await click('[data-vn="pause"]');
      await wait(1000);
      await key('Enter');
      await until('video sent', async () => (await msgs(peerId)).some((m) => m.outgoing && m.kind === 'VIDEO'), 20000);
      await press(60);

      // 5) приватні повідомлення (10 с після перегляду)
      await click('[data-act="ttlMenu"]');
      await wait(300);
      log('ttl 10 s picked:', await menuPick('10 с'));
      await wait(400);
      await sendText('Секретне повідомлення 🔒 — зникне після перегляду');
      js(`PL.chat.confirmAttach(${q([path.join(fx, 'school.jpg')])})`);
      await until('attach modal 2', () => js(`!!document.querySelector('.attach-modal #apSend')`));
      await click('#apSend');
      await until('private sent', async () => (await msgs(peerId)).filter((m) => m.private).length >= 2, 15000);
      await wait(1200);
      await shot('private-sent');
      await until('B opened private', async () => (await msgs(peerId)).some((m) => m.private && m.expiresAt), 60000);
      await wait(1500);
      await shot('private-countdown');
      await until('private vanished', async () => (await msgs(peerId)).filter((m) => m.private).length === 0, 30000);
      log('PRIVATE OK sender side; files left in private dir:', await js(`pl.storageStats().then(() => 'n/a')`));
      await click('[data-act="ttlMenu"]');
      await wait(300);
      await menuPick('Вимкнено');

      // 6) власні мелодії
      const st = await js(`pl.setSound('message', ${q(path.join(fx, 'Мій сигнал.wav'))})`);
      await js(`pl.setSound('ring', ${q(path.join(fx, 'Мелодія дзвінка.wav'))})`);
      log('SOUNDS', st && st.sounds && st.sounds.message && st.sounds.message.name);
      await js('PL.media.beep()');

      // 7) налаштування: сповіщення, сховище
      await js("PL.app.setTab('settings')");
      await wait(400);
      await click('[data-act="notifSettings"]');
      await wait(800);
      await shot('notif-modal');
      await key('Escape');
      await wait(300);
      await click('[data-act="storageSettings"]');
      await wait(1300);
      await shot('storage-modal');
      await key('Escape');
      const before = await js('pl.storageStats()');
      log('STORAGE before', JSON.stringify(Object.fromEntries(Object.entries(before.cats).map(([k, v]) => [k, v.bytes]))));
      const r = await js(`pl.storageClear(['photos', 'videos', 'voice', 'files', 'temp', 'cache'])`);
      const after = await js('pl.storageStats()');
      log('STORAGE freed', r.freed, 'after', JSON.stringify(Object.fromEntries(Object.entries(after.cats).map(([k, v]) => [k, v.bytes]))));
      log('messages marked deleted:', (await msgs(peerId)).filter((m) => m.file && m.file.deleted).length);
      await js("PL.app.setTab('chats')");
      await js(`PL.app.openChat(${q(peerId)})`);
      await wait(1000);
      await shot('after-clear');
      await click('.net-status');
      await wait(1000);
      await shot('net-modal');
      await key('Escape');
      await js("PL.app.setTab('settings')");
      await wait(300);
      await click('[data-act="about"]');
      await wait(700);
      await shot('about');
      await key('Escape');
      await js("PL.app.setTab('contacts')");
      await wait(500);
      await shot('contacts');
      await js("PL.app.setTab('chats')");
      await js(`PL.app.openChat(${q(peerId)})`);
      await wait(300);
      await sendText('Готово ✅');
      log('RESULT OK');
    } else {
      await until('first text from A', async () => (await msgs(peerId)).some((m) => !m.outgoing && String(m.text).startsWith('Привіт! Тестуємо')), 60000);
      await js(`PL.app.openChat(${q(peerId)})`);
      await wait(400);
      await js(`pl.markRead(${q(peerId)})`);
      await until('video from A', async () => (await msgs(peerId)).some((m) => !m.outgoing && m.kind === 'VIDEO'), 120000);
      await wait(1500);
      await shot('received-media');
      await until('private from A', async () => (await msgs(peerId)).filter((m) => m.private).length >= 2, 60000);
      await wait(1500);
      await shot('private-locked');
      await js(`(async () => { for (const b of [...document.querySelectorAll('.priv-card')]) { b.click(); await new Promise((r) => setTimeout(r, 400)); } })()`);
      await wait(1500);
      await shot('private-open');
      await until('private vanished B', async () => (await msgs(peerId)).filter((m) => m.private).length === 0, 30000);
      log('PRIVATE OK receiver side');
      await until('done from A', async () => (await msgs(peerId)).some((m) => !m.outgoing && String(m.text).startsWith('Готово')), 150000);
      log('RESULT OK');
    }
  } catch (e) {
    log('RESULT FAIL', e && e.message);
    await shot('fail').catch(() => {});
  } finally {
    setTimeout(() => app.quit(), role === 'A' ? 4000 : 2000);
  }
};
