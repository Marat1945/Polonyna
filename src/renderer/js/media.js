'use strict';
// Звук, запис голосових і відеокружечків, відтворення.
(function () {
  const PL = window.PL;
  const U = PL.util;
  const { t } = PL.i18n;
  const { esc, ic } = U;
  const M = (PL.media = {});

  let actx = null;
  function ctx() {
    if (!actx) actx = new AudioContext();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }

  function tone(freqs, at, len, vol = 0.14) {
    const c = ctx();
    for (const f of freqs) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
      g.gain.setValueAtTime(vol, at + Math.max(0.03, len - 0.06));
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g).connect(c.destination);
      o.start(at);
      o.stop(at + len + 0.03);
    }
  }

  // ---------- звуки: стандартні (з програми) або власні mp3 ----------

  const api = window.pl;
  const DEFAULT_SOUNDS = { message: 'assets/sounds/message.mp3', ring: 'assets/sounds/ring.mp3', ringVideo: 'assets/sounds/ring-video.mp3', ringback: '' };
  const customSound = (kind) => {
    const s = PL.state.settings && PL.state.settings.sounds;
    return s && s[kind] && s[kind].path ? s[kind] : null;
  };
  const soundUrl = (kind) => {
    const own = customSound(kind);
    return own ? U.fileUrl(own.path) : DEFAULT_SOUNDS[kind] || '';
  };

  function synthBeep() {
    try {
      const now = ctx().currentTime;
      tone([880], now, 0.12, 0.16);
      tone([1318.5], now + 0.1, 0.16, 0.16);
    } catch {
      /* без звуку */
    }
  }

  function synthLoop(kind) {
    let stopped = false;
    let timer = 0;
    const play = () => {
      if (stopped) return;
      const now = ctx().currentTime;
      if (kind === 'ring') {
        tone([523.25, 659.25], now, 0.35, 0.22);
        tone([523.25, 659.25], now + 0.5, 0.35, 0.22);
        timer = setTimeout(play, 2400);
      } else {
        tone([425], now, 1.0, 0.16);
        timer = setTimeout(play, 5000);
      }
    };
    play();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  let msgAudio = null;
  /** Звук нового повідомлення. */
  M.beep = () => {
    const url = soundUrl('message');
    if (msgAudio) msgAudio.pause();
    const a = (msgAudio = new Audio(url));
    a.volume = 1;
    a.play().catch(() => synthBeep());
    setTimeout(() => a.pause(), 6000);
  };

  let ringing = null;
  /** Мелодія вхідного дзвінка: 'ring' — аудіо, 'ringVideo' — відео. Грає по колу до відповіді. Повертає функцію зупинки. */
  M.ring = (kind) => {
    const a = new Audio(soundUrl(kind) || DEFAULT_SOUNDS.ring);
    a.loop = true;
    a.volume = 1;
    let fallback = null;
    a.play().catch(() => {
      fallback = synthLoop('ring');
    });
    ringing = a;
    return () => {
      a.pause();
      a.removeAttribute('src');
      if (fallback) fallback();
      if (ringing === a) ringing = null;
    };
  };
  M.isRinging = () => !!ringing;

  /** Гудки для того, хто телефонує: власний файл або стандартні гудки. */
  M.ringback = () => {
    const own = customSound('ringback');
    if (!own) return synthLoop('back');
    const a = new Audio(U.fileUrl(own.path));
    a.loop = true;
    a.play().catch(() => {});
    return () => {
      a.pause();
      a.removeAttribute('src');
    };
  };

  M.tones = (kind) => (kind === 'ring' ? M.ring('ring') : M.ringback());

  let preview = null;
  /** Прослухати звук у налаштуваннях (до 6 с); повторне натискання зупиняє. */
  M.previewSound = (kind, onEnd) => {
    if (preview) {
      const p = preview;
      preview = null;
      p.stop();
      if (p.kind === kind) return null;
    }
    let stop;
    if (kind === 'ringback' && !customSound('ringback')) stop = synthLoop('back');
    else {
      const a = new Audio(soundUrl(kind));
      a.play().catch(() => {});
      stop = () => a.pause();
    }
    const timer = setTimeout(() => {
      if (preview && preview.stop === stop) {
        preview = null;
        stop();
        if (onEnd) onEnd();
      }
    }, 6000);
    preview = { kind, stop: () => { clearTimeout(timer); stop(); } };
    return kind;
  };
  M.previewKind = () => (preview ? preview.kind : '');

  function pickMime(list) {
    if (!window.MediaRecorder) return '';
    for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  function mediaError(e, kind) {
    const name = e && e.name;
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return kind === 'video' ? 'noCamera' : 'noMic';
    return kind === 'video' ? 'camDenied' : 'micDenied';
  }

  M.waveformFrom = (audio, n = 48) => {
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / n));
    const out = [];
    let max = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const s = i * step;
      const e = Math.min(data.length, s + step);
      for (let j = s; j < e; j++) sum += data[j] * data[j];
      const rms = Math.sqrt(sum / Math.max(1, e - s));
      out.push(rms);
      max = Math.max(max, rms);
    }
    return out.map((v) => Math.round((max ? v / max : 0) * 31));
  };

  M.waveformFromLevels = (levels, n = 48) => {
    if (!levels.length) return Array.from({ length: n }, () => 2);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * levels.length) / n);
      const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
      out.push(Math.round(Math.max(...levels.slice(a, b)) * 31));
    }
    return out;
  };

  /** Таймер «0:06,30» як у Telegram. */
  M.clock = (sec) => {
    const s = Math.max(0, sec || 0);
    const whole = Math.floor(s);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')},${String(Math.floor((s - whole) * 100)).padStart(2, '0')}`;
  };

  // ---------- запис голосового (з паузою) ----------

  /**
   * Почати запис голосового. Повертає керування:
   * pause(), resume(), paused, elapsed(), levels, snapshot() → Blob записаного, stop() → результат, cancel().
   */
  M.startVoice = async () => {
    const stream = await M.getAudio();
    const mime = pickMime(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    const chunks = [];
    let dataWaiters = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
      const w = dataWaiters;
      dataWaiters = [];
      w.forEach((fn) => fn());
    };
    const c = ctx();
    const src = c.createMediaStreamSource(stream);
    const an = c.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let acc = 0;
    let since = performance.now();
    let raf = 0;
    let lastPush = 0;
    const type = () => rec.mimeType || mime || 'audio/webm';
    const ctl = {
      paused: false,
      levels: [],
      level: 0,
      elapsed: () => (acc + (ctl.paused ? 0 : performance.now() - since)) / 1000,
      pause() {
        if (ctl.paused || rec.state !== 'recording') return;
        rec.pause();
        acc += performance.now() - since;
        ctl.paused = true;
      },
      resume() {
        if (!ctl.paused || rec.state !== 'paused') return;
        rec.resume();
        since = performance.now();
        ctl.paused = false;
      },
      snapshot: () =>
        new Promise((resolve) => {
          if (rec.state === 'inactive') return resolve(new Blob(chunks, { type: type() }));
          dataWaiters.push(() => resolve(new Blob(chunks, { type: type() })));
          try {
            rec.requestData();
          } catch {
            resolve(new Blob(chunks, { type: type() }));
          }
        }),
      stop: () =>
        new Promise((resolve) => {
          cancelAnimationFrame(raf);
          const duration0 = ctl.elapsed();
          rec.onstop = async () => {
            stream.getTracks().forEach((tr) => tr.stop());
            try {
              src.disconnect();
            } catch {
              /* ignore */
            }
            const blob = new Blob(chunks, { type: type() });
            let duration = duration0;
            let waveform = null;
            try {
              const audio = await ctx().decodeAudioData((await blob.arrayBuffer()).slice(0));
              if (audio.duration && Number.isFinite(audio.duration)) duration = audio.duration;
              waveform = M.waveformFrom(audio);
            } catch {
              waveform = M.waveformFromLevels(ctl.levels);
            }
            resolve({ blob, mime: blob.type, duration, waveform });
          };
          try {
            rec.stop();
          } catch {
            resolve(null);
          }
        }),
      cancel() {
        cancelAnimationFrame(raf);
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
        stream.getTracks().forEach((tr) => tr.stop());
        try {
          src.disconnect();
        } catch {
          /* ignore */
        }
      },
    };
    const loop = (now) => {
      if (!ctl.paused) {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        ctl.level = Math.min(1, peak / 90);
        if (!lastPush || now - lastPush > 60) {
          ctl.levels.push(ctl.level);
          lastPush = now;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    rec.start(250);
    return ctl;
  };

  // ---------- відтворення голосових і аудіофайлів ----------

  const player = new Audio();
  player.preload = 'auto';
  let playing = null; // { id, duration, kind: 'voice' | 'afile' }

  const msgEl = (id) => document.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);

  function paint() {
    if (!playing) return;
    const el = msgEl(playing.id);
    if (!el) return;
    const dur = playing.duration || (Number.isFinite(player.duration) ? player.duration : 0);
    const p = dur ? Math.min(1, player.currentTime / dur) : 0;
    const btn = el.querySelector('.vplay');
    if (btn) btn.innerHTML = ic(player.paused ? 'play' : 'pause', 30);
    if (playing.kind === 'voice') {
      const bars = el.querySelectorAll('.vwave i');
      const k = Math.round(p * bars.length);
      bars.forEach((b, i) => b.classList.toggle('on', i < k));
      const d = el.querySelector('.vdur');
      if (d) d.textContent = U.duration(player.currentTime || dur);
    } else {
      const bar = el.querySelector('.afile-bar i');
      if (bar) bar.style.width = `${(p * 100).toFixed(1)}%`;
      const tm = el.querySelector('.afile-time');
      if (tm) tm.textContent = `${U.duration(player.currentTime)} / ${U.duration(dur)}`;
    }
  }

  function reset(p) {
    const el = p && msgEl(p.id);
    if (!el) return;
    el.querySelectorAll('.vwave i').forEach((b) => b.classList.remove('on'));
    const btn = el.querySelector('.vplay');
    if (btn) btn.innerHTML = ic('play', 30);
    const d = el.querySelector('.vdur');
    if (d) d.textContent = U.duration(p.duration);
    const bar = el.querySelector('.afile-bar i');
    if (bar) bar.style.width = '0%';
  }

  function loop() {
    paint();
    if (playing && !player.paused) requestAnimationFrame(loop);
  }

  player.addEventListener('loadedmetadata', () => {
    if (playing && !playing.duration && Number.isFinite(player.duration)) playing.duration = player.duration;
  });
  player.addEventListener('ended', () => {
    const p = playing;
    playing = null;
    reset(p);
  });
  player.addEventListener('error', () => {
    if (playing) U.toast(t('fileMissing'), 'error');
  });

  function toggle(msg, kind, ratio) {
    if (!msg || !msg.file || msg.file.deleted) return;
    if (playing && playing.id === msg.id) {
      if (ratio != null) {
        const dur = playing.duration || player.duration || 0;
        if (dur) player.currentTime = ratio * dur;
        if (player.paused) player.play().catch(() => {});
      } else if (player.paused) {
        player.play().catch(() => {});
      } else {
        player.pause();
      }
      paint();
      requestAnimationFrame(loop);
      return;
    }
    M.stopAll();
    playing = { id: msg.id, duration: msg.duration || 0, kind };
    player.src = U.fileUrl(msg.file.path);
    player.currentTime = 0;
    player.play().then(() => {
      if (ratio != null && playing && playing.duration) player.currentTime = ratio * playing.duration;
      requestAnimationFrame(loop);
    }).catch(() => {});
  }

  M.toggleVoice = (msg, ratio) => toggle(msg, 'voice', ratio);
  M.toggleAudioFile = (msg, ratio) => toggle(msg, 'afile', ratio);
  M.isPlaying = (id) => !!(playing && playing.id === id && !player.paused);

  // ---------- відтворення відеокружечків ----------

  M.toggleVnote = (el) => {
    const v = el.querySelector('video');
    if (!v) return;
    if (!v.paused) {
      v.pause();
      el.classList.remove('playing');
      return;
    }
    M.stopAll();
    v.muted = false;
    if (v.ended) v.currentTime = 0;
    el.classList.add('playing');
    const ring = el.querySelector('.vn-ring circle');
    const total = Number(el.dataset.dur) || 0;
    const dur = el.querySelector('.vn-dur');
    const tick = () => {
      const d = total || (Number.isFinite(v.duration) ? v.duration : 0);
      if (ring && d) ring.style.strokeDashoffset = String(302 * (1 - Math.min(1, v.currentTime / d)));
      if (dur) dur.textContent = U.duration(Math.max(0, d - v.currentTime));
      if (!v.paused && !v.ended) requestAnimationFrame(tick);
    };
    v.onended = () => {
      el.classList.remove('playing');
      if (ring) ring.style.strokeDashoffset = '302';
      if (dur) dur.textContent = U.duration(total);
    };
    v.play().then(() => requestAnimationFrame(tick)).catch(() => {
      el.classList.remove('playing');
      U.toast(t('fileMissing'), 'error');
    });
  };

  M.stopAll = () => {
    if (!player.paused) player.pause();
    if (playing) {
      const p = playing;
      playing = null;
      reset(p);
    }
    document.querySelectorAll('.vnote.playing').forEach((el) => {
      const v = el.querySelector('video');
      if (v) v.pause();
      el.classList.remove('playing');
    });
  };

  // ---------- запис відеокружечка (одразу пише, є пауза з переглядом) ----------

  /** Відкриває вікно запису й одразу починає запис. Повертає {blob, mime, duration} або null. */
  M.recordVideoNote = () =>
    new Promise((resolve) => {
      (async () => {
        let stream;
        try {
          stream = await M.getAV();
        } catch (e) {
          M.deviceProblem(e);
          return resolve(null);
        }
        const MAX = 60;
        const wrap = document.createElement('div');
        wrap.className = 'vn-overlay recording';
        wrap.innerHTML = `
          <div class="vn-box">
            <div class="vn-title">${esc(t('vnTitle'))}</div>
            <div class="vn-circle">
              <video class="vn-live" autoplay muted playsinline></video>
              <video class="vn-prev" playsinline loop></video>
              <svg class="vn-progress" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg>
            </div>
            <div class="vn-time"><span class="rec-dot"></span><span id="vnTime">0:00,00</span></div>
            <div class="vn-hint">${esc(t('vnHintKeys'))}</div>
            <div class="vn-actions">
              <button class="vn-btn ghost" data-vn="cancel" title="${esc(t('cancelRec'))}">${ic('trash', 28)}</button>
              <button class="vn-btn" data-vn="pause" title="${esc(t('pauseRec'))}">${ic('pause', 30)}</button>
              <button class="vn-btn send" data-vn="send" title="${esc(t('sendRec'))}">${ic('send', 30)}</button>
            </div>
          </div>`;
        document.body.appendChild(wrap);
        const live = wrap.querySelector('.vn-live');
        const prev = wrap.querySelector('.vn-prev');
        live.srcObject = stream;
        const ring = wrap.querySelector('.vn-progress circle');
        const timeEl = wrap.querySelector('#vnTime');
        const pauseBtn = wrap.querySelector('[data-vn="pause"]');
        const hint = wrap.querySelector('.vn-hint');
        const mime = pickMime(['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']);
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1200000, audioBitsPerSecond: 64000 } : undefined);
        const chunks = [];
        let waiters = [];
        rec.ondataavailable = (ev) => {
          if (ev.data && ev.data.size) chunks.push(ev.data);
          const w = waiters;
          waiters = [];
          w.forEach((fn) => fn());
        };
        let acc = 0;
        let since = performance.now();
        let paused = false;
        let finished = false;
        let raf = 0;
        let prevUrl = '';
        const elapsed = () => (acc + (paused ? 0 : performance.now() - since)) / 1000;
        const type = () => rec.mimeType || mime || 'video/webm';

        const cleanup = () => {
          cancelAnimationFrame(raf);
          stream.getTracks().forEach((tr) => tr.stop());
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          wrap.remove();
          document.removeEventListener('keydown', onKey, true);
        };
        const finish = (send) => {
          if (finished) return;
          finished = true;
          const duration = elapsed();
          prev.pause();
          rec.onstop = () => {
            cleanup();
            if (!send) return resolve(null);
            resolve({ blob: new Blob(chunks, { type: type() }), mime: type(), duration });
          };
          try {
            rec.stop();
          } catch {
            cleanup();
            resolve(null);
          }
        };
        const showPreview = async () => {
          await new Promise((r) => {
            waiters.push(r);
            try {
              rec.requestData();
            } catch {
              r();
            }
          });
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          prevUrl = URL.createObjectURL(new Blob(chunks, { type: type() }));
          prev.src = prevUrl;
          prev.play().catch(() => {});
        };
        const setPaused = (p) => {
          if (finished || p === paused) return;
          if (p) {
            rec.pause();
            acc += performance.now() - since;
            paused = true;
            wrap.classList.add('paused');
            wrap.classList.remove('recording');
            pauseBtn.innerHTML = ic('record', 30);
            pauseBtn.title = t('resumeRec');
            hint.textContent = elapsed() >= MAX ? t('vnLimit') : t('vnPausedHint');
            showPreview();
          } else {
            if (elapsed() >= MAX) return;
            prev.pause();
            rec.resume();
            since = performance.now();
            paused = false;
            wrap.classList.remove('paused');
            wrap.classList.add('recording');
            pauseBtn.innerHTML = ic('pause', 30);
            pauseBtn.title = t('pauseRec');
            hint.textContent = t('vnHintKeys');
          }
        };
        const tick = () => {
          const s = elapsed();
          timeEl.textContent = M.clock(s);
          ring.style.strokeDashoffset = String(302 * (1 - Math.min(1, s / MAX)));
          if (!paused && s >= MAX) setPaused(true);
          raf = requestAnimationFrame(tick);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            finish(true);
          } else if (e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setPaused(!paused);
          }
        };
        document.addEventListener('keydown', onKey, true);
        wrap.addEventListener('click', (e) => {
          const b = e.target.closest('[data-vn]');
          if (!b) return;
          const a = b.dataset.vn;
          if (a === 'cancel') finish(false);
          else if (a === 'send') finish(true);
          else if (a === 'pause') setPaused(!paused);
        });
        rec.start(500);
        since = performance.now();
        tick();
      })();
    });

  // ---------- камера й мікрофон: надійне підключення ----------

  async function listDevices() {
    try {
      return await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
  }
  const realDevices = (list, kind) => list.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');

  /**
   * Відкрити мікрофон ('audio') або камеру ('video').
   * Пробуємо: обраний у налаштуваннях → системний за замовчуванням → без вимог → кожен знайдений пристрій по черзі.
   * Так працює навіть тоді, коли «за замовчуванням» у Windows стоїть відключена гарнітура чи віртуальна камера.
   */
  async function openDevice(kind) {
    const prefs = (PL.state.settings && PL.state.settings.devices) || {};
    const pref = kind === 'audio' ? prefs.audio : prefs.video;
    const base = kind === 'audio'
      ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const ids = realDevices(await listDevices(), kind === 'audio' ? 'audioinput' : 'videoinput').map((d) => d.deviceId);
    const attempts = [];
    if (pref) attempts.push(Object.assign({}, base, { deviceId: { exact: pref } }));
    attempts.push(base, true);
    for (const id of ids) if (id !== pref) attempts.push({ deviceId: { exact: id } });
    let last = null;
    for (const c of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: c, video: false } : { audio: false, video: c });
      } catch (e) {
        last = e;
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break;
      }
    }
    const after = realDevices(await listDevices(), kind === 'audio' ? 'audioinput' : 'videoinput');
    let reason = 'busy';
    if (last && (last.name === 'NotAllowedError' || last.name === 'SecurityError')) reason = 'blocked';
    else if (!after.length) reason = 'notFound';
    const err = new Error(reason);
    err.kind = kind;
    err.detail = last ? `${last.name}: ${last.message}` : '';
    throw err;
  }
  M.getAudio = () => openDevice('audio');
  M.getVideo = () => openDevice('video');
  M.getAV = async () => {
    const a = await openDevice('audio');
    try {
      const v = await openDevice('video');
      return new MediaStream([...a.getTracks(), ...v.getTracks()]);
    } catch (e) {
      a.getTracks().forEach((tr) => tr.stop());
      throw e;
    }
  };

  /** Зрозуміле пояснення, чому камера/мікрофон недоступні, і кнопка до потрібних налаштувань Windows. */
  M.deviceProblem = (err) => {
    const kind = err && err.kind === 'video' ? 'video' : 'audio';
    const reason = ['notFound', 'blocked', 'busy'].includes(err && err.message) ? err.message : 'busy';
    const steps = [kind === 'video' ? t('devStep1cam') : t('devStep1mic'), t('devStep2'), t('devStep3'), t('devStep4')];
    U.modal({
      title: kind === 'video' ? t('camProblemTitle') : t('micProblemTitle'),
      body: `<p>${esc(t('devWhy_' + reason))}</p><ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${err && err.detail ? `<p class="muted small">${esc(err.detail)}</p>` : ''}`,
      actions: [
        { label: t('openWinSettings'), cls: 'primary', onClick: () => { api.openSystemSettings(kind === 'video' ? 'camera' : 'microphone'); return true; } },
        { label: t('close'), cls: 'ghost' },
      ],
    });
  };

  // ---------- налаштування: картка «Звуки і мелодії» ----------

  M.mountSoundsCard = (el) => {
    if (!el) return;
    const kinds = [['message', 'sndRowMessage', 'bell'], ['ring', 'sndRowRing', 'phone'], ['ringVideo', 'sndRowRingVideo', 'video'], ['ringback', 'sndRowRingback', 'phoneOut']];
    const draw = () => {
      const s = (PL.state.settings && PL.state.settings.sounds) || {};
      const playing = M.previewKind();
      el.innerHTML = `
        <div class="row-head"><span class="circle-ic">${ic('music', 26)}</span><span class="rh-text"><b>${esc(t('soundsTitle'))}</b><span>${esc(t('soundsSub'))}</span></span></div>
        <div class="snd-list">${kinds.map(([k, label, icon]) => {
          const cur = s[k];
          return `
            <div class="snd-row" data-kind="${k}">
              <span class="snd-ic">${ic(icon, 20)}</span>
              <span class="snd-name"><b>${esc(t(label))}</b><small>${esc(cur ? cur.name : t('sndDefault'))}</small></span>
              <button class="icon-btn sm snd-play" data-snd="play" title="${esc(t('sndPlay'))}">${ic(playing === k ? 'stop' : 'play', 22)}</button>
              <button class="btn ghost sm" data-snd="pick">${esc(t('sndChoose'))}</button>
              ${cur ? `<button class="btn ghost sm" data-snd="reset">${esc(t('sndReset'))}</button>` : ''}
            </div>`;
        }).join('')}</div>`;
    };
    draw();
    el.onclick = async (e) => {
      const b = e.target.closest('[data-snd]');
      if (!b) return;
      const kind = b.closest('.snd-row').dataset.kind;
      if (b.dataset.snd === 'play') {
        M.previewSound(kind, draw);
        draw();
      } else if (b.dataset.snd === 'pick') {
        const st = await api.pickSound(kind);
        if (st && st.sounds) {
          PL.state.settings = st;
          U.toast(t('sndSaved'));
          M.previewSound(kind, draw);
          draw();
        }
      } else if (b.dataset.snd === 'reset') {
        PL.state.settings = await api.resetSound(kind);
        draw();
      }
    };
  };

  // ---------- налаштування: картка «Камера і мікрофон» ----------

  let test = null; // { streams, raf, ctxNode }
  M.stopDeviceTest = () => {
    if (!test) return;
    cancelAnimationFrame(test.raf);
    test.streams.forEach((s) => s.getTracks().forEach((tr) => tr.stop()));
    test = null;
  };

  M.mountDevicesCard = async (el) => {
    if (!el) return;
    M.stopDeviceTest();
    const devs = await listDevices();
    const mics = realDevices(devs, 'audioinput');
    const cams = realDevices(devs, 'videoinput');
    const prefs = (PL.state.settings && PL.state.settings.devices) || {};
    const opts = (list, cur, word) => [`<option value="">${esc(t('devAuto'))}</option>`]
      .concat(list.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `${word} ${i + 1}`)}</option>`)).join('');
    el.innerHTML = `
      <div class="row-head"><span class="circle-ic">${ic('tune', 26)}</span><span class="rh-text"><b>${esc(t('devTitle'))}</b><span>${esc(t('devSub'))}</span></span></div>
      <div class="dev-grid">
        <label>${esc(t('devMic'))}<select id="devMic">${opts(mics, prefs.audio, t('devMic'))}</select></label>
        <label>${esc(t('devCam'))}<select id="devCam">${opts(cams, prefs.video, t('devCam'))}</select></label>
      </div>
      <div class="dev-found">${esc(t('devFound', { mics: mics.length, cams: cams.length }))}</div>
      <div class="dev-test" id="devTest" hidden><video id="devPreview" autoplay muted playsinline></video><div class="dev-meter"><i id="devLevel"></i></div></div>
      <div class="dev-msg" id="devMsg"></div>
      <div class="dev-actions">
        <button class="btn primary sm" id="devCheck">${esc(t('devCheck'))}</button>
        <button class="btn ghost sm" data-sys="camera">${esc(t('devWinCam'))}</button>
        <button class="btn ghost sm" data-sys="microphone">${esc(t('devWinMic'))}</button>
      </div>`;
    const save = async (patch) => {
      const cur = (PL.state.settings && PL.state.settings.devices) || {};
      PL.state.settings = await api.updateSettings({ devices: Object.assign({}, cur, patch) });
    };
    el.querySelector('#devMic').onchange = (e) => save({ audio: e.target.value });
    el.querySelector('#devCam').onchange = (e) => save({ video: e.target.value });
    el.querySelectorAll('[data-sys]').forEach((b) => {
      b.onclick = () => api.openSystemSettings(b.dataset.sys);
    });
    el.querySelector('#devCheck').onclick = async () => {
      M.stopDeviceTest();
      const msg = el.querySelector('#devMsg');
      const box = el.querySelector('#devTest');
      const lines = [];
      test = { streams: [], raf: 0 };
      box.hidden = false;
      try {
        const a = await M.getAudio();
        test.streams.push(a);
        const c = ctx();
        const an = c.createAnalyser();
        an.fftSize = 512;
        c.createMediaStreamSource(a).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const bar = el.querySelector('#devLevel');
        const loop = () => {
          if (!test) return;
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          bar.style.width = `${Math.min(100, Math.round((peak / 90) * 100))}%`;
          test.raf = requestAnimationFrame(loop);
        };
        loop();
        lines.push(`✓ ${t('devOkMic')}: ${a.getAudioTracks()[0].label || '—'}`);
      } catch (e) {
        lines.push(`✕ ${t('micProblemTitle')}: ${t('devWhy_' + e.message)}`);
      }
      try {
        const v = await M.getVideo();
        if (test) {
          test.streams.push(v);
          el.querySelector('#devPreview').srcObject = v;
        }
        lines.push(`✓ ${t('devOkCam')}: ${v.getVideoTracks()[0].label || '—'}`);
      } catch (e) {
        lines.push(`✕ ${t('camProblemTitle')}: ${t('devWhy_' + e.message)}`);
      }
      msg.innerHTML = lines.map((l) => `<div class="${l.startsWith('✓') ? 'ok' : 'err'}">${esc(l)}</div>`).join('');
    };
  };

  /** Квадратна JPEG-мініатюра з будь-якого зображення (для фото профілю). */
  M.squareJpeg = (url, size = 320) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        if (!s) return reject(new Error('empty'));
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const g = canvas.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        canvas.toBlob(async (b) => {
          if (!b) return reject(new Error('encode'));
          resolve(new Uint8Array(await b.arrayBuffer()));
        }, 'image/jpeg', 0.88);
      };
      img.onerror = () => reject(new Error('load'));
      img.src = url;
    });
})();
