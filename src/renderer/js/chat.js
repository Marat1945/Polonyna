'use strict';
// Права частина вікна: відкритий чат.
(function () {
  const PL = window.PL;
  const api = window.pl;
  const { t, tp } = PL.i18n;
  const U = PL.util;
  const { esc, ic } = U;
  const S = PL.state;
  const C = (PL.chat = {});
  const cache = {};

  const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  const VIDEO_RE = /\.(mp4|m4v|webm|mov|ogv)$/i;
  const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
  const TTL_OPTIONS = [0, 10, 30, 60, 300, 3600, 86400];

  let voice = null; // поточний запис голосового: { ctl, chatId, previewAudio, previewUrl, previewPlaying, raf }
  let recMode = 'voice';
  try {
    recMode = localStorage.getItem('pl.recMode') === 'video' ? 'video' : 'voice';
  } catch {
    recMode = 'voice';
  }
  let protectOn = false;
  let stuck = true; // чат «прилип» до низу: нові повідомлення й фото, що догружаються, не ховають низ
  let resizeObs = null;

  const activeChat = () => S.chats[S.ui.activeChatId] || null;
  const chatTtl = (chat) => (chat && chat.type === 'direct' ? chat.ttl || 0 : 0);

  function ttlLabel(sec) {
    if (sec >= 86400) return `${Math.round(sec / 86400)} ${t('uDay')}`;
    if (sec >= 3600) return `${Math.round(sec / 3600)} ${t('uHour')}`;
    if (sec >= 60) return `${Math.round(sec / 60)} ${t('uMin')}`;
    return `${sec} ${t('uSec')}`;
  }

  function kindLabel(m) {
    return { PHOTO: t('photo'), AUDIO: t('voice'), VIDEO: t('videoNote'), FILE: t('file') }[m.kind] || t('kindText');
  }

  // ---------- відкриття / закриття ----------

  function saveDraft() {
    const ta = document.getElementById('msgInput');
    if (ta && S.ui.activeChatId) S.drafts[S.ui.activeChatId] = ta.value;
  }

  function stopVoiceSilently() {
    if (!voice) return;
    if (voice.previewAudio) voice.previewAudio.pause();
    voice.ctl.cancel();
    cancelAnimationFrame(voice.raf);
    voice = null;
  }

  C.open = async (chatId) => {
    stopVoiceSilently();
    saveDraft();
    PL.media.stopAll();
    S.ui.activeChatId = chatId;
    const msgs = await api.openChat(chatId);
    cache[chatId] = Array.isArray(msgs) ? msgs.slice() : [];
    C.renderPane();
  };

  C.close = () => {
    if (resizeObs) resizeObs.disconnect();
    stopVoiceSilently();
    saveDraft();
    PL.media.stopAll();
    S.ui.activeChatId = null;
    api.closeChat();
    C.renderPane();
    updateProtection();
    PL.app.applyLayout();
    PL.app.scheduleUpdate('lists');
  };

  C.reload = async (chatId) => {
    if (chatId !== S.ui.activeChatId) return;
    const msgs = await api.getMessages(chatId);
    cache[chatId] = Array.isArray(msgs) ? msgs.slice() : [];
    renderMessages();
  };

  // ---------- розмітка ----------

  C.renderPane = () => {
    const main = document.getElementById('main');
    if (!main) return;
    const chat = activeChat();
    if (!chat) {
      main.innerHTML = `
        <div class="pane-empty">
          <img src="assets/emblem-256.png" alt="" draggable="false">
          <b>${esc(t('selectChat'))}</b>
          <span>${esc(t('selectChatSub'))}</span>
        </div>`;
      return;
    }
    main.innerHTML = `
      <header class="chat-head" id="chatHead"></header>
      <div class="messages" id="messages"><div class="msg-inner" id="msgInner"></div></div>
      <div class="drop-hint" id="dropHint"><div>${ic('paperclip', 44)}<b>${esc(t('dropHere'))}</b></div></div>
      <footer class="composer-wrap" id="composer"></footer>`;
    setupStick();
    C.renderHeader();
    renderMessages();
    renderComposer();
    scrollBottom();
    const ta = document.getElementById('msgInput');
    if (ta) ta.focus();
  };

  C.renderHeader = () => {
    const el = document.getElementById('chatHead');
    const chat = activeChat();
    if (!el || !chat) return;
    let sub = '';
    let on = false;
    if (chat.type === 'direct') {
      on = PL.app.isOnline(chat.id);
      const c = S.contacts[chat.id] || {};
      const p = S.peers[chat.id] || {};
      if (on) {
        const bothWifi = p.link === 'wifi' && p.localType === 'wifi';
        const via = p.link === 'cable' ? t('linkCable') : 'Wi-Fi';
        const text = bothWifi || !p.link ? t('sameWifi') : t('sameNetVia', { via });
        sub = `<span class="ch-wifi">${ic(p.link === 'cable' ? 'ethernet' : 'wifi', 18)}</span><span class="sub-t">${esc(text)}${p.verifiedAt ? ' · ✓' : ''}</span>`;
      } else {
        sub = `<span class="sub-t">${esc(t('lastSeen', { t: PL.i18n.relative(c.lastSeen) }))}</span>`;
      }
    } else if (chat.type === 'group') {
      sub = `<span class="sub-t">${esc(tp('members', (chat.members || []).length))}</span>`;
    } else {
      sub = `<span class="ch-wifi">${ic('wifi', 18)}</span><span class="sub-t">${esc(tp('devicesOnline', Object.values(S.peers).filter((p) => p.online).length))}</span>`;
    }
    el.innerHTML = `
      <button class="icon-btn back" data-act="chatBack">${ic('back', 26)}</button>
      <button class="ch-who" data-act="chatInfo">
        ${PL.app.chatAvatar(chat, 52)}
        <span class="ch-text"><b>${esc(PL.app.chatTitle(chat))}</b><small class="${on ? 'on' : ''}">${sub}</small></span>
      </button>
      ${chat.type === 'direct' ? `<button class="call-btn" data-act="chatVideoCall" title="${esc(t('videoCallBtn'))}">${ic('video', 26)}</button><button class="call-btn" data-act="chatCall" title="${esc(t('callBtn'))}">${ic('phone', 26)}</button>` : ''}
      <button class="icon-btn" data-act="chatMenu">${ic('more', 26)}</button>`;
  };

  function statusHtml(m) {
    if (m.status === 'failed') {
      return `<button class="tick failed" data-act="msgRetry" data-id="${esc(m.id)}" title="${esc(t('statusFailed'))}">${ic('alert', 16)}</button>`;
    }
    return PL.app.statusIcon(m.status);
  }

  function waveBars(m) {
    const N = 40;
    let vals = Array.isArray(m.waveform) && m.waveform.length ? m.waveform : null;
    if (!vals) {
      let h = U.hash(m.id);
      vals = Array.from({ length: N }, () => {
        h = (h * 1103515245 + 12345) & 0x7fffffff;
        return 6 + (h % 22);
      });
    }
    const out = [];
    for (let i = 0; i < N; i++) {
      const v = vals[Math.floor((i * vals.length) / N)] || 0;
      out.push(`<i style="height:${Math.round(4 + (Math.min(31, v) / 31) * 24)}px"></i>`);
    }
    return out.join('');
  }

  function ttlStatus(m) {
    if (m.expiresAt) return t('privLeft', { t: U.duration(Math.max(0, Math.ceil((m.expiresAt - Date.now()) / 1000))) });
    return `${ttlLabel(m.ttl || 0)} · ${t('privNotOpened')}`;
  }

  function msgHtml(m, chat, prev) {
    if (m.kind === 'SYSTEM') {
      return `<div class="msg-system" data-id="${esc(m.id)}"><span>${esc(PL.app.systemText(m))}</span></div>`;
    }
    const id = esc(m.id);
    const dir = m.outgoing ? 'out' : 'in';
    const showName = !m.outgoing && chat.type !== 'direct' && m.kind !== 'CALL' && (!prev || prev.senderId !== m.senderId || prev.kind === 'SYSTEM');
    const name = showName ? `<div class="msg-name" style="color:${U.colorFor(m.senderId)}">${esc(m.senderName || PL.app.contactName(m.senderId))}</div>` : '';
    const fwd = m.forwarded ? `<div class="msg-fwd">${ic('forward', 15)}<span>${esc(t('forwardedLabel'))}</span></div>` : '';
    const metaIn = `<span class="msg-time">${U.timeHM(m.timestamp)}</span>${m.outgoing ? statusHtml(m) : ''}`;
    const meta = `<span class="msg-meta">${metaIn}</span>`;
    const priv = !!m.private;

    // Приватне вхідне, ще не відкрите: лише картка «натисніть, щоб переглянути»
    if (priv && !m.outgoing && !m.openedAt) {
      return `<div class="msg in k-private" data-id="${id}">
        <div class="bubble priv-bubble">
          <button class="priv-card" data-act="openPrivate" data-id="${id}">
            <span class="priv-ic">${ic('fire', 26)}</span>
            <span class="priv-text"><b>${esc(t('privTitle'))}</b><small>${esc(kindLabel(m))} · ${esc(t('privTap'))}</small>
            <small class="priv-ttl">${esc(t('privWillVanish', { t: ttlLabel(m.ttl || 0) }))}</small></span>
          </button>
          ${meta}
        </div></div>`;
    }

    const badge = priv ? `<div class="priv-badge">${ic('fire', 14)}<span class="ttl-left" data-exp="${Number(m.expiresAt) || 0}">${esc(ttlStatus(m))}</span></div>` : '';
    const caption = m.text && m.kind !== 'TEXT' ? `<div class="msg-text caption ${m.outgoing ? 'with-ticks' : ''}">${esc(m.text)}${meta}</div>` : '';
    const src = m.file ? U.fileUrl(m.file.path) : '';
    const gone = m.file && m.file.deleted;
    let body = '';

    if (gone && ['PHOTO', 'AUDIO', 'VIDEO', 'FILE'].includes(m.kind)) {
      const icon = { PHOTO: 'image', AUDIO: 'mic', VIDEO: 'videoOutline', FILE: 'file' }[m.kind];
      body = `
        <div class="bubble gone-bubble">${name}${fwd}
          <div class="gone"><span class="gone-ic">${ic(icon, 22)}</span><span><b>${esc(m.kind === 'FILE' ? m.file.name : kindLabel(m))}</b><small>${esc(t('fileDeleted'))}</small></span></div>
          ${m.text ? `<div class="msg-text caption">${esc(m.text)}</div>` : ''}${meta}
        </div>`;
    } else {
      switch (m.kind) {
        case 'PHOTO':
          body = `
            <div class="bubble photo-bubble">${name}${fwd}${badge}
              <div class="photo-box"><img class="photo" src="${esc(src)}" alt="" loading="lazy" draggable="false" data-act="viewPhoto" data-id="${id}">
              ${m.text ? '' : `<span class="photo-meta">${metaIn}</span>`}</div>
              ${caption}
            </div>`;
          break;
        case 'AUDIO':
          body = `
            <div class="bubble voice-bubble">${name}${fwd}${badge}
              <div class="voice">
                <button class="vplay" data-act="playVoice" data-id="${id}">${ic('play', 30)}</button>
                <div class="vwave" data-act="seekVoice" data-id="${id}">${waveBars(m)}</div>
                <span class="vdur">${U.duration(m.duration)}</span>
              </div>
              ${meta}
            </div>`;
          break;
        case 'VIDEO':
          body = `
            <div class="vn-wrap">${name}${fwd}${badge}
              <div class="vnote" data-act="playVnote" data-id="${id}" data-dur="${Number(m.duration) || 0}">
                <video src="${esc(src)}#t=0.1" preload="metadata" playsinline></video>
                <svg class="vn-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg>
                <span class="vn-play">${ic('play', 44)}</span>
                <span class="vn-dur">${U.duration(m.duration)}</span>
              </div>
            </div>
            <span class="msg-meta vn-meta">${metaIn}</span>`;
          break;
        case 'FILE': {
          const fname = m.file ? m.file.name : t('file');
          if (m.file && VIDEO_RE.test(fname)) {
            body = `
              <div class="bubble clip-bubble">${name}${fwd}${badge}
                <video class="clip" src="${esc(src)}#t=0.1" preload="metadata" controls ${priv ? 'controlsList="nodownload"' : ''}></video>
                ${m.text ? `<div class="msg-text caption">${esc(m.text)}</div>` : ''}
                <span class="msg-meta">${metaIn}</span>
              </div>`;
          } else if (m.file && AUDIO_RE.test(fname)) {
            body = `
              <div class="bubble afile-bubble">${name}${fwd}${badge}
                <div class="afile">
                  <button class="vplay" data-act="playAudioFile" data-id="${id}">${ic('play', 30)}</button>
                  <div class="afile-main"><b>${esc(fname)}</b><div class="afile-bar" data-act="seekAudioFile" data-id="${id}"><i></i></div><small class="afile-time">${esc(U.size(m.file.size))}</small></div>
                </div>
                ${caption || meta}
              </div>`;
          } else {
            body = `
              <div class="bubble file-bubble">${name}${fwd}${badge}
                <button class="file" data-act="openFile" data-id="${id}">
                  <span class="file-ic">${ic('file', 26)}</span>
                  <span class="file-info"><b>${esc(fname)}</b><small>${esc(m.file ? U.size(m.file.size) : '')}</small></span>
                </button>
                ${caption || meta}
              </div>`;
          }
          break;
        }
        case 'CALL': {
          const ok = m.call && m.call.result === 'ok';
          const vid = !!(m.call && m.call.video);
          const icon = vid ? 'video' : m.outgoing ? 'phoneOut' : ok ? 'phoneIn' : 'phoneMissed';
          body = `
            <div class="bubble call-bubble">
              <button class="call-log" data-act="${vid ? 'chatVideoCall' : 'chatCall'}">
                <span class="cl-ic ${ok ? '' : 'missed'}">${ic(icon, 22)}</span>
                <span class="cl-text"><b>${esc(PL.app.callText(m.call, m.outgoing))}</b><small>${ok ? U.duration(m.call.duration) : '&nbsp;'}</small></span>
              </button>
              <span class="msg-meta"><span class="msg-time">${U.timeHM(m.timestamp)}</span></span>
            </div>`;
          break;
        }
        default:
          body = `<div class="bubble">${name}${fwd}${badge}<div class="msg-text ${m.outgoing ? 'with-ticks' : ''}">${esc(m.text)}${meta}</div></div>`;
      }
    }
    const canForward = !priv && !gone && ['TEXT', 'PHOTO', 'AUDIO', 'VIDEO', 'FILE'].includes(m.kind);
    const fwdBtn = canForward ? `<button class="fwd-btn" data-act="msgForward" data-id="${id}" title="${esc(t('forward'))}">${ic('forward', 20)}</button>` : '';
    return `<div class="msg ${dir} k-${m.kind.toLowerCase()} ${priv ? 'is-private' : ''}" data-id="${id}">${dir === 'out' ? fwdBtn + body : body + fwdBtn}</div>`;
  }

  function emptyChatHtml(chat) {
    const lan = chat.type === 'lan';
    return `
      <div class="chat-empty">
        <div class="ce-card">
          <span class="ce-ic">${ic(lan ? 'megaphone' : 'chatsFilled', 34)}</span>
          <b>${esc(t('emptyChat'))}</b>
          <span>${esc(lan ? t('lanChatEmpty') : t('emptyChatSub'))}</span>
        </div>
      </div>`;
  }

  function renderMessages() {
    const inner = document.getElementById('msgInner');
    const chat = activeChat();
    if (!inner || !chat) return;
    const list = cache[chat.id] || [];
    if (!list.length) {
      inner.innerHTML = emptyChatHtml(chat);
      updateProtection();
      return;
    }
    let html = '';
    let lastTs = null;
    let prev = null;
    for (const m of list) {
      if (lastTs === null || !U.sameDay(lastTs, m.timestamp)) {
        html += `<div class="day-sep"><span>${esc(U.dayLabel(m.timestamp))}</span></div>`;
        prev = null;
      }
      lastTs = m.timestamp;
      html += msgHtml(m, chat, prev);
      prev = m;
    }
    inner.innerHTML = html;
    watchMedia(inner);
    updateProtection();
  }

  function nearBottom() {
    const box = document.getElementById('messages');
    return !box || box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  }

  function scrollBottom() {
    const box = document.getElementById('messages');
    if (box) box.scrollTop = box.scrollHeight;
    stuck = true;
  }

  function setupStick() {
    const box = document.getElementById('messages');
    const inner = document.getElementById('msgInner');
    stuck = true;
    if (resizeObs) resizeObs.disconnect();
    if (!box || !inner) return;
    box.addEventListener('scroll', () => {
      stuck = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    });
    resizeObs = new ResizeObserver(() => {
      if (stuck) box.scrollTop = box.scrollHeight;
    });
    resizeObs.observe(inner);
  }

  function watchMedia(root) {
    root.querySelectorAll('img.photo').forEach((img) => {
      if (img.complete) return;
      img.addEventListener('error', () => img.closest('.photo-box') && img.closest('.photo-box').classList.add('broken'), { once: true });
    });
  }

  /** Приватні повідомлення не потрапляють на знімки й записи екрана (Windows). */
  function updateProtection() {
    const list = cache[S.ui.activeChatId] || [];
    const need = !!S.ui.activeChatId && list.some((m) => m.private && (m.outgoing || m.openedAt));
    if (need !== protectOn) {
      protectOn = need;
      api.setProtection(need);
    }
  }

  // ---------- поле введення ----------

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  }

  function recBarHtml() {
    const paused = voice.ctl.paused;
    return `
      <div class="composer recording ${paused ? 'paused' : ''}">
        <button class="c-btn danger-soft" data-act="voiceCancel" title="${esc(t('cancelRec'))}">${ic('trash', 24)}</button>
        <div class="rec-box">
          ${paused ? `<button class="rec-play" data-act="voicePreview" title="${esc(t('listen'))}">${ic(voice.previewPlaying ? 'pause' : 'play', 22)}</button>` : '<span class="rec-dot"></span>'}
          <div class="rec-level" id="recLevel">${'<i></i>'.repeat(paused ? 48 : 44)}</div>
          <span class="rec-time" id="recTime">${PL.media.clock(voice.ctl.elapsed())}</span>
        </div>
        <button class="c-btn rec-toggle" data-act="voicePause" title="${esc(paused ? t('resumeRec') : t('pauseRec'))}">${ic(paused ? 'mic' : 'pause', 24)}</button>
        <button class="c-send rec-send" data-act="voiceSend" title="${esc(t('sendRec'))}">${ic('send', 26)}</button>
      </div>`;
  }

  function composerHtml(chat) {
    const ttl = chatTtl(chat);
    const direct = chat.type === 'direct';
    return `
      ${ttl ? `<div class="priv-banner">${ic('fire', 16)}<span>${esc(t('timerBanner', { t: ttlLabel(ttl) }))}</span></div>` : ''}
      <div class="composer" id="composerRow">
        <button class="c-btn" data-act="attach" title="${esc(t('attachTitle'))}">${ic('image', 26)}</button>
        ${direct ? `<button class="c-btn timer ${ttl ? 'on' : ''}" data-act="ttlMenu" title="${esc(t('timerTitle'))}">${ic(ttl ? 'fire' : 'timer', 24)}${ttl ? `<small>${esc(ttlLabel(ttl))}</small>` : ''}</button>` : ''}
        <div class="c-input"><textarea id="msgInput" rows="1" placeholder="${esc(t('messagePh'))}"></textarea></div>
        <button class="c-send" data-act="sendText" title="${esc(t('send'))}">${ic('send', 26)}</button>
        <button class="c-rec mode-${recMode}" id="recBtn" title="${esc(t(recMode === 'voice' ? 'recHintVoice' : 'recHintVideo'))}">
          <span class="rb-ic rb-mic">${ic('mic', 28)}</span><span class="rb-ic rb-cam">${ic('videoOutline', 28)}</span>
        </button>
      </div>`;
  }

  function renderComposer() {
    const el = document.getElementById('composer');
    const chat = activeChat();
    if (!el || !chat) return;
    if (voice) {
      el.innerHTML = recBarHtml();
      return;
    }
    el.innerHTML = composerHtml(chat);
    const row = el.querySelector('#composerRow');
    const ta = el.querySelector('#msgInput');
    ta.value = S.drafts[S.ui.activeChatId] || '';
    autoGrow(ta);
    row.classList.toggle('has-text', !!ta.value.trim());
    ta.addEventListener('input', () => {
      autoGrow(ta);
      row.classList.toggle('has-text', !!ta.value.trim());
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendText();
      }
    });
    ta.addEventListener('paste', onPaste);
    bindRecButton(el.querySelector('#recBtn'));
  }

  /** Кружечок: коротке натискання — перемкнути голосове/відеокружечок, утримання — почати запис. */
  function bindRecButton(btn) {
    if (!btn) return;
    let timer = 0;
    let held = false;
    let down = false;
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = true;
      held = false;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      btn.classList.add('pressing');
      timer = setTimeout(() => {
        held = true;
        btn.classList.remove('pressing');
        startRecording();
      }, 350);
    });
    btn.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      clearTimeout(timer);
      btn.classList.remove('pressing');
      if (!held) toggleMode();
    });
    btn.addEventListener('pointercancel', () => {
      down = false;
      clearTimeout(timer);
      btn.classList.remove('pressing');
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startRecording();
      }
    });
  }

  function toggleMode() {
    recMode = recMode === 'voice' ? 'video' : 'voice';
    try {
      localStorage.setItem('pl.recMode', recMode);
    } catch {
      /* ignore */
    }
    const btn = document.getElementById('recBtn');
    if (btn) {
      btn.classList.remove('mode-voice', 'mode-video');
      btn.classList.add(`mode-${recMode}`, 'flip');
      btn.title = t(recMode === 'voice' ? 'recHintVoice' : 'recHintVideo');
      setTimeout(() => btn.classList.remove('flip'), 340);
    }
    U.toast(t(recMode === 'voice' ? 'modeVoiceToast' : 'modeVideoToast'));
  }

  function startRecording() {
    if (recMode === 'video') videoNote();
    else voiceStart();
  }

  // ---------- надсилання ----------

  function addLocal(chatId, msg) {
    if (!msg || msg.error) return false;
    C.onNew(chatId, msg);
    return true;
  }

  async function sendText() {
    const chat = activeChat();
    const ta = document.getElementById('msgInput');
    if (!chat || !ta) return;
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    autoGrow(ta);
    const row = document.getElementById('composerRow');
    if (row) row.classList.remove('has-text');
    S.drafts[chat.id] = '';
    const r = await api.sendMessage({ chatId: chat.id, kind: 'TEXT', text, ttl: chatTtl(chat) });
    if (!addLocal(chat.id, r)) {
      U.toast(t('sendFailed'), 'error');
      ta.value = text;
      if (row) row.classList.add('has-text');
    }
  }

  async function sendFile(chatId, filePath, kind, extra) {
    const chat = S.chats[chatId];
    const r = await api.sendMessage(Object.assign({ chatId, kind, filePath, ttl: chatTtl(chat) }, extra || {}));
    if (!addLocal(chatId, r)) U.toast(r && r.error === 'tooLarge' ? t('fileTooLarge') : t('sendFailed'), 'error');
  }

  /** Вікно підтвердження перед надсиланням фото, відео, файлів (як у Telegram). */
  async function confirmAttach(paths, opts = {}) {
    const chat = activeChat();
    if (!chat) return;
    const chatId = chat.id;
    let items = await api.statFiles(paths.filter(Boolean));
    if (!Array.isArray(items) || !items.length) {
      if (opts.temp) api.discardFile(opts.temp);
      return;
    }
    items = items.slice(0, 20);
    let sent = false;
    const ttl = chatTtl(chat);
    const title = () => {
      const n = items.length;
      if (items.every((i) => IMAGE_RE.test(i.name))) return tp('photosCount', n);
      if (items.every((i) => VIDEO_RE.test(i.name))) return tp('videosCount', n);
      return tp('filesCount', n);
    };
    const grid = () => items.map((it, i) => {
      const del = `<button class="ap-del" data-ap-del="${i}" title="${esc(t('removeItem'))}">${ic('close', 18)}</button>`;
      if (IMAGE_RE.test(it.name)) return `<div class="ap-item ap-photo"><img src="${esc(U.fileUrl(it.path))}" alt="">${del}</div>`;
      if (VIDEO_RE.test(it.name)) return `<div class="ap-item ap-video"><video src="${esc(U.fileUrl(it.path))}#t=0.1" preload="metadata" muted></video><span class="ap-badge">${ic('play', 22)}</span>${del}</div>`;
      return `<div class="ap-item ap-file"><span class="file-ic">${ic(AUDIO_RE.test(it.name) ? 'music' : 'file', 24)}</span><span class="file-info"><b>${esc(it.name)}</b><small>${esc(U.size(it.size))}</small></span>${del}</div>`;
    }).join('');
    U.modal({
      title: title(),
      cls: 'attach-modal',
      body: `
        <div class="ap-grid ${items.length === 1 ? 'single' : ''}" id="apGrid">${grid()}</div>
        ${ttl ? `<div class="priv-banner in-modal">${ic('fire', 16)}<span>${esc(t('timerBanner', { t: ttlLabel(ttl) }))}</span></div>` : ''}
        <div class="ap-caption">
          <input id="apCaption" maxlength="2000" placeholder="${esc(t('addCaption'))}" autocomplete="off">
          <button class="c-send" id="apSend" title="${esc(t('send'))}">${ic('send', 24)}</button>
        </div>`,
      onMount: (mm) => {
        const send = async () => {
          if (sent) return;
          sent = true;
          const caption = mm.el.querySelector('#apCaption').value.trim();
          mm.close();
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            await sendFile(chatId, it.path, IMAGE_RE.test(it.name) ? 'PHOTO' : 'FILE', { text: i === 0 ? caption : '' });
          }
        };
        mm.el.querySelector('#apSend').addEventListener('click', send);
        mm.el.querySelector('#apCaption').addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        });
        mm.el.querySelector('#apGrid').addEventListener('click', (e) => {
          const b = e.target.closest('[data-ap-del]');
          if (!b) return;
          items.splice(Number(b.dataset.apDel), 1);
          if (!items.length) return mm.close();
          const g = mm.el.querySelector('#apGrid');
          g.innerHTML = grid();
          g.classList.toggle('single', items.length === 1);
          mm.el.querySelector('.modal-head h2').textContent = title();
        });
      },
      onClose: () => {
        if (!sent && opts.temp) api.discardFile(opts.temp);
      },
    });
  }
  C.confirmAttach = confirmAttach;

  async function onPaste(e) {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (!files.length) return;
    e.preventDefault();
    const paths = files.map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) return confirmAttach(paths);
    const img = files.find((f) => f.type && f.type.startsWith('image/'));
    if (img) {
      const saved = await api.saveRecording('PHOTO', img.type, new Uint8Array(await img.arrayBuffer()));
      if (typeof saved === 'string') confirmAttach([saved], { temp: saved });
    }
  }

  // ---------- голосові: запис, пауза, прослуховування ----------

  function paintVoice() {
    if (!voice) return;
    const ctl = voice.ctl;
    const bars = document.querySelectorAll('#recLevel i');
    const time = document.getElementById('recTime');
    if (ctl.paused) {
      const wave = PL.media.waveformFromLevels(ctl.levels, bars.length);
      const a = voice.previewAudio;
      const total = ctl.elapsed();
      const pos = a && !a.paused ? a.currentTime : a && a.currentTime ? a.currentTime : 0;
      const k = total ? Math.round((pos / total) * bars.length) : 0;
      bars.forEach((b, i) => {
        b.style.height = `${Math.round(4 + (wave[i] / 31) * 22)}px`;
        b.classList.toggle('on', i < k);
      });
      if (time) time.textContent = PL.media.clock(a && !a.paused ? pos : total);
    } else {
      const lv = ctl.levels.slice(-bars.length);
      const offset = bars.length - lv.length;
      bars.forEach((b, i) => {
        const v = i >= offset ? lv[i - offset] : 0;
        b.style.height = `${Math.round(4 + v * 22)}px`;
        b.classList.remove('on');
      });
      if (time) time.textContent = PL.media.clock(ctl.elapsed());
      if (ctl.elapsed() > 600) voiceSend();
    }
    voice.raf = requestAnimationFrame(paintVoice);
  }

  async function voiceStart() {
    if (voice) return;
    const chatId = S.ui.activeChatId;
    let ctl;
    try {
      ctl = await PL.media.startVoice();
    } catch (e) {
      PL.media.deviceProblem(e);
      return;
    }
    if (S.ui.activeChatId !== chatId) return ctl.cancel();
    PL.media.stopAll();
    saveDraft();
    voice = { ctl, chatId, previewAudio: null, previewUrl: '', previewPlaying: false, raf: 0 };
    renderComposer();
    voice.raf = requestAnimationFrame(paintVoice);
  }

  function stopPreview() {
    if (voice && voice.previewAudio) {
      voice.previewAudio.pause();
      voice.previewPlaying = false;
    }
  }

  function voicePause() {
    if (!voice) return;
    if (voice.ctl.paused) {
      stopPreview();
      voice.ctl.resume();
    } else {
      voice.ctl.pause();
    }
    renderComposer();
  }

  async function voicePreview() {
    if (!voice || !voice.ctl.paused) return;
    const a = voice.previewAudio || (voice.previewAudio = new Audio());
    if (voice.previewPlaying) {
      a.pause();
      voice.previewPlaying = false;
      return renderComposer();
    }
    const blob = await voice.ctl.snapshot();
    if (!voice) return;
    if (voice.previewUrl) URL.revokeObjectURL(voice.previewUrl);
    voice.previewUrl = URL.createObjectURL(blob);
    a.src = voice.previewUrl;
    a.onended = () => {
      if (voice) {
        voice.previewPlaying = false;
        renderComposer();
      }
    };
    a.play().catch(() => {});
    voice.previewPlaying = true;
    renderComposer();
  }

  function voiceCancel() {
    if (!voice) return;
    stopPreview();
    if (voice.previewUrl) URL.revokeObjectURL(voice.previewUrl);
    cancelAnimationFrame(voice.raf);
    voice.ctl.cancel();
    voice = null;
    renderComposer();
  }

  async function voiceSend() {
    if (!voice) return;
    const v = voice;
    voice = null;
    cancelAnimationFrame(v.raf);
    if (v.previewAudio) v.previewAudio.pause();
    if (v.previewUrl) URL.revokeObjectURL(v.previewUrl);
    renderComposer();
    const r = await v.ctl.stop();
    if (!r) return;
    if (r.duration < 0.7) return U.toast(t('tooShort'));
    const saved = await api.saveRecording('AUDIO', r.mime, new Uint8Array(await r.blob.arrayBuffer()));
    if (typeof saved !== 'string') return U.toast(t('sendFailed'), 'error');
    sendFile(v.chatId, saved, 'AUDIO', { mime: r.mime, duration: r.duration, waveform: r.waveform });
  }

  // Esc — скасувати, Enter — надіслати, пробіл — пауза/продовжити
  document.addEventListener('keydown', (e) => {
    if (!voice || U.openModals) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      voiceCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      voiceSend();
    } else if (e.key === ' ' && !(e.target && /input|textarea/i.test(e.target.tagName))) {
      e.preventDefault();
      voicePause();
    }
  }, true);

  async function videoNote() {
    const chatId = S.ui.activeChatId;
    PL.media.stopAll();
    const r = await PL.media.recordVideoNote();
    if (!r) return;
    if (r.duration < 0.7) return U.toast(t('tooShort'));
    const saved = await api.saveRecording('VIDEO', r.mime, new Uint8Array(await r.blob.arrayBuffer()));
    if (typeof saved !== 'string') return U.toast(t('sendFailed'), 'error');
    sendFile(chatId, saved, 'VIDEO', { mime: r.mime, duration: r.duration });
  }

  // ---------- приватні повідомлення ----------

  function ttlMenu(btn) {
    const chat = activeChat();
    if (!chat || chat.type !== 'direct') return;
    const r = btn.getBoundingClientRect();
    const cur = chat.ttl || 0;
    U.menu(r.left, r.top, TTL_OPTIONS.map((sec) => ({
      icon: sec === cur ? 'check' : sec ? 'fire' : 'timer',
      label: sec ? ttlLabel(sec) : t('timerOff'),
      onClick: async () => {
        saveDraft();
        const c = await api.setChatTtl(chat.id, sec);
        if (c && c.id) {
          S.chats[c.id] = c;
          renderComposer();
          if (sec) U.toast(t('timerBanner', { t: ttlLabel(sec) }));
        }
      },
    })));
  }

  setInterval(() => {
    const now = Date.now();
    document.querySelectorAll('.ttl-left[data-exp]').forEach((el) => {
      const exp = Number(el.dataset.exp);
      if (!exp) return;
      const rem = Math.max(0, Math.ceil((exp - now) / 1000));
      el.textContent = t('privLeft', { t: U.duration(rem) });
      if (!rem) {
        const msg = el.closest('.msg');
        if (msg) msg.classList.add('vanishing');
      }
    });
  }, 500);

  // ---------- переслати, переглянути ----------

  function findMsg(id) {
    const list = cache[S.ui.activeChatId] || [];
    return list.find((m) => m.id === id) || null;
  }

  function forwardModal(msg) {
    if (msg.private) return U.toast(t('privNoForward'));
    const chats = Object.values(S.chats)
      .filter((c) => c.type !== 'direct' || c.lastMessage || PL.app.isOnline(c.id))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    const rows = chats.map((c) => `
      <label class="pick-row">
        <input type="checkbox" value="${esc(c.id)}">
        ${PL.app.chatAvatar(c, 40)}
        <span class="pick-name">${esc(PL.app.chatTitle(c))}</span>
      </label>`).join('');
    U.modal({
      title: t('forwardTo'),
      body: `<div class="pick-list tall">${rows}</div>`,
      actions: [
        { label: t('cancel'), cls: 'ghost' },
        { label: t('forward'), cls: 'primary', onClick: async (m) => {
          const ids = [...m.el.querySelectorAll('.pick-row input:checked')].map((i) => i.value);
          if (!ids.length) return true;
          const r = await api.forwardMessage(S.ui.activeChatId, msg.id, ids);
          if (Array.isArray(r) && r.length) U.toast(t('forwardDone'));
          else U.toast(t(r && r.error === 'fileMissing' ? 'fileMissing' : 'sendFailed'), 'error');
          return false;
        } },
      ],
    });
  }

  function lightbox(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'lightbox';
    const priv = !!msg.private;
    wrap.innerHTML = `
      <img src="${esc(U.fileUrl(msg.file.path))}" alt="" draggable="false">
      <div class="lb-bar">
        ${priv ? '' : `<button data-lb="open">${ic('openExternal', 20)}<span>${esc(t('open'))}</span></button>
        <button data-lb="folder">${ic('folder', 20)}<span>${esc(t('showInFolder'))}</span></button>`}
        <button data-lb="close">${ic('close', 22)}</button>
      </div>`;
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lb]');
      if (b && b.dataset.lb === 'open') api.openPath(msg.file.path);
      else if (b && b.dataset.lb === 'folder') api.showItem(msg.file.path);
      else if (!e.target.closest('img')) close();
      if (b && b.dataset.lb === 'close') close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
  }

  function membersModal(chat) {
    const rows = (chat.members || []).map((m) => {
      const c = S.contacts[m.id] || {};
      const me = m.id === S.profile.id;
      return `
        <div class="pick-row static">
          ${U.avatar({ kind: 'contact', id: m.id, name: me ? S.profile.name : c.name || m.name, file: me ? S.profile.avatarFile : c.avatarFile, size: 40, dot: me ? 'on' : PL.app.isOnline(m.id) ? 'on' : 'off' })}
          <span class="pick-name">${esc(me ? S.profile.name + ' (' + t('you') + ')' : c.name || m.name)}<small>${esc(me ? '' : U.deviceLabel(c))}</small></span>
        </div>`;
    }).join('');
    U.modal({ title: t('membersTitle'), body: `<div class="pick-list tall">${rows}</div>`, actions: [{ label: t('close'), cls: 'primary' }] });
  }

  function chatMenu(btn) {
    const chat = activeChat();
    if (!chat) return;
    const r = btn.getBoundingClientRect();
    U.menu(r.right - 250, r.bottom + 6, [
      chat.type === 'direct' && { icon: 'info', label: t('deviceInfo'), onClick: () => PL.app.deviceInfoModal(chat.id) },
      chat.type === 'group' && { icon: 'group', label: t('membersTitle'), onClick: () => membersModal(chat) },
      chat.type === 'direct' && { icon: 'fire', label: t('timerTitle'), onClick: () => ttlMenu(document.querySelector('[data-act="ttlMenu"]') || btn) },
      { icon: 'bell', label: chat.muted ? t('unmute') : t('mute'), onClick: () => api.muteChat(chat.id, !chat.muted) },
      '-',
      { icon: 'broom', label: t('clearHistory'), onClick: async () => {
        if (await U.confirmBox(t('confirmClear'), t('clear'))) {
          await api.clearChat(chat.id);
          cache[chat.id] = [];
          renderMessages();
        }
      } },
      chat.type !== 'lan' && { icon: 'trash', label: t('deleteChat'), danger: true, onClick: async () => {
        if (await U.confirmBox(t('confirmDelete'), t('del'))) {
          await api.deleteChat(chat.id);
          C.close();
        }
      } },
    ]);
  }

  function canDeleteAll(msg) {
    const chat = activeChat();
    if (!chat || ['CALL', 'SYSTEM'].includes(msg.kind)) return false;
    return chat.type === 'direct' || msg.outgoing;
  }

  /** Вставити з буфера обміну: файли → вікно підтвердження, зображення → вікно підтвердження, текст → у поле. */
  async function pasteFromClipboard() {
    if (!activeChat()) return;
    const r = await api.readClipboard();
    if (r && r.files && r.files.length) return confirmAttach(r.files);
    if (r && r.image) return confirmAttach([r.image], { temp: r.image });
    if (r && r.text) {
      const ta = document.getElementById('msgInput');
      if (ta) {
        ta.value += r.text;
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }
      return;
    }
    U.toast(t('clipEmpty'));
  }
  C.paste = pasteFromClipboard;

  async function saveAs(msg) {
    const r = await api.saveAs(msg.file.path, msg.file.name);
    if (r && r.ok) U.toast(t('savedTo', { path: r.path }));
    else if (r && r.error) U.toast(t('fileMissing'), 'error');
  }

  async function deleteForAll(msg) {
    if (!(await U.confirmBox(t('confirmDeleteAll'), t('del')))) return;
    const r = await api.deleteForAll(S.ui.activeChatId, msg.id);
    if (r && r.ok) U.toast(t('deletedAll'));
  }

  function messageMenu(msg, x, y) {
    const items = [];
    const priv = !!msg.private;
    const gone = msg.file && msg.file.deleted;
    const hasFile = !!(msg.file && !gone);
    if (!priv) {
      if (msg.kind === 'TEXT' && msg.text) {
        items.push({ icon: 'copy', label: t('copy'), onClick: () => navigator.clipboard.writeText(msg.text).then(() => U.toast(t('copied'))) });
      }
      if (hasFile) {
        items.push({ icon: 'copy', label: t('copy'), onClick: async () => {
          if (await api.copyFile(msg.file.path, msg.kind === 'PHOTO')) U.toast(t('fileCopied'));
        } });
        if (msg.text) items.push({ icon: 'copy', label: t('copyCaption'), onClick: () => navigator.clipboard.writeText(msg.text).then(() => U.toast(t('copied'))) });
      }
    }
    items.push({ icon: 'paste', label: t('paste'), onClick: pasteFromClipboard });
    if (!priv && !gone && ['TEXT', 'PHOTO', 'AUDIO', 'VIDEO', 'FILE'].includes(msg.kind)) items.push({ icon: 'forward', label: t('forward'), onClick: () => forwardModal(msg) });
    if (!priv && hasFile) {
      items.push({ icon: 'saveAs', label: t('saveAs'), onClick: () => saveAs(msg) });
      items.push({ icon: 'openExternal', label: t('open'), onClick: () => openFile(msg) });
      items.push({ icon: 'folder', label: t('showInFolder'), onClick: () => api.showItem(msg.file.path) });
    }
    if (msg.outgoing && msg.status === 'failed') items.push({ icon: 'refresh', label: t('retry'), onClick: () => api.retryMessage(S.ui.activeChatId, msg.id) });
    items.push('-');
    items.push({ icon: 'trash', label: t('deleteForMe'), danger: true, onClick: async () => {
      if (await U.confirmBox(t('confirmDeleteMsg'), t('del'))) api.deleteMessage(S.ui.activeChatId, msg.id);
    } });
    if (canDeleteAll(msg)) items.push({ icon: 'deleteAll', label: t('deleteForAll'), danger: true, onClick: () => deleteForAll(msg) });
    U.menu(x, y, items);
  }

  async function openFile(msg) {
    const r = await api.openPath(msg.file.path);
    if (r === 'missing') U.toast(t('fileMissing'), 'error');
  }

  // ---------- дії (кліки) ----------

  C.ACTIONS = {
    chatBack: () => C.close(),
    chatInfo: () => {
      const chat = activeChat();
      if (!chat) return;
      if (chat.type === 'direct') PL.app.deviceInfoModal(chat.id);
      else if (chat.type === 'group') membersModal(chat);
      else PL.app.setTab('contacts');
    },
    chatCall: () => {
      const chat = activeChat();
      if (chat && chat.type === 'direct') PL.call.start(chat.id);
    },
    chatVideoCall: () => {
      const chat = activeChat();
      if (chat && chat.type === 'direct') PL.call.start(chat.id, { video: true });
    },
    chatMenu: (el) => chatMenu(el),
    attach: async () => {
      const paths = await api.pickFiles();
      if (Array.isArray(paths) && paths.length) confirmAttach(paths);
    },
    ttlMenu: (el) => ttlMenu(el),
    voiceCancel,
    voicePause,
    voicePreview,
    voiceSend,
    sendText,
    openPrivate: async (el) => {
      const chatId = S.ui.activeChatId;
      const r = await api.openPrivate(chatId, el.dataset.id);
      if (r && r.id) C.onUpdate(chatId, r);
    },
    playVoice: (el) => PL.media.toggleVoice(findMsg(el.dataset.id)),
    seekVoice: (el, e) => {
      const r = el.getBoundingClientRect();
      PL.media.toggleVoice(findMsg(el.dataset.id), Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    },
    playAudioFile: (el) => PL.media.toggleAudioFile(findMsg(el.dataset.id)),
    seekAudioFile: (el, e) => {
      const r = el.getBoundingClientRect();
      PL.media.toggleAudioFile(findMsg(el.dataset.id), Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    },
    playVnote: (el) => PL.media.toggleVnote(el),
    viewPhoto: (el) => {
      const m = findMsg(el.dataset.id);
      if (m && m.file) lightbox(m);
    },
    openFile: (el) => {
      const m = findMsg(el.dataset.id);
      if (m && m.file) openFile(m);
    },
    msgForward: (el) => {
      const m = findMsg(el.dataset.id);
      if (m) forwardModal(m);
    },
    msgRetry: (el) => api.retryMessage(S.ui.activeChatId, el.dataset.id),
  };

  // для автотесту й гарячих клавіш
  C.startVoice = voiceStart;
  C.startVideo = videoNote;
  C.toggleMode = toggleMode;
  C.recording = () => (voice ? { paused: voice.ctl.paused, elapsed: voice.ctl.elapsed() } : null);
  C.mode = () => recMode;

  document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('#msgInner .msg, #msgInner .msg-system');
    const m = el && findMsg(el.dataset.id);
    if (m) {
      e.preventDefault();
      messageMenu(m, e.clientX, e.clientY);
    } else if (e.target.closest('#messages')) {
      // правий клік на вільному місці чату — «Вставити»
      e.preventDefault();
      U.menu(e.clientX, e.clientY, [{ icon: 'paste', label: t('paste'), onClick: pasteFromClipboard }]);
    }
  });

  // ---------- перетягування файлів ----------

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !activeChat()) return;
    dragDepth += 1;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (!activeChat() || !e.dataTransfer) return;
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) confirmAttach(paths);
  });

  // ---------- події ----------

  C.onNew = (chatId, msg) => {
    const arr = cache[chatId];
    if (arr) {
      if (arr.some((m) => m.id === msg.id)) return;
      arr.push(msg);
    }
    if (chatId === S.ui.activeChatId) {
      const inner = document.getElementById('msgInner');
      const list = cache[chatId] || [];
      if (inner) {
        const stick = msg.outgoing || stuck;
        if (list.length <= 1 || inner.querySelector('.chat-empty')) {
          renderMessages();
        } else {
          const prev = list[list.length - 2];
          let html = '';
          if (!prev || !U.sameDay(prev.timestamp, msg.timestamp)) html += `<div class="day-sep"><span>${esc(U.dayLabel(msg.timestamp))}</span></div>`;
          html += msgHtml(msg, activeChat(), prev && U.sameDay(prev.timestamp, msg.timestamp) ? prev : null);
          inner.insertAdjacentHTML('beforeend', html);
          watchMedia(inner);
          updateProtection();
        }
        if (stick) scrollBottom();
      }
    }
    PL.app.scheduleUpdate('lists', 'nav');
  };

  C.onUpdate = (chatId, msg) => {
    const arr = cache[chatId];
    let full = msg;
    if (arr) {
      const i = arr.findIndex((m) => m.id === msg.id);
      if (i >= 0) full = Object.assign(arr[i], msg);
    }
    if (chatId !== S.ui.activeChatId) return;
    const el = document.querySelector(`#msgInner .msg[data-id="${CSS.escape(msg.id)}"]`);
    if (!el) return;
    if (PL.media.isPlaying(msg.id) || el.querySelector('.vnote.playing')) {
      el.querySelectorAll('.tick').forEach((n) => {
        n.outerHTML = statusHtml(full);
      });
      return;
    }
    const list = cache[chatId] || [];
    const idx = list.findIndex((m) => m.id === msg.id);
    const prev = idx > 0 ? list[idx - 1] : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = msgHtml(full, activeChat(), prev && U.sameDay(prev.timestamp, full.timestamp) ? prev : null).trim();
    if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
    watchMedia(document.getElementById('msgInner'));
    updateProtection();
  };

  C.onDeleted = (chatId, messageId) => {
    const arr = cache[chatId];
    if (arr) {
      const i = arr.findIndex((m) => m.id === messageId);
      if (i >= 0) arr.splice(i, 1);
    }
    if (chatId !== S.ui.activeChatId) return;
    const el = document.querySelector(`#msgInner .msg[data-id="${CSS.escape(messageId)}"]`);
    if (el && (cache[chatId] || []).length) el.remove();
    else renderMessages();
    updateProtection();
  };

  C.sendFile = sendFile;
  C.ttlLabel = ttlLabel;
})();
