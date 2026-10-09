'use strict';
// Заставка: з'являється емблема, на ній хвилями промальовується знак Wi-Fi,
// паралельно «друкарською машинкою» пишуться «ПОЛОНИНА» і «Поруч завжди є зв'язок». ~3 с.
(function () {
  const G = {"w": 505, "h": 465, "cx": 356.0, "cy": 166.0, "dot": 8.6, "arcs": [38.4, 83.5, 130.7], "maxr": 136.7};
  const emblem = document.getElementById('emblem');
  const wifi = document.getElementById('wifi');
  const waves = document.getElementById('waves');
  const scale = () => (emblem.clientWidth || 232) / G.w;
  const setR = (r) => {
    const s = scale();
    wifi.style.setProperty('--cx', `${G.cx * s}px`);
    wifi.style.setProperty('--cy', `${G.cy * s}px`);
    wifi.style.setProperty('--r', `${r * s}px`);
  };
  waves.style.setProperty('--cx', `${(G.cx / G.w) * 100}%`);
  waves.style.setProperty('--cy', `${(G.cy / G.h) * 100}%`);
  setR(0);
  // крапка, потім кожна дуга по черзі
  const stops = [G.dot + 2, ...G.arcs.map((r) => r + 4)];
  const segs = [];
  let at = 380;
  let from = 0;
  for (const to of stops) {
    const dur = from === 0 ? 220 : 290;
    segs.push({ t0: at, t1: at + dur, from, to });
    at += dur + 80;
    from = to;
  }
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const start = performance.now();
  const frame = (now) => {
    const el = now - start;
    let r = 0;
    for (const s of segs) {
      if (el >= s.t1) r = s.to;
      else if (el >= s.t0) {
        r = s.from + (s.to - s.from) * ease((el - s.t0) / (s.t1 - s.t0));
        break;
      } else break;
    }
    setR(r);
    if (el < segs[segs.length - 1].t1 + 40) requestAnimationFrame(frame);
    else {
      wifi.classList.add('done');
      waves.classList.add('on');
    }
  };
  requestAnimationFrame(frame);

  const typeText = (el, caret, text, delay, step, done) => {
    setTimeout(() => {
      caret.classList.add('on');
      let i = 0;
      const tick = () => {
        i += 1;
        el.textContent = text.slice(0, i);
        if (i < text.length) setTimeout(tick, step);
        else if (done) done();
      };
      tick();
    }, delay);
  };
  const c1 = document.getElementById('c1');
  const c2 = document.getElementById('c2');
  typeText(document.getElementById('t1'), c1, 'ПОЛОНИНА', 450, 95, () => {
    setTimeout(() => c1.classList.remove('on'), 140);
    typeText(document.getElementById('t2'), c2, 'Поруч завжди є зв’язок', 160, 50);
  });
})();
