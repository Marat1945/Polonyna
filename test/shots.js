'use strict';
// Перезапуск з уже збереженими даними: перевірка, що історія вантажиться з диска, і знімки екранів.
const fs = require('fs');
const path = require('path');
module.exports = async function shots({ app, win }) {
  const out = process.env.PL_OUT || '/tmp/pl-shots2';
  fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const shot = async (n) => { await wait(600); fs.writeFileSync(path.join(out, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  try {
    for (let i = 0; i < 80 && !(await js('document.body.classList.contains("ready")').catch(() => false)); i++) await wait(250);
    const info = await js(`(() => { const s = PL.state; const d = Object.values(s.chats).find(c => c.type === 'direct'); return { chats: Object.keys(s.chats).length, contacts: Object.keys(s.contacts).length, direct: d && d.id, last: d && d.lastMessage && d.lastMessage.kind }; })()`);
    console.log('[shots] restored', JSON.stringify(info));
    const n = await js(`PL.app.openChat(${JSON.stringify(info.direct)}).then(() => document.querySelectorAll('#msgInner .msg').length)`);
    console.log('[shots] messages rendered after restart:', n);
    await shot('wide-chat');
    await js("PL.app.setTab('contacts'); PL.state.ui.contactTab = 'saved'; PL.app.renderAll()");
    await shot('wide-contacts-saved');
    win.setSize(440, 900);
    await wait(800);
    await shot('narrow-chat');
    await js('PL.chat.close()');
    await js("PL.app.setTab('settings')");
    await shot('narrow-settings');
    await js("PL.app.setTab('chats')");
    await shot('narrow-list');
  } catch (e) {
    console.log('[shots] FAIL', e.message);
  } finally {
    setTimeout(() => app.quit(), 800);
  }
};
