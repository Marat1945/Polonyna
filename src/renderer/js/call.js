'use strict';
// Голосові та відеодзвінки в локальній мережі (WebRTC без інтернету; сигнали йдуть через TCP Полонини).
(function () {
  const PL = window.PL;
  const api = window.pl;
  const { t } = PL.i18n;
  const U = PL.util;
  const { esc, ic } = U;
  const S = PL.state;
  const CL = (PL.call = {});
  let st = null;

  const remoteAudio = () => document.getElementById('remoteAudio');
  const nameOf = (id, fallback) => (S.contacts[id] && S.contacts[id].name) || fallback || t('unknownDevice');

  // ---------- вікно дзвінка (відео-елементи живуть увесь дзвінок, оновлюються лише написи й кнопки) ----------

  function overlay(my) {
    if (my.el && my.el.isConnected) return my.el;
    const old = document.getElementById('callOverlay');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'callOverlay';
    el.innerHTML = `
      <div class="call-stage"><video class="rv" autoplay playsinline muted></video><video class="lv" autoplay playsinline muted></video></div>
      <div class="call-card">
        <div class="call-avatar"></div>
        <h2 class="call-name"></h2>
        <div class="call-status" id="callStatus"></div>
      </div>
      <div class="call-actions"></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-call]');
      if (!b) return;
      const a = b.dataset.call;
      if (a === 'accept') accept();
      else if (a === 'decline') decline();
      else if (a === 'hangup') hangup();
      else if (a === 'mute') toggleMute();
      else if (a === 'cam') toggleCam();
    });
    my.el = el;
    return el;
  }

  function statusText(my) {
    switch (my.phase) {
      case 'incoming': return my.video ? t('incomingVideoCall') : t('incomingCall');
      case 'calling': return t('ringing');
      case 'connecting': return t('connecting');
      case 'active': return U.duration((Date.now() - my.activeAt) / 1000);
      default: return my.endText || t('callEnded');
    }
  }

  function render() {
    const my = st;
    if (!my) {
      const el = document.getElementById('callOverlay');
      if (el) el.remove();
      return;
    }
    const el = overlay(my);
    const c = S.contacts[my.peerId] || {};
    el.className = ['call-overlay', `phase-${my.phase}`, my.video ? 'is-video' : '', my.hasRemoteVideo ? 'has-rv' : '', my.hasLocalVideo ? 'has-lv' : '', my.camOff ? 'cam-off' : ''].join(' ');
    el.querySelector('.call-avatar').innerHTML = `${U.avatar({ kind: 'contact', id: my.peerId, name: c.name || my.peerName, file: c.avatarFile, size: 136 })}<span class="ring r1"></span><span class="ring r2"></span>`;
    el.querySelector('.call-name').textContent = nameOf(my.peerId, my.peerName);
    el.querySelector('.call-status').textContent = statusText(my);
    let actions = '';
    if (my.phase === 'incoming') {
      actions = `
        <button class="call-act decline" data-call="decline">${ic('hangup', 30)}<span>${esc(t('decline'))}</span></button>
        <button class="call-act accept" data-call="accept">${ic(my.video ? 'video' : 'phone', 30)}<span>${esc(t('accept'))}</span></button>`;
    } else if (my.phase !== 'ended') {
      actions = `
        <button class="call-act mute ${my.muted ? 'on' : ''}" data-call="mute">${ic(my.muted ? 'micOff' : 'mic', 30)}<span>${esc(t('micMute'))}</span></button>
        ${my.video && my.hasLocalVideo ? `<button class="call-act cam ${my.camOff ? 'on' : ''}" data-call="cam">${ic(my.camOff ? 'videoOff' : 'video', 30)}<span>${esc(t('camToggle'))}</span></button>` : ''}
        <button class="call-act decline" data-call="hangup">${ic('hangup', 30)}<span>${esc(t('endCall'))}</span></button>`;
    }
    el.querySelector('.call-actions').innerHTML = actions;
  }

  // ---------- медіа ----------

  async function getMedia(my) {
    const audio = await PL.media.getAudio(); // якщо мікрофона немає — помилка з поясненням
    if (!my.video) return audio;
    try {
      const v = await PL.media.getVideo();
      my.hasLocalVideo = true;
      return new MediaStream([...audio.getTracks(), ...v.getTracks()]);
    } catch {
      U.toast(t('camUnavailableCall'));
      return audio;
    }
  }

  function showLocal(my) {
    const lv = my.el && my.el.querySelector('.lv');
    if (lv && my.stream && my.stream.getVideoTracks().length) {
      lv.srcObject = new MediaStream(my.stream.getVideoTracks());
      lv.play().catch(() => {});
    }
  }

  function waitIce(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(resolve, 2500);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  function stopTone(my) {
    if (my && my.stopTone) {
      my.stopTone();
      my.stopTone = null;
    }
  }

  function makePc(my) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (e.track.kind === 'video') {
        const rv = my.el && my.el.querySelector('.rv');
        if (rv) {
          rv.srcObject = stream;
          rv.play().catch(() => {});
        }
        my.hasRemoteVideo = true;
        render();
      } else {
        const a = remoteAudio();
        if (a) {
          a.srcObject = stream;
          a.play().catch(() => {});
        }
      }
    };
    pc.onconnectionstatechange = () => {
      if (st !== my || my.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(my.discTimer);
        if (my.phase !== 'active') {
          my.phase = 'active';
          my.activeAt = Date.now();
          stopTone(my);
          render();
          my.timer = setInterval(() => {
            const el = document.getElementById('callStatus');
            if (el && st === my && my.phase === 'active') el.textContent = statusText(my);
          }, 500);
        }
      } else if (s === 'failed') {
        finish('failed');
      } else if (s === 'disconnected') {
        clearTimeout(my.discTimer);
        my.discTimer = setTimeout(() => {
          if (st === my && pc.connectionState !== 'connected') finish('failed');
        }, 6000);
      }
    };
    return pc;
  }

  function finish(reason) {
    const my = st;
    if (!my || my.phase === 'ended') return;
    clearTimeout(my.ringTimer);
    clearTimeout(my.discTimer);
    clearInterval(my.timer);
    stopTone(my);
    try {
      if (my.pc) my.pc.close();
    } catch {
      /* ignore */
    }
    if (my.stream) my.stream.getTracks().forEach((tr) => tr.stop());
    const a = remoteAudio();
    if (a) a.srcObject = null;
    if (my.el) my.el.querySelectorAll('video').forEach((v) => { v.srcObject = null; });
    my.hasRemoteVideo = false;
    my.hasLocalVideo = false;
    const duration = my.activeAt ? (Date.now() - my.activeAt) / 1000 : 0;
    let result;
    if (my.activeAt) result = 'ok';
    else if (my.direction === 'out') result = reason === 'declined' ? 'declined' : reason === 'busy' ? 'busy' : reason === 'noanswer' ? 'noanswer' : 'cancelled';
    else result = reason === 'declined' ? 'declined' : 'missed';
    if (reason !== 'mic' && reason !== 'offline') api.logCall(my.peerId, { outgoing: my.direction === 'out', result, duration, video: !!my.video });
    const texts = { busy: 'callBusy', declined: 'callDeclined', noanswer: 'callNoAnswer', offline: 'callOffline', failed: 'callFailed', mic: 'micProblemTitle', missed: 'callMissed' };
    my.phase = 'ended';
    my.endText = my.activeAt ? `${t('callEnded')} · ${U.duration(duration)}` : t(texts[reason] || 'callEnded');
    render();
    setTimeout(() => {
      if (st === my) {
        st = null;
        render();
      }
    }, reason === 'mic' ? 2500 : 1700);
  }

  // ---------- вихідний ----------

  CL.start = async (peerId, opts = {}) => {
    if (st && st.phase !== 'ended') return U.toast(t('alreadyInCall'));
    if (!PL.app.isOnline(peerId)) return U.toast(t('offlineCantCall'), 'error');
    PL.media.stopAll();
    const my = (st = { id: U.uuid(), peerId, direction: 'out', phase: 'calling', muted: false, video: !!opts.video });
    render();
    my.stopTone = PL.media.ringback();
    try {
      my.stream = await getMedia(my);
    } catch (e) {
      finish('mic');
      PL.media.deviceProblem(e);
      return;
    }
    if (st !== my) {
      my.stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    render();
    showLocal(my);
    try {
      my.pc = makePc(my);
      my.stream.getTracks().forEach((tr) => my.pc.addTrack(tr, my.stream));
      // відео від співрозмовника приймаємо навіть тоді, коли своєї камери немає
      if (my.video && !my.stream.getVideoTracks().length) my.pc.addTransceiver('video', { direction: 'recvonly' });
      await my.pc.setLocalDescription(await my.pc.createOffer());
      await waitIce(my.pc);
    } catch {
      return finish('failed');
    }
    if (st !== my) return;
    const ok = await api.callSignal(peerId, { type: 'call_offer', callId: my.id, sdp: my.pc.localDescription.sdp, video: my.video });
    if (st !== my) return;
    if (!ok) return finish('offline');
    my.ringTimer = setTimeout(() => {
      if (st === my && my.phase === 'calling') {
        api.callSignal(peerId, { type: 'call_cancel', callId: my.id });
        finish('noanswer');
      }
    }, 45000);
  };

  // ---------- вхідний ----------

  async function accept() {
    const my = st;
    if (!my || my.phase !== 'incoming') return;
    clearTimeout(my.ringTimer);
    stopTone(my);
    my.phase = 'connecting';
    render();
    try {
      my.stream = await getMedia(my);
    } catch (e) {
      api.callSignal(my.peerId, { type: 'call_reject', callId: my.id, reason: 'mic' });
      finish('mic');
      PL.media.deviceProblem(e);
      return;
    }
    if (st !== my) {
      my.stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    render();
    showLocal(my);
    try {
      my.pc = makePc(my);
      // спершу пропозиція співрозмовника, потім свої мікрофон і камера — інакше звук/відео піде лише в один бік
      await my.pc.setRemoteDescription({ type: 'offer', sdp: my.offer });
      my.stream.getTracks().forEach((tr) => my.pc.addTrack(tr, my.stream));
      await my.pc.setLocalDescription(await my.pc.createAnswer());
      await waitIce(my.pc);
    } catch {
      api.callSignal(my.peerId, { type: 'call_reject', callId: my.id, reason: 'failed' });
      return finish('failed');
    }
    if (st !== my) return;
    const ok = await api.callSignal(my.peerId, { type: 'call_answer', callId: my.id, sdp: my.pc.localDescription.sdp, video: my.video });
    if (!ok) finish('failed');
  }

  function decline() {
    if (!st) return;
    api.callSignal(st.peerId, { type: 'call_reject', callId: st.id });
    finish('declined');
  }

  function hangup() {
    if (!st) return;
    if (st.phase === 'calling') {
      api.callSignal(st.peerId, { type: 'call_cancel', callId: st.id });
      finish('cancelled');
    } else {
      api.callSignal(st.peerId, { type: 'call_end', callId: st.id });
      finish('ended');
    }
  }

  function toggleMute() {
    if (!st || !st.stream) return;
    st.muted = !st.muted;
    st.stream.getAudioTracks().forEach((tr) => {
      tr.enabled = !st.muted;
    });
    render();
  }

  function toggleCam() {
    if (!st || !st.stream) return;
    st.camOff = !st.camOff;
    st.stream.getVideoTracks().forEach((tr) => {
      tr.enabled = !st.camOff;
    });
    render();
  }

  CL.onSignal = async ({ peerId, peerName, data }) => {
    if (!data) return;
    const type = data.type;
    if (type === 'call_offer') {
      if (st && st.phase !== 'ended') {
        api.callSignal(peerId, { type: 'call_busy', callId: data.callId });
        api.logCall(peerId, { outgoing: false, result: 'missed', duration: 0, video: !!data.video });
        return;
      }
      PL.media.stopAll();
      const my = (st = { id: data.callId, peerId, peerName, direction: 'in', phase: 'incoming', offer: data.sdp, muted: false, video: !!data.video });
      my.stopTone = PL.media.ring(my.video ? 'ringVideo' : 'ring');
      render();
      my.ringTimer = setTimeout(() => {
        if (st === my && my.phase === 'incoming') finish('missed');
      }, 45000);
      return;
    }
    if (!st || st.peerId !== peerId || (data.callId && data.callId !== st.id)) return;
    const my = st;
    if (type === 'call_answer' && my.direction === 'out' && my.pc) {
      clearTimeout(my.ringTimer);
      stopTone(my);
      my.phase = 'connecting';
      render();
      try {
        await my.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      } catch {
        finish('failed');
      }
    } else if (type === 'call_reject') {
      finish('declined');
    } else if (type === 'call_busy') {
      finish('busy');
    } else if (type === 'call_cancel') {
      finish(my.direction === 'in' ? 'missed' : 'ended');
    } else if (type === 'call_end') {
      finish('ended');
    }
  };

  CL.active = () => !!st && st.phase !== 'ended';
  CL.debug = () => {
    if (!st) return null;
    const rv = st.el && st.el.querySelector('.rv');
    const lv = st.el && st.el.querySelector('.lv');
    return {
      phase: st.phase,
      direction: st.direction,
      video: !!st.video,
      pc: st.pc ? st.pc.connectionState : '',
      remoteVideo: rv ? `${rv.videoWidth}x${rv.videoHeight}` : '',
      localVideo: lv ? `${lv.videoWidth}x${lv.videoHeight}` : '',
      ringing: PL.media.isRinging(),
    };
  };
})();
