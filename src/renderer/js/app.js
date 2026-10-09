'use strict';
// Основний інтерфейс: верхня панель, нижня навігація, вкладки «Чати», «Контакти», «Налаштування», «Профіль».
(function () {
  const PL = window.PL;
  const api = window.pl;
  const { t, tp } = PL.i18n;
  const U = PL.util;
  const { esc, ic } = U;

  const S = (PL.state = {
    profile: null,
    settings: null,
    contacts: {},
    chats: {},
    peers: {},
    net: null,
    version: '',
    focused: true,
    drafts: {},
    ui: { tab: 'chats', chatFilter: 'all', chatSearch: '', contactTab: 'nearby', contactSearch: '', activeChatId: null },
  });

  // ---------- дані ----------

  const isOnline = (id) => !!(S.peers[id] && S.peers[id].online);
  const contactName = (id) => (S.contacts[id] && S.contacts[id].name) || (S.peers[id] && S.peers[id].name) || t('unknownDevice');
  const linkLabel = (type) => ({ wifi: 'Wi-Fi', cable: t('linkCable'), virtual: t('linkVirtual') }[type] || t('netLan'));

  function chatTitle(chat) {
    if (!chat) return '';
    if (chat.type === 'lan') return t('lanChat');
    if (chat.type === 'group') return chat.title || t('tabGroups');
    return contactName(chat.id);
  }

  function chatAvatar(chat, size, withDot = true) {
    if (chat.type === 'lan') return U.avatar({ kind: 'lan', size });
    if (chat.type === 'group') return U.avatar({ kind: 'group', id: chat.id, name: chat.title, size });
    const c = S.contacts[chat.id] || {};
    return U.avatar({ kind: 'contact', id: chat.id, name: c.name, file: c.avatarFile, size, dot: withDot ? (isOnline(chat.id) ? 'on' : 'off') : '' });
  }

  function systemText(msg) {
    if (msg.system && msg.system.event === 'group_created') {
      return t('sysGroupCreated', { name: msg.outgoing ? S.profile.name : msg.senderName, title: msg.system.title || '' });
    }
    return '';
  }

  function callText(call, outgoing) {
    const r = call && call.result;
    const v = !!(call && call.video);
    if (r === 'ok') return outgoing ? t(v ? 'callOutVideo' : 'callOut') : t(v ? 'callInVideo' : 'callIn');
    if (r === 'missed') return t(v ? 'callMissedVideo' : 'callMissed');
    if (r === 'declined' || r === 'rejected') return t('callRejected');
    return outgoing ? t('callCancelled') : t(v ? 'callMissedVideo' : 'callMissed');
  }

  function previewText(m) {
    if (!m) return '';
    if (m.private) return '🔥 ' + t('privTitle');
    switch (m.kind) {
      case 'PHOTO': return '📷 ' + (m.text || t('photo'));
      case 'AUDIO': return '🎤 ' + t('voice') + (m.duration ? ' ' + U.duration(m.duration) : '');
      case 'VIDEO': return '📹 ' + t('videoNote');
      case 'FILE': return '📎 ' + (m.fileName || (m.file && m.file.name) || t('file'));
      case 'SYSTEM': return systemText(m);
      case 'CALL': return '📞 ' + callText(m.call, m.outgoing) + (m.call && m.call.duration ? ' ' + U.duration(m.call.duration) : '');
      default: return m.text || '';
    }
  }

  function statusIcon(status) {
    switch (status) {
      case 'pending': return `<span class="tick pending" title="${esc(t('statusPending'))}">${ic('clock', 16)}</span>`;
      case 'sent': return `<span class="tick sent">${ic('check', 17)}</span>`;
      case 'delivered': return `<span class="tick delivered">${ic('checkAll', 17)}</span>`;
      case 'read': return `<span class="tick read">${ic('checkAll', 17)}</span>`;
      case 'failed': return `<span class="tick failed" title="${esc(t('statusFailed'))}">${ic('alert', 16)}</span>`;
      default: return '';
    }
  }

  function unreadChatsCount() {
    return Object.values(S.chats).filter((c) => (c.unread || 0) > 0 && !c.muted).length;
  }

  // ---------- оновлення по кадрах ----------

  const pending = new Set();
  let raf = 0;
  function scheduleUpdate(...parts) {
    for (const p of parts) pending.add(p);
    if (!raf) raf = requestAnimationFrame(flushUpdates);
  }
  function flushUpdates() {
    raf = 0;
    const parts = new Set(pending);
    pending.clear();
    if (parts.has('all')) return renderAll();
    if (parts.has('topbar')) renderTopbar();
    if (parts.has('nav')) renderNav();
    if (parts.has('view')) renderView();
    else if (parts.has('lists')) updateViewLists();
    if (parts.has('chatHeader')) PL.chat.renderHeader();
  }

  // ---------- каркас ----------

  function renderAll() {
    document.title = 'Полонина';
    renderTopbar();
    renderNav();
    renderView();
    PL.chat.renderPane();
    applyLayout();
  }

  function applyLayout() {
    document.body.classList.toggle('narrow', window.innerWidth < 880);
    document.body.classList.toggle('chat-open', !!S.ui.activeChatId);
  }

  function renderTopbar() {
    const net = S.net || {};
    const hasAddr = net.addresses && net.addresses.length > 0;
    let cls = 'ok';
    let l1 = t('netOffline');
    const primary = (net.addresses || []).find((a) => a.type !== 'virtual') || (net.addresses || [])[0];
    let l2 = primary ? `${linkLabel(primary.type)} · ${primary.address}` : t('netLan');
    let icon = primary && primary.type === 'cable' ? 'ethernet' : 'wifi';
    if (!S.settings.networkEnabled) {
      cls = 'off';
      l1 = t('netOff');
      l2 = '';
      icon = 'wifiOff';
    } else if (!hasAddr) {
      cls = 'off';
      l1 = t('netNoWifi');
      l2 = '';
      icon = 'wifiOff';
    }
    document.getElementById('topbar').innerHTML = `
      <button class="brand" data-act="splash" title="${esc(t('appName'))}">
        <img class="brand-emblem" src="assets/emblem.png" alt="" draggable="false">
        <span class="brand-text"><span class="brand-name">${esc(t('appName'))}</span><span class="brand-tag">${esc(t('tagline'))}</span></span>
      </button>
      <button class="net-status ${cls}" data-act="netDetails">
        <span class="ns-ic">${ic(icon, 28)}</span>
        <span class="ns-text"><b>${esc(l1)}</b>${l2 ? `<small>${esc(l2)}</small>` : ''}</span>
      </button>
      <button class="icon-btn" data-act="focusSearch" title="${esc(t('search'))}">${ic('search', 26)}</button>
      <button class="icon-btn" data-act="topMenu">${ic('more', 26)}</button>`;
  }

  function renderNav() {
    const unread = unreadChatsCount();
    const item = (tab, iconOut, iconIn, label, badge) => `
      <button class="nav-item ${S.ui.tab === tab ? 'active' : ''}" data-act="tab" data-tab="${tab}">
        <span class="nav-ic">${ic(S.ui.tab === tab ? iconIn : iconOut, 26)}${badge ? `<span class="nav-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</span>
        <span class="nav-label">${esc(label)}</span>
      </button>`;
    document.getElementById('nav').innerHTML =
      item('chats', 'chats', 'chatsFilled', t('navChats'), unread) +
      item('contacts', 'contacts', 'contactsFilled', t('navContacts'), 0) +
      item('settings', 'settings', 'settingsFilled', t('navSettings'), 0) +
      item('profile', 'profile', 'profileFilled', t('navProfile'), 0);
  }

  function renderView() {
    const v = document.getElementById('view');
    v.scrollTop = 0;
    if (S.ui.tab === 'chats') v.innerHTML = chatsViewHtml();
    else if (S.ui.tab === 'contacts') v.innerHTML = contactsViewHtml();
    else if (S.ui.tab === 'settings') {
      v.innerHTML = settingsViewHtml();
      PL.media.mountSoundsCard(document.getElementById('soundsCard'));
      PL.media.mountDevicesCard(document.getElementById('devicesCard'));
    }
    else v.innerHTML = profileViewHtml();
    updateViewLists();
  }

  function updateViewLists() {
    if (S.ui.tab === 'chats') {
      const list = document.getElementById('chatList');
      if (list) list.innerHTML = chatListHtml();
      const seg = document.getElementById('chatSegment');
      if (seg) seg.innerHTML = chatSegmentHtml();
    } else if (S.ui.tab === 'contacts') {
      const list = document.getElementById('contactList');
      if (list) list.innerHTML = contactListHtml();
      const seg = document.getElementById('contactSegment');
      if (seg) seg.innerHTML = contactSegmentHtml();
      const head = document.getElementById('contactHead');
      if (head) head.innerHTML = contactHeadHtml();
    } else if (S.ui.tab === 'settings') {
      const pc = document.getElementById('profileCard');
      if (pc) pc.outerHTML = profileCardHtml();
    } else if (S.ui.tab === 'profile') {
      const a = document.getElementById('profileAddresses');
      if (a) a.innerHTML = addressesHtml();
      const av = document.getElementById('profileAvatar');
      if (av) av.innerHTML = U.avatar({ kind: 'self', id: S.profile.id, name: S.profile.name, file: S.profile.avatarFile, size: 128 });
    }
  }

  // ---------- Чати ----------

  function chatItems() {
    const q = S.ui.chatSearch.trim().toLowerCase();
    let list = Object.values(S.chats).filter((c) => c.type === 'lan' || c.type === 'group' || c.lastMessage);
    if (S.ui.chatFilter === 'personal') list = list.filter((c) => c.type === 'direct');
    if (S.ui.chatFilter === 'groups') list = list.filter((c) => c.type !== 'direct');
    if (q) {
      list = list.filter((c) => chatTitle(c).toLowerCase().includes(q) || previewText(c.lastMessage).toLowerCase().includes(q));
    }
    return list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function chatSegmentHtml() {
    const unread = unreadChatsCount();
    const seg = (f, icon, label, badge) => `
      <button class="seg ${S.ui.chatFilter === f ? 'active' : ''}" data-act="chatFilter" data-f="${f}">
        ${ic(icon, 22)}<span>${esc(label)}</span>${badge ? `<span class="seg-badge">${badge}</span>` : ''}
      </button>`;
    return seg('all', 'chatsFilled', t('tabAll'), unread) + seg('personal', 'contacts', t('tabPersonal'), 0) + '<span class="seg-div"></span>' + seg('groups', 'group', t('tabGroups'), 0);
  }

  function chatsViewHtml() {
    return `
      <div class="search-box">${ic('search', 22)}<input id="chatSearch" type="text" placeholder="${esc(t('searchChats'))}" value="${esc(S.ui.chatSearch)}" autocomplete="off"></div>
      <div class="segment" id="chatSegment"></div>
      <div class="chat-list" id="chatList"></div>
      ${bannerHtml(t('bannerChats'))}`;
  }

  function chatRowHtml(chat) {
    const m = chat.lastMessage;
    const active = S.ui.activeChatId === chat.id ? 'active' : '';
    let preview = '';
    if (chat.type === 'lan' && !m) {
      preview = `<span class="cr-mega">${ic('megaphone', 18)}</span>${esc(t('lanChatSub'))}`;
    } else if (m) {
      let who = '';
      if (m.outgoing && chat.type !== 'direct') who = `<span class="cr-sender">${esc(t('you'))}:</span> `;
      else if (!m.outgoing && chat.type !== 'direct' && m.kind !== 'SYSTEM') who = `<span class="cr-sender">${esc(m.senderName || '')}:</span> `;
      const mega = chat.type === 'lan' ? `<span class="cr-mega">${ic('megaphone', 18)}</span>` : '';
      preview = mega + who + esc(previewText(m));
    }
    const right = [];
    if (chat.pinned) right.push(`<span class="cr-pin">${ic('pin', 18)}</span>`);
    if (chat.unread) right.push(`<span class="badge ${chat.muted ? 'muted' : ''}">${chat.unread > 999 ? '999+' : chat.unread}</span>`);
    else if (m && m.outgoing && m.kind !== 'CALL' && m.kind !== 'SYSTEM') right.push(statusIcon(m.status));
    return `
      <div class="chat-row ${active}" data-act="openChat" data-id="${esc(chat.id)}">
        ${chatAvatar(chat, 58)}
        <div class="cr-main">
          <div class="cr-top"><span class="cr-name">${esc(chatTitle(chat))}</span>${chat.muted ? `<span class="cr-muted">${ic('bell', 14)}</span>` : ''}<span class="cr-time">${m ? U.chatTime(m.timestamp) : ''}</span></div>
          <div class="cr-bottom"><span class="cr-preview">${preview}</span><span class="cr-right">${right.join('')}</span></div>
        </div>
      </div>`;
  }

  function chatListHtml() {
    const items = chatItems();
    if (!items.length) {
      return `<div class="empty-list">${S.ui.chatSearch ? esc(t('nothingFound')) : `<b>${esc(t('noChats'))}</b><span>${esc(t('noChatsHint'))}</span>`}</div>`;
    }
    return items.map(chatRowHtml).join('');
  }

  function bannerHtml(text) {
    return `
      <div class="banner">
        <span class="banner-ic">${ic('wifi', 26)}</span>
        <div class="banner-text"><b>${esc(t('bannerTitle'))}</b><span>${esc(text)}</span></div>
        <button class="outline-btn" data-act="netDetails">${esc(t('more'))}</button>
      </div>`;
  }

  // ---------- Контакти ----------

  function contactItems() {
    const q = S.ui.contactSearch.trim().toLowerCase();
    let ids;
    if (S.ui.contactTab === 'nearby') {
      ids = Object.values(S.peers).filter((p) => p.online && p.id !== S.profile.id).map((p) => p.id);
    } else {
      ids = Object.values(S.contacts).filter((c) => c.saved).map((c) => c.id);
    }
    let list = ids.map((id) => Object.assign({}, S.contacts[id] || {}, { id }));
    if (q) {
      list = list.filter((c) => [c.name, c.username, c.deviceName].some((x) => String(x || '').toLowerCase().includes(q)));
    }
    return list.sort((a, b) => (isOnline(b.id) ? 1 : 0) - (isOnline(a.id) ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || ''), PL.i18n.lang));
  }

  function contactSegmentHtml() {
    const nearby = Object.values(S.peers).filter((p) => p.online).length;
    const saved = Object.values(S.contacts).filter((c) => c.saved).length;
    const seg = (f, icon, label, n) => `
      <button class="seg ${S.ui.contactTab === f ? 'active' : ''}" data-act="contactTab" data-f="${f}">
        ${ic(icon, 22)}<span>${esc(label)}</span><span class="seg-count">${n}</span>
      </button>`;
    return seg('nearby', 'wifi', t('tabNearby'), nearby) + seg('saved', 'contacts', t('tabSaved'), saved);
  }

  function contactHeadHtml() {
    const n = contactItems().length;
    const title = S.ui.contactTab === 'nearby' ? t('devicesNearby') : t('savedContacts');
    const right = S.ui.contactTab === 'nearby'
      ? `<span class="sh-count">${esc(tp('found', n))}</span><button class="icon-btn sm" data-act="refreshPeers" title="↻">${ic('refresh', 24)}</button>`
      : '';
    return `<h3>${esc(title)}</h3><span class="sh-right">${right}</span>`;
  }

  function contactsViewHtml() {
    return `
      <div class="search-box">${ic('search', 22)}<input id="contactSearch" type="text" placeholder="${esc(t('searchContacts'))}" value="${esc(S.ui.contactSearch)}" autocomplete="off"></div>
      <div class="segment two" id="contactSegment"></div>
      ${bannerHtml(t('bannerContacts'))}
      <button class="create-group" data-act="createGroup">
        <span class="cg-ic">${ic('group', 30)}</span>
        <span class="cg-text"><b>${esc(t('createGroup'))}</b><span>${esc(t('createGroupSub'))}</span></span>
        ${ic('chevronRight', 24, 'chev')}
      </button>
      <div class="section-head" id="contactHead"></div>
      <div class="contact-list" id="contactList"></div>
      <button class="link-btn" data-act="connectIp">${ic('lan', 20)}<span>${esc(t('connectByIp'))}</span></button>`;
  }

  function signalHtml(level) {
    const l = Math.max(1, Math.min(4, level || 3));
    return `<span class="signal s${l}"><span class="bars"><i></i><i></i><i></i><i></i></span><small>${esc(t('signal' + l))}</small></span>`;
  }

  function contactRowHtml(c) {
    const online = isOnline(c.id);
    const p = S.peers[c.id] || {};
    const status = online
      ? `<span class="ct-status on">${esc(t('online'))}</span>`
      : `<span class="ct-status">${esc(t('lastSeen', { t: PL.i18n.relative(c.lastSeen || p.lastSeen) }))}</span>`;
    return `
      <div class="contact-row" data-act="openDirect" data-id="${esc(c.id)}">
        ${U.avatar({ kind: 'contact', id: c.id, name: c.name, file: c.avatarFile, size: 54, dot: online ? 'on' : 'off' })}
        <div class="ct-main">
          <div class="ct-name">${esc(c.name || t('unknownDevice'))}</div>
          ${status}
          <div class="ct-device">${esc([U.deviceLabel(c) || c.deviceName || '', online && p.link ? linkLabel(p.link) : ''].filter(Boolean).join(' · '))}${online && p.verifiedAt && p.sameSubnet ? ` <span class="ct-ok" title="${esc(t('netVerified', { ms: p.rtt }))}">${ic('checkCircle', 14)}</span>` : ''}</div>
        </div>
        ${online ? signalHtml(p.signal) : '<span class="signal-gap"></span>'}
        <button class="pill-btn blue" data-act="openDirect" data-id="${esc(c.id)}">${ic('chatBubble', 20)}<span>${esc(t('chatBtn'))}</span></button>
        <button class="pill-btn grey" data-act="callPeer" data-id="${esc(c.id)}" ${online ? '' : 'disabled'}>${ic('phone', 20)}<span>${esc(t('callBtn'))}</span></button>
      </div>`;
  }

  function contactListHtml() {
    const items = contactItems();
    if (!items.length) {
      if (S.ui.contactSearch) return `<div class="empty-list">${esc(t('nothingFound'))}</div>`;
      return S.ui.contactTab === 'nearby'
        ? `<div class="empty-list"><span class="empty-ic">${ic(S.settings.networkEnabled ? 'wifi' : 'wifiOff', 40)}</span><b>${esc(S.settings.networkEnabled ? t('noDevices') : t('netOff'))}</b><span>${esc(t('noDevicesHint'))}</span></div>`
        : `<div class="empty-list"><b>${esc(t('noSaved'))}</b><span>${esc(t('noSavedHint'))}</span></div>`;
    }
    return items.map(contactRowHtml).join('');
  }

  // ---------- Налаштування ----------

  function profileCardHtml() {
    const p = S.profile;
    const on = S.settings.networkEnabled;
    return `
      <div class="card profile-card" id="profileCard">
        <button class="pc-avatar" data-act="changeAvatar" title="${esc(t('changePhoto'))}">
          ${U.avatar({ kind: 'self', id: p.id, name: p.name, file: p.avatarFile, size: 88 })}
          <span class="pc-cam">${ic('camera', 20)}</span>
        </button>
        <div class="pc-main">
          <div class="pc-name">${esc(p.name)}</div>
          <button class="pc-user" data-act="tab" data-tab="profile">@${esc(p.username || 'user')} ${ic('chevronRight', 20)}</button>
          <button class="pc-device" data-act="editDevice">${ic(p.deviceType === 'phone' ? 'phoneDevice' : p.deviceType === 'tablet' ? 'tablet' : p.deviceType === 'laptop' ? 'laptop' : 'monitor', 22)}<span>${esc(p.deviceName)}</span>${ic('pencil', 20, 'pc-pen')}</button>
          <div class="pc-status ${on ? 'on' : ''}"><i></i>${esc(on ? t('nearbyStatus') : t('hiddenStatus'))}</div>
        </div>
        <button class="pc-qr" data-act="showQr" title="${esc(t('qrTitle'))}">${ic('qrcode', 30)}</button>
        <button class="pc-chev" data-act="tab" data-tab="profile">${ic('chevronRight', 26)}</button>
      </div>`;
  }

  function settingsViewHtml() {
    const s = S.settings;
    const langs = [['uk', 'Українська'], ['ru', 'Русский'], ['pl', 'Polski'], ['en', 'English']];
    const feature = (cls, icon, title, sub, tip) => `
      <button class="feature" data-act="tip" data-tip="${tip}">
        <span class="f-ic ${cls}">${ic(icon, 26)}</span>
        <span class="f-text"><b>${esc(title)}</b><span>${esc(sub)}</span></span>
        ${ic('chevronRight', 22, 'chev')}
      </button>`;
    return `
      <div class="settings">
        ${profileCardHtml()}
        <div class="card">
          <div class="row-head">
            <span class="circle-ic">${ic('globe', 28)}</span>
            <span class="rh-text"><b>${esc(t('langTitle'))}</b><span>${esc(t('langSub'))}</span></span>
          </div>
          <div class="chips">
            ${langs.map(([code, label]) => `<button class="chip ${s.lang === code ? 'active' : ''}" data-act="setLang" data-lang="${code}">${s.lang === code ? ic('check', 20) : ''}<span>${label}</span></button>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="row-head">
            <span class="circle-ic">${ic('wifi', 28)}</span>
            <span class="rh-text"><b>${esc(t('netTitle'))}</b><span>${esc(s.networkEnabled ? t('netSub') : t('netSubOff'))}</span></span>
            <button class="switch ${s.networkEnabled ? 'on' : ''}" data-act="toggleNet" role="switch" aria-checked="${s.networkEnabled}"><i></i></button>
          </div>
          <div class="info-box">
            <span class="ib-ic">${ic('wifi', 26)}</span>
            <span class="ib-text"><b>${esc(t('bannerTitle'))}</b><span>${esc(t('bannerChats'))}</span></span>
            <button class="outline-btn" data-act="netDetails">${esc(t('more'))}</button>
          </div>
        </div>
        <div class="card list-card">
          <button class="list-row" data-act="notifSettings">
            <span class="circle-ic">${ic('bell', 26)}</span>
            <span class="rh-text"><b>${esc(t('notifTitle'))}</b><span>${esc(t('notifSub'))}</span></span>
            ${ic('chevronRight', 24, 'chev')}
          </button>
          <button class="list-row" data-act="storageSettings">
            <span class="circle-ic purple">${ic('database', 26)}</span>
            <span class="rh-text"><b>${esc(t('storageTitle'))}</b><span>${esc(t('storageSub'))}</span></span>
            ${ic('chevronRight', 24, 'chev')}
          </button>
        </div>
        <div class="card" id="soundsCard"></div>
        <div class="card" id="devicesCard"></div>
        <div class="card">
          <div class="row-head">
            <span class="circle-ic">${ic('star', 28)}</span>
            <span class="rh-text"><b>${esc(t('featuresTitle'))}</b><span>${esc(t('featuresSub'))}</span></span>
          </div>
          <div class="features">
            ${feature('green', 'phone', t('fCalls'), t('fCallsSub'), 'tipCalls')}
            ${feature('purple', 'video', t('fVideo'), t('fVideoSub'), 'tipVideo')}
            ${feature('pink', 'mic', t('fAudio'), t('fAudioSub'), 'tipAudio')}
            ${feature('blue', 'imageFilled', t('fPhoto'), t('fPhotoSub'), 'tipPhoto')}
          </div>
        </div>
        <div class="settings-foot">${esc(t('appName'))} ${esc(S.version)} · <button class="link-inline" data-act="about">${esc(t('about'))}</button></div>
      </div>`;
  }

  // ---------- Профіль ----------

  function addressesHtml() {
    const net = S.net || {};
    const list = (net.addresses || []).map((a) => `<div class="addr"><span>${esc(a.address)}</span><small>${esc(a.name)}</small></div>`).join('');
    return list || `<div class="addr muted">${esc(S.settings.networkEnabled ? t('netNoWifi') : t('netOff'))}</div>`;
  }

  function profileViewHtml() {
    const p = S.profile;
    const types = [['computer', t('deviceComputer')], ['laptop', t('deviceLaptop')], ['tablet', t('deviceTablet')], ['phone', t('devicePhone')]];
    return `
      <div class="profile-view">
        <div class="card pv-head">
          <button class="pv-avatar" data-act="changeAvatar" id="profileAvatar">${U.avatar({ kind: 'self', id: p.id, name: p.name, file: p.avatarFile, size: 128 })}</button>
          <div class="pv-actions">
            <button class="btn primary sm" data-act="changeAvatar">${ic('camera', 18)}<span>${esc(t('changePhoto'))}</span></button>
            ${p.avatarFile ? `<button class="btn ghost sm" data-act="removeAvatar">${esc(t('removePhoto'))}</button>` : ''}
          </div>
        </div>
        <div class="card form">
          <label>${esc(t('name'))}<input id="pfName" maxlength="40" value="${esc(p.name)}"></label>
          <label>${esc(t('username'))}<span class="at-input"><i>@</i><input id="pfUser" maxlength="24" value="${esc(p.username)}"></span></label>
          <label>${esc(t('deviceName'))}<input id="pfDevice" maxlength="40" value="${esc(p.deviceName)}"></label>
          <label>${esc(t('deviceType'))}<select id="pfType">${types.map(([v, l]) => `<option value="${v}" ${p.deviceType === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <button class="btn primary" data-act="saveProfile">${esc(t('save'))}</button>
        </div>
        <div class="card">
          <div class="row-head"><span class="circle-ic">${ic('lan', 26)}</span><span class="rh-text"><b>${esc(t('myAddresses'))}</b><span>${esc(t('portLabel'))}: ${esc((S.net && S.net.tcpPort) || '—')}</span></span>
          <button class="pc-qr" data-act="showQr" title="${esc(t('qrTitle'))}">${ic('qrcode', 28)}</button></div>
          <div class="addresses" id="profileAddresses"></div>
        </div>
        <div class="settings-foot">${esc(t('appName'))} ${esc(S.version)} · <button class="link-inline" data-act="about">${esc(t('about'))}</button></div>
      </div>`;
  }

  // ---------- діалоги ----------

  async function netDetailsModal() {
    S.net = await api.netInfo();
    const draw = (net) => {
      const own = (net.addresses || []).map((a) => `
        <div class="nd-row">
          <span class="nd-ic ${esc(a.type)}">${ic(a.type === 'cable' ? 'ethernet' : a.type === 'wifi' ? 'wifi' : 'lan', 20)}</span>
          <span class="nd-main"><b>${esc(linkLabel(a.type))} · ${esc(a.address)}</b><small>${esc(t('netSubnet', { n: a.network || '' }))} · ${esc(a.name)}</small></span>
        </div>`).join('') || `<div class="nd-empty">${esc(t('netNoWifi'))}</div>`;
      const peers = Object.values(S.peers).filter((p) => p.online);
      const rows = peers.map((p) => {
        const c = S.contacts[p.id] || p;
        const ok = p.verifiedAt && p.sameSubnet;
        const state = ok
          ? `<span class="nd-state ok">${ic('checkCircle', 18)}${esc(t('netVerified', { ms: p.rtt == null ? '—' : p.rtt }))}</span>`
          : p.verifiedAt ? `<span class="nd-state warn">${esc(t('netOtherSubnet'))}</span>` : `<span class="nd-state bad">${esc(t('netNotVerified'))}</span>`;
        return `
          <div class="nd-row">
            <span class="nd-ic ${esc(p.link || 'other')}">${ic(p.link === 'cable' ? 'ethernet' : 'wifi', 20)}</span>
            <span class="nd-main"><b>${esc(c.name || p.name)}</b><small>${esc(linkLabel(p.link))} · ${esc(p.address)} · ${esc(p.sameSubnet ? t('netSameSubnet') : t('netOtherSubnet'))}</small></span>
            ${state}
          </div>`;
      }).join('') || `<div class="nd-empty">${esc(t('noDevices'))}</div>`;
      return `
        <p>${esc(t('netDetails1'))}</p>
        <p class="note">${esc(t('netCableWifi'))}</p>
        <div class="nd-title">${esc(t('netYourDevice'))}</div><div class="nd-list">${own}</div>
        <div class="nd-title">${esc(t('netDevicesList'))}</div><div class="nd-list">${rows}</div>
        <p class="note" style="margin-top:14px">${esc(t('netIsolation'))} ${esc(t('netDetails3'))}</p>
        <div class="kv"><span>${esc(t('portLabel'))}</span><b>TCP ${esc(net.tcpPort || '—')} · UDP ${esc(net.udpPort)}</b></div>`;
    };
    U.modal({
      title: t('netDetailsTitle'),
      wide: true,
      body: draw(S.net),
      actions: [
        { label: t('connectByIp'), cls: 'ghost', onClick: () => { connectIpModal(); } },
        { label: t('netCheckNow'), cls: 'ghost', onClick: async (m) => {
          const btn = m.el.querySelector('[data-modal-action="1"]');
          btn.textContent = t('netChecking');
          const r = await api.netCheck();
          S.net = r.net;
          for (const p of r.peers || []) S.peers[p.id] = p;
          m.el.querySelector('.modal-body').innerHTML = draw(r.net);
          btn.textContent = t('netCheckNow');
          scheduleUpdate('lists', 'topbar', 'chatHeader');
          return true;
        } },
        { label: t('close'), cls: 'primary' },
      ],
    });
  }

  function connectIpModal() {
    U.modal({
      title: t('connectIpTitle'),
      body: `<p>${esc(t('connectIpSub'))}</p><input id="ipInput" class="text-input" placeholder="${esc(t('ipPh'))}" autocomplete="off"><div class="form-msg" id="ipMsg"></div>`,
      actions: [
        { label: t('cancel'), cls: 'ghost' },
        {
          label: t('connect'),
          cls: 'primary',
          onClick: async (m) => {
            const input = m.el.querySelector('#ipInput');
            const msg = m.el.querySelector('#ipMsg');
            msg.textContent = '…';
            const r = await api.connectManual(input.value);
            if (r && r.ok) {
              U.toast(t('connectOk'));
              return false;
            }
            msg.textContent = r && r.reason === 'format' ? t('connectBadFormat') : t('connectFail');
            return true;
          },
        },
      ],
      onMount: (m) => {
        m.el.querySelector('#ipInput').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') m.el.querySelector('[data-modal-action="1"]').click();
        });
      },
    });
  }

  function notifModal() {
    const row = (key, title, sub) => `
      <button class="toggle-row" data-key="${key}">
        <span class="rh-text"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
        <span class="switch ${S.settings[key] ? 'on' : ''}"><i></i></span>
      </button>`;
    U.modal({
      title: t('notifTitle'),
      wide: true,
      body: row('notifications', t('notifShow'), t('notifSub')) + row('sound', t('notifSound'), '') +
        row('minimizeToTray', t('trayMode'), t('trayModeSub')) + '<div class="notif-sounds" id="notifSounds"></div>',
      actions: [{ label: t('close'), cls: 'primary' }],
      onMount: (m) => {
        // мелодії повідомлень і дзвінків — прямо тут, у «Сповіщеннях»
        PL.media.mountSoundsCard(m.el.querySelector('#notifSounds'));
        m.el.addEventListener('click', async (e) => {
          const r = e.target.closest('.toggle-row');
          if (!r) return;
          const key = r.dataset.key;
          const val = !S.settings[key];
          r.querySelector('.switch').classList.toggle('on', val);
          S.settings = await api.updateSettings({ [key]: val });
          if (key === 'sound' && val) PL.media.beep();
        });
      },
    });
  }

  async function storageModal() {
    const cats = [['photos', 'image', 'stPhotos'], ['videos', 'videoOutline', 'stVideos'], ['voice', 'mic', 'stVoice'], ['files', 'file', 'stFiles'], ['temp', 'clock', 'stTemp'], ['cache', 'database', 'stCache']];
    const draw = (st) => {
      const total = cats.reduce((sum, [k]) => sum + ((st.cats[k] && st.cats[k].bytes) || 0), 0);
      return `
        <p>${esc(t('storageSub'))}.</p>
        <div class="st-list">${cats.map(([k, icon, label]) => {
          const c = st.cats[k] || { bytes: 0, files: 0 };
          return `<label class="st-row"><input type="checkbox" value="${k}" ${c.bytes ? 'checked' : ''}><span class="st-ic">${ic(icon, 20)}</span><span class="st-name">${esc(t(label))}<small>${esc(tp('filesCount', c.files))}</small></span><b>${esc(U.size(c.bytes))}</b></label>`;
        }).join('')}</div>
        <div class="st-total"><span>${esc(t('stTotal'))}</span><b>${esc(U.size(total))}</b></div>
        <div class="kv"><span>${esc(t('storageFolder'))}</span><b class="path">${esc(st.mediaDir)}</b></div>`;
    };
    let st = await api.storageStats();
    U.modal({
      title: t('storageTitle'),
      wide: true,
      cls: 'storage-modal',
      body: draw(st),
      actions: [
        { label: t('changeFolder'), cls: 'ghost', onClick: async (m) => {
          const dir = await api.chooseMediaDir();
          if (dir) {
            S.settings.mediaDir = dir;
            st = await api.storageStats();
            m.el.querySelector('.modal-body').innerHTML = draw(st);
          }
          return true;
        } },
        { label: t('openFolder'), cls: 'ghost', onClick: () => { api.openMediaDir(); return true; } },
        { label: t('stClear'), cls: 'danger', onClick: async (m) => {
          const chosen = [...m.el.querySelectorAll('.st-row input:checked')].map((i) => i.value);
          if (!chosen.length) {
            U.toast(t('stNothing'));
            return true;
          }
          if (!(await U.confirmBox(t('stConfirm'), t('clear')))) return true;
          const r = await api.storageClear(chosen);
          U.toast(t('stFreed', { size: U.size((r && r.freed) || 0) }));
          st = await api.storageStats();
          m.el.querySelector('.modal-body').innerHTML = draw(st);
          return true;
        } },
      ],
    });
  }

  async function qrModal() {
    const net = await api.netInfo();
    S.net = net;
    const addr = (net.addresses || [])[0];
    const port = net.tcpPort || net.defaultTcpPort;
    const text = addr ? `polonyna://connect?ip=${addr.address}&port=${port}&id=${S.profile.id}` : `polonyna://id/${S.profile.id}`;
    const img = await api.makeQr(text);
    const list = (net.addresses || []).map((a) => `<code>${esc(a.address)}${port !== net.defaultTcpPort ? ':' + port : ''}</code>`).join(' ');
    U.modal({
      title: t('qrTitle'),
      body: `<div class="qr-wrap"><img src="${esc(img)}" alt="QR"></div><p class="center">${list || esc(t('netNoWifi'))}</p><p class="note center">${esc(t('qrSub'))}</p>`,
      actions: [{ label: t('close'), cls: 'primary' }],
    });
  }

  function editDeviceModal() {
    const p = S.profile;
    U.modal({
      title: t('deviceName'),
      body: `<input id="devName" class="text-input" maxlength="40" value="${esc(p.deviceName)}">`,
      actions: [
        { label: t('cancel'), cls: 'ghost' },
        { label: t('save'), cls: 'primary', onClick: async (m) => {
          const v = m.el.querySelector('#devName').value.trim();
          if (v) S.profile = await api.updateProfile({ deviceName: v });
          scheduleUpdate('lists');
        } },
      ],
    });
  }

  function createGroupModal() {
    const candidates = Object.values(S.contacts)
      .filter((c) => c.saved || isOnline(c.id))
      .sort((a, b) => (isOnline(b.id) ? 1 : 0) - (isOnline(a.id) ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    const rows = candidates.map((c) => `
      <label class="pick-row">
        <input type="checkbox" value="${esc(c.id)}">
        ${U.avatar({ kind: 'contact', id: c.id, name: c.name, file: c.avatarFile, size: 40, dot: isOnline(c.id) ? 'on' : 'off' })}
        <span class="pick-name">${esc(c.name)}<small>${esc(U.deviceLabel(c))}</small></span>
      </label>`).join('');
    U.modal({
      title: t('createGroup'),
      body: `
        <input id="groupName" class="text-input" maxlength="64" placeholder="${esc(t('groupName'))}">
        <div class="pick-title">${esc(t('groupMembers'))}</div>
        <div class="pick-list">${rows || `<div class="empty-list">${esc(t('groupNoContacts'))}</div>`}</div>
        <div class="form-msg" id="groupMsg"></div>`,
      actions: [
        { label: t('cancel'), cls: 'ghost' },
        { label: t('create'), cls: 'primary', onClick: async (m) => {
          const name = m.el.querySelector('#groupName').value.trim();
          const ids = [...m.el.querySelectorAll('.pick-row input:checked')].map((i) => i.value);
          const msg = m.el.querySelector('#groupMsg');
          if (!name) { msg.textContent = t('groupNeedName'); return true; }
          if (!ids.length) { msg.textContent = t('groupNeedMembers'); return true; }
          const chat = await api.createGroup(name, ids);
          if (chat && chat.id) {
            S.chats[chat.id] = chat;
            setTab('chats');
            openChat(chat.id);
          }
          return false;
        } },
      ],
    });
  }

  function aboutModal() {
    U.modal({
      title: t('about'),
      body: `
        <div class="about">
          <img src="assets/logo.png" alt="Полонина" class="about-logo">
          <p>${esc(t('aboutText'))}</p>
          <p class="muted">${esc(t('version'))} ${esc(S.version)} · Windows · © vanopas LTD - 2026</p>
        </div>`,
      actions: [
        { label: t('openLog'), cls: 'ghost', onClick: () => { api.openLog(); return true; } },
        { label: t('close'), cls: 'primary' },
      ],
    });
  }

  function deviceInfoModal(id) {
    const c = S.contacts[id] || {};
    const p = S.peers[id] || {};
    const online = isOnline(id);
    U.modal({
      title: t('deviceInfo'),
      body: `
        <div class="device-info">
          ${U.avatar({ kind: 'contact', id, name: c.name, file: c.avatarFile, size: 96, dot: online ? 'on' : 'off' })}
          <h3>${esc(c.name || t('unknownDevice'))}</h3>
          ${c.username ? `<div class="muted">@${esc(c.username)}</div>` : ''}
        </div>
        <div class="kv">
          <span>${esc(t('deviceName'))}</span><b>${esc(c.deviceName || '—')}</b>
          <span>${esc(t('deviceType'))}</span><b>${esc(U.deviceLabel(c) || '—')}</b>
          <span>${esc(t('ipLabel'))}</span><b>${esc(p.address || c.address || '—')}</b>
          <span>${esc(t('lastSeenLabel'))}</span><b>${esc(online ? t('online') : PL.i18n.relative(c.lastSeen || p.lastSeen))}</b>
          ${online ? `<span>${esc(t('connectionLabel'))}</span><b>${esc(linkLabel(p.link))} · ${esc(t('signal' + (p.signal || 3)))}</b>` : ''}
          ${online ? `<span>${esc(t('netYourDevice'))}</span><b>${esc(p.sameSubnet ? t('netSameSubnet') + ' ' + (p.network || '') : t('netOtherSubnet'))}${p.verifiedAt ? ' · ' + esc(t('netVerified', { ms: p.rtt })) : ''}</b>` : ''}
        </div>`,
      actions: [{ label: t('close'), cls: 'primary' }],
    });
  }

  async function changeAvatar() {
    const file = await api.pickAvatar();
    if (!file) return;
    try {
      const bytes = await PL.media.squareJpeg(U.fileUrl(file), 320);
      S.profile = await api.setAvatar(bytes);
      scheduleUpdate('lists', 'view');
    } catch {
      U.toast(t('avatarFormat'), 'error');
    }
  }

  // ---------- навігація ----------

  function setTab(tab) {
    if (S.ui.tab === tab) {
      document.getElementById('view').scrollTop = 0;
      return;
    }
    S.ui.tab = tab;
    if (tab !== 'settings') PL.media.stopDeviceTest();
    renderNav();
    renderView();
    if (document.body.classList.contains('narrow') && S.ui.activeChatId) PL.chat.close();
  }

  async function openChat(chatId) {
    if (!S.chats[chatId]) return;
    await PL.chat.open(chatId);
    applyLayout();
    scheduleUpdate('lists');
  }

  async function openDirect(peerId) {
    const chat = await api.directChat(peerId);
    if (chat && chat.id) {
      S.chats[chat.id] = chat;
      await openChat(chat.id);
    }
  }

  function topMenu(btn) {
    const r = btn.getBoundingClientRect();
    U.menu(r.right - 240, r.bottom + 6, [
      { icon: 'groupAdd', label: t('menuGroup'), onClick: createGroupModal },
      { icon: 'lan', label: t('menuConnect'), onClick: connectIpModal },
      '-',
      { icon: 'info', label: t('menuAbout'), onClick: aboutModal },
      '-',
      { icon: 'close', label: t('quitApp'), danger: true, onClick: () => api.quitApp() },
    ]);
  }

  // ---------- обробка кліків ----------

  const ACTIONS = {
    tab: (el) => setTab(el.dataset.tab),
    splash: () => api.showSplash(),
    chatFilter: (el) => { S.ui.chatFilter = el.dataset.f; updateViewLists(); },
    contactTab: (el) => { S.ui.contactTab = el.dataset.f; updateViewLists(); },
    openChat: (el) => openChat(el.dataset.id),
    openDirect: (el) => openDirect(el.dataset.id),
    callPeer: (el) => PL.call.start(el.dataset.id),
    netDetails: netDetailsModal,
    connectIp: connectIpModal,
    refreshPeers: () => { api.refreshPeers(); U.toast('↻'); },
    createGroup: createGroupModal,
    focusSearch: () => {
      if (S.ui.tab !== 'chats' && S.ui.tab !== 'contacts') setTab('chats');
      if (document.body.classList.contains('narrow') && S.ui.activeChatId) PL.chat.close();
      const input = document.getElementById(S.ui.tab === 'contacts' ? 'contactSearch' : 'chatSearch');
      if (input) input.focus();
    },
    topMenu: (el) => topMenu(el),
    setLang: async (el) => { S.settings = await api.updateSettings({ lang: el.dataset.lang }); },
    toggleNet: async () => { S.settings = await api.updateSettings({ networkEnabled: !S.settings.networkEnabled }); renderView(); renderTopbar(); },
    notifSettings: notifModal,
    storageSettings: storageModal,
    showQr: qrModal,
    editDevice: editDeviceModal,
    changeAvatar,
    removeAvatar: async () => { S.profile = await api.setAvatar(null); renderView(); },
    saveProfile: async () => {
      S.profile = await api.updateProfile({
        name: document.getElementById('pfName').value,
        username: document.getElementById('pfUser').value,
        deviceName: document.getElementById('pfDevice').value,
        deviceType: document.getElementById('pfType').value,
      });
      U.toast(t('saved'));
      renderView();
    },
    tip: (el) => U.toast(t(el.dataset.tip)),
    about: aboutModal,
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.act] || (PL.chat.ACTIONS && PL.chat.ACTIONS[el.dataset.act]);
    if (!fn) return;
    // кнопки всередині рядка не повинні відкривати сам рядок
    e.stopPropagation();
    e.preventDefault();
    fn(el, e);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'chatSearch') {
      S.ui.chatSearch = e.target.value;
      const list = document.getElementById('chatList');
      if (list) list.innerHTML = chatListHtml();
    } else if (e.target.id === 'contactSearch') {
      S.ui.contactSearch = e.target.value;
      const list = document.getElementById('contactList');
      if (list) list.innerHTML = contactListHtml();
      const head = document.getElementById('contactHead');
      if (head) head.innerHTML = contactHeadHtml();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      ACTIONS.focusSearch();
    }
  });

  window.addEventListener('resize', applyLayout);

  // ---------- події з головного процесу ----------

  function bindEvents() {
    api.on('peer', (p) => {
      S.peers[p.id] = p;
      scheduleUpdate('lists', 'chatHeader');
    });
    api.on('contact', (c) => {
      S.contacts[c.id] = c;
      scheduleUpdate('lists', 'chatHeader');
    });
    api.on('chat', (c) => {
      if (!c) return;
      S.chats[c.id] = c;
      scheduleUpdate('lists', 'nav', 'chatHeader');
    });
    api.on('chat:deleted', (id) => {
      delete S.chats[id];
      if (S.ui.activeChatId === id) PL.chat.close();
      scheduleUpdate('lists', 'nav');
    });
    api.on('message:new', ({ chatId, message }) => PL.chat.onNew(chatId, message));
    api.on('message:update', ({ chatId, message }) => PL.chat.onUpdate(chatId, message));
    api.on('message:deleted', ({ chatId, messageId }) => PL.chat.onDeleted(chatId, messageId));
    api.on('messages:refresh', (id) => PL.chat.reload(id));
    api.on('call:signal', (payload) => PL.call.onSignal(payload));
    api.on('focus', (f) => {
      S.focused = f;
      if (f && S.ui.activeChatId) api.markRead(S.ui.activeChatId);
    });
    api.on('open-chat', (id) => {
      setTab('chats');
      openChat(id);
    });
    api.on('notify', (n) => {
      if (n.sound) PL.media.beep();
      if (n.toast) U.toast(`${n.title}: ${n.body}`.slice(0, 140));
    });
    api.on('settings', (s) => {
      const langChanged = !S.settings || S.settings.lang !== s.lang;
      S.settings = s;
      if (langChanged) {
        PL.i18n.setLang(s.lang);
        renderAll();
      } else {
        scheduleUpdate('topbar', 'lists');
      }
    });
    api.on('profile', (p) => {
      S.profile = p;
      scheduleUpdate('lists');
    });
    api.on('net', (n) => {
      S.net = n;
      scheduleUpdate('topbar', 'lists');
    });
  }

  async function init() {
    const st = await api.getState();
    S.profile = st.profile;
    S.settings = st.settings;
    S.contacts = st.contacts || {};
    S.chats = st.chats || {};
    S.net = st.net;
    S.version = st.version;
    S.focused = st.focused;
    for (const p of st.peers || []) S.peers[p.id] = p;
    PL.i18n.setLang(S.settings.lang);
    bindEvents();
    renderAll();
    // відомості про мережу оновлюємо періодично (адреси можуть змінитися)
    setInterval(async () => {
      S.net = await api.netInfo();
      scheduleUpdate('topbar');
      if (S.ui.tab === 'contacts') scheduleUpdate('lists');
    }, 15000);
    document.body.classList.add('ready');
  }

  PL.app = {
    init, renderAll, scheduleUpdate, chatTitle, chatAvatar, contactName, previewText, systemText, callText,
    statusIcon, isOnline, openChat, openDirect, setTab, applyLayout, deviceInfoModal,
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => {
      console.error(e);
      document.getElementById('app').innerHTML = `<pre class="fatal">${esc(e && e.stack)}</pre>`;
    });
  });
})();
