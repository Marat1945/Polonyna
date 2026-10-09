'use strict';
// Допоміжні функції інтерфейсу: екранування, формати, іконки, аватари, сповіщення, вікна, меню.
(function () {
  const PL = (window.PL = window.PL || {});
  const { t } = PL.i18n;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fileUrl(p) {
    if (!p) return '';
    let s = String(p).replace(/\\/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + s.split('/').map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
  }

  function ic(name, size = 24, cls = '') {
    const d = window.PL_ICONS[name];
    if (!d) return '';
    return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  const pad = (n) => String(n).padStart(2, '0');

  function timeHM(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function sameDay(a, b) {
    const x = new Date(a);
    const y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  function chatTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    if (sameDay(ts, now)) return timeHM(ts);
    if (sameDay(ts, now - 86400000)) return t('yesterday');
    if (now - ts < 6 * 86400000) return new Date(ts).toLocaleDateString(PL.i18n.lang, { weekday: 'short' });
    return new Date(ts).toLocaleDateString(PL.i18n.lang, { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function dayLabel(ts) {
    const now = Date.now();
    if (sameDay(ts, now)) return t('today');
    if (sameDay(ts, now - 86400000)) return t('yesterday');
    const d = new Date(ts);
    const opts = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(PL.i18n.lang, opts);
  }

  function duration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function size(bytes) {
    const u = PL.i18n.lang === 'en' ? ['B', 'KB', 'MB', 'GB'] : PL.i18n.lang === 'pl' ? ['B', 'KB', 'MB', 'GB'] : ['Б', 'КБ', 'МБ', 'ГБ'];
    let i = 0;
    let n = bytes || 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
  }

  function hash(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) | 0;
    return Math.abs(h);
  }

  const PALETTE = ['#2D8EFB', '#7C7DE7', '#22B35E', '#F59E0B', '#E8578F', '#14A3A0', '#8C5CF2', '#F2784B'];
  const colorFor = (id) => PALETTE[hash(id) % PALETTE.length];

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const a = parts[0] ? Array.from(parts[0])[0] : '?';
    const b = parts[1] ? Array.from(parts[1])[0] : '';
    return (a + b).toUpperCase();
  }

  /**
   * Аватар. kind: 'contact' | 'self' | 'group' | 'lan'
   * dot: 'on' | 'off' | '' — зелена/сіра крапка статусу
   */
  function avatar({ kind, id, name, file, size: sz = 52, dot = '' }) {
    let inner;
    if (kind === 'lan') {
      inner = `<span class="av-fill av-lan">${ic('wifi', Math.round(sz * 0.5))}</span>`;
    } else if (file) {
      inner = `<img class="av-img" src="${esc(fileUrl(file))}" alt="" draggable="false">`;
    } else if (kind === 'group') {
      inner = `<span class="av-fill av-group">${ic('group', Math.round(sz * 0.5))}</span>`;
    } else {
      inner = `<span class="av-fill" style="background:${colorFor(id || name)}"><b style="font-size:${Math.round(sz * 0.36)}px">${esc(initials(name))}</b></span>`;
    }
    const d = dot ? `<span class="av-dot ${dot}"></span>` : '';
    return `<span class="avatar" style="width:${sz}px;height:${sz}px">${inner}${d}</span>`;
  }

  // ---------- короткі сповіщення ----------
  let toastTimer = null;
  function toast(text, kind = '') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.className = 'toast show ' + kind;
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- модальні вікна ----------
  const modals = [];
  function modal({ title, body, actions = [], wide = false, onMount, onClose, cls = '' }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true">
        ${title ? `<div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-modal-close title="${esc(t('close'))}">${ic('close', 22)}</button></div>` : ''}
        <div class="modal-body">${body || ''}</div>
        ${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-modal-action="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    const api = {
      el: wrap.querySelector('.modal'),
      close() {
        if (!wrap.isConnected) return;
        wrap.remove();
        const i = modals.indexOf(api);
        if (i >= 0) modals.splice(i, 1);
        if (onClose) onClose();
      },
    };
    modals.push(api);
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) api.close();
    });
    wrap.addEventListener('click', async (e) => {
      if (e.target.closest('[data-modal-close]')) return api.close();
      const b = e.target.closest('[data-modal-action]');
      if (b) {
        const a = actions[Number(b.dataset.modalAction)];
        const keep = a && a.onClick ? await a.onClick(api) : false;
        if (keep !== true) api.close();
      }
    });
    requestAnimationFrame(() => wrap.classList.add('open'));
    if (onMount) onMount(api);
    const first = wrap.querySelector('input:not([type=checkbox]), textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return api;
  }

  function confirmBox(text, okLabel, danger = true) {
    return new Promise((resolve) => {
      let answered = false;
      modal({
        body: `<p class="confirm-text">${esc(text)}</p>`,
        actions: [
          { label: t('cancel'), cls: 'ghost', onClick: () => { answered = true; resolve(false); } },
          { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
        ],
        onClose: () => { if (!answered) resolve(false); },
      });
    });
  }

  // ---------- випадаюче меню ----------
  let menuEl = null;
  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }
  function menu(x, y, items) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'popup-menu';
    menuEl.innerHTML = items
      .filter(Boolean)
      .map((it, i) => (it === '-' ? '<div class="pm-sep"></div>' : `<button class="pm-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? ic(it.icon, 20) : ''}<span>${esc(it.label)}</span></button>`))
      .join('');
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 8);
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    menuEl.style.left = Math.max(8, left) + 'px';
    menuEl.style.top = top + 'px';
    const list = items.filter(Boolean);
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('.pm-item');
      if (!b) return;
      const it = list[Number(b.dataset.i)];
      closeMenu();
      if (it && it.onClick) it.onClick();
    });
  }
  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuEl) return closeMenu();
    const top = modals[modals.length - 1];
    if (top) top.close();
  });

  function deviceLabel(c) {
    const type = { computer: t('deviceComputer'), laptop: t('deviceLaptop'), tablet: t('deviceTablet'), phone: t('devicePhone') }[c && c.deviceType] || '';
    return [type, c && c.os].filter(Boolean).join(' • ');
  }

  function uuid() {
    return crypto.randomUUID();
  }

  PL.util = {
    esc, fileUrl, ic, timeHM, sameDay, chatTime, dayLabel, duration, size, hash, colorFor, initials, avatar,
    toast, modal, confirmBox, menu, closeMenu, deviceLabel, uuid,
    get openModals() { return modals.length; },
  };
})();
