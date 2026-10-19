// Omino Distruttore — un omino stilizzato che distrugge gli elementi di qualsiasi pagina web.
// index.html trasforma questa funzione in un bookmarklet (javascript:...).
// Tutte le posizioni sono in coordinate di pagina (documento); la telecamera scorre la pagina per seguire l'omino.
window.__SM_SRC = function () {
  if (window.__stickman) { window.__stickman.stop(); return; }

  var Z = 2147483000;
  var root = document.documentElement;
  var cv = document.createElement('canvas');
  cv.setAttribute('data-sm', '1');
  cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:' + (Z + 2);
  var hud = document.createElement('div');
  hud.setAttribute('data-sm', '1');
  hud.style.cssText = 'position:fixed;top:12px;right:12px;z-index:' + (Z + 3) + ';font:600 12px/1.6 ui-monospace,Menlo,monospace;color:#fff;background:rgba(15,15,20,.86);padding:10px 14px;border-radius:10px;pointer-events:none;white-space:pre;box-shadow:0 4px 18px rgba(0,0,0,.3);text-align:left;letter-spacing:0;text-transform:none';
  root.appendChild(cv);
  root.appendChild(hud);
  var oldOverflowX = root.style.overflowX;
  root.style.overflowX = 'hidden';

  var ctx = cv.getContext('2d');
  var W, H, FLOOR;
  function resize() {
    var d = window.devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    cv.width = W * d; cv.height = H * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    FLOOR = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0, H);
  }
  resize();
  addEventListener('resize', resize);

  var WEAP = [
    { id: 'fists', n: 'Pugni' },
    { id: 'gun', n: 'Pistola' },
    { id: 'flame', n: 'Lanciafiamme' },
    { id: 'gren', n: 'Granate' },
    { id: 'rocket', n: 'Lanciarazzi' }
  ];
  var FUEL = 240;
  var P = {
    x: scrollX + W / 2, y: scrollY + H * 0.35, vx: 0, vy: 0, face: 1, ground: false, jumps: 1, drop: 0, walk: 0,
    act: null, actT: 0, hit: false, cool: 0, w: 0, fireCD: 0, tap: false, hold: 0, fuel: FUEL, jetting: false, flash: 0, throwT: 0
  };
  var keys = {}, debris = [], parts = [], texts = [], rings = [], killed = [], burnt = [], plats = [], proj = [], flames = [];
  var heat = new WeakMap(), words = [], media = [];
  var score = 0, frame = 0, shake = 0, camPause = 0, raf, last = performance.now();
  var DUR = { punch: 16, kick: 20, wave: 30 };
  var WORDS = ['POW!', 'BAM!', 'CRASH!', 'SBAM!', 'ZOT!', 'SDENG!'];
  var SEL = 'h1,h2,h3,h4,h5,h6,p,img,button,a,li,input,textarea,select,video,svg,blockquote,pre,table,figure,label,iframe,[role=button]';
  var PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textAlign', 'letterSpacing', 'textTransform', 'textDecoration', 'boxShadow', 'objectFit', 'whiteSpace', 'opacity', 'filter', 'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'gap', 'gridTemplateColumns', 'listStyleType', 'fill', 'stroke'];

  // ---------- input ----------
  var MAP = { ArrowLeft: 'L', a: 'L', A: 'L', ArrowRight: 'R', d: 'R', D: 'R', ArrowUp: 'J', w: 'J', W: 'J', ' ': 'J', ArrowDown: 'D', s: 'D', S: 'D', f: 'P', F: 'P', z: 'P', Z: 'P', x: 'K', X: 'K', c: 'C', C: 'C', q: 'Q', Q: 'Q', Escape: 'E', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5' };
  function kd(e) {
    var k = MAP[e.key];
    if (!k || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (!e.repeat) {
      if (k === 'J') jump();
      else if (k === 'P') P.tap = true;
      else if (k === 'K') attack('kick');
      else if (k === 'C') attack('wave');
      else if (k === 'D') P.drop = 12;
      else if (k === 'Q') P.w = (P.w + 1) % WEAP.length;
      else if (/^[1-5]$/.test(k)) P.w = +k - 1;
      else if (k === 'E') { stop(); return; }
    }
    keys[k] = true;
  }
  function ku(e) {
    var k = MAP[e.key];
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    keys[k] = false;
  }
  function blur() { keys = {}; }
  function wheel() { camPause = 90; } // se l'utente scorre a mano, la telecamera lo lascia fare per un po'
  addEventListener('keydown', kd, true);
  addEventListener('keyup', ku, true);
  addEventListener('blur', blur);
  addEventListener('wheel', wheel, { passive: true });
  addEventListener('touchmove', wheel, { passive: true });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  // mira col mouse: il clic spara e non deve attivare link/bottoni della pagina
  var mouse = null, mdown = false;
  var cursorStyle = document.createElement('style');
  cursorStyle.setAttribute('data-sm', '1');
  cursorStyle.textContent = '*{cursor:none!important}';
  root.appendChild(cursorStyle);
  function mm(e) { mouse = { cx: e.clientX, cy: e.clientY }; }
  function md(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    mouse = { cx: e.clientX, cy: e.clientY };
    mdown = true; P.tap = true;
  }
  function mu(e) { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); mdown = false; }
  function clk(e) { e.preventDefault(); e.stopPropagation(); }
  addEventListener('mousemove', mm, true);
  addEventListener('mousedown', md, true);
  addEventListener('mouseup', mu, true);
  addEventListener('click', clk, true);
  // direzione dalla spalla verso il mirino (senza mouse: davanti a sé)
  function aim() {
    if (!mouse) return { x: P.face, y: 0, dx: P.face };
    var dx = mouse.cx + scrollX - P.x, dy = mouse.cy + scrollY - (P.y - 45), m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m, dx: dx };
  }

  function jump() {
    if (!P.ground && P.jumps >= 2) return;
    P.vy = P.jumps ? -12.5 : -15;
    P.jumps++; P.ground = false; P.drop = 0;
    dust(P.x, P.y, 6);
  }
  function attack(t) {
    if (P.act) return;
    if (t === 'wave' && P.cool > 0) return;
    P.act = t; P.actT = 0; P.hit = false;
    if (t === 'punch') P.vx += P.face * 1.5;
    if (t === 'wave') { P.cool = 90; if (!P.ground) P.vy = Math.min(P.vy, -4); }
  }
  function fire() {
    var id = WEAP[P.w].id, a = aim(), sx = P.x, sy = P.y - 45;
    if (id === 'fists') { attack('punch'); return; }
    if (P.fireCD > 0 || P.act === 'kick') return;
    if (id === 'gun') {
      var ga = Math.atan2(a.y, a.x) + (Math.random() - 0.5) * 0.04;
      proj.push({ t: 'bullet', x: sx + a.x * 36, y: sy + a.y * 36, vx: Math.cos(ga) * 22, vy: Math.sin(ga) * 22, life: 60 });
      P.fireCD = 8; P.flash = 3; P.vx -= a.x * 0.4;
    } else if (id === 'flame') {
      for (var i = 0; i < 3; i++) {
        var fa = Math.atan2(a.y, a.x) + (Math.random() - 0.5) * 0.25, sp = 7 + Math.random() * 3;
        flames.push({ x: sx + a.x * 44, y: sy + a.y * 44, vx: Math.cos(fa) * sp + P.vx * 0.5, vy: Math.sin(fa) * sp + P.vy * 0.3, life: 1, n: i });
      }
    } else if (id === 'gren') {
      proj.push({ t: 'gren', x: sx + a.x * 14, y: sy - 7, vx: a.x * 10 + P.vx * 0.6, vy: a.y * 10 - 3, fuse: 75, rot: 0 });
      P.fireCD = 28; P.throwT = 12;
    } else if (id === 'rocket') {
      proj.push({ t: 'rocket', x: sx + a.x * 30, y: sy - 7 + a.y * 30, ax: a.x, ay: a.y, sp: 4, life: 100 });
      P.fireCD = 45;
      P.vx -= a.x * 3;
      if (!P.ground) P.vy -= a.y * 5; // mirando in basso in volo: rocket jump
      for (var j = 0; j < 8; j++) parts.push({ k: 'smoke', x: sx - a.x * 20, y: sy - 7 - a.y * 20, vx: -a.x * (1 + Math.random() * 3), vy: -a.y * (1 + Math.random() * 3) + (Math.random() - 0.5), life: 0.8, r: 5 });
    }
  }

  // ---------- elementi della pagina ----------
  function ok(el) {
    if (!el || el.nodeType !== 1 || el === root || el === document.body) return false;
    if (el.closest('[data-sm]') || el.closest('[data-sm-dead]') || el.closest('[data-mascot]')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }
  function area(el) { var r = el.getBoundingClientRect(); return r.width * r.height; }
  // immagini, video, svg e box con immagine di sfondo si possono staccare anche se sono grandi
  function isMedia(el) {
    return /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|svg|SVG)$/.test(el.tagName) || /url\(/.test(getComputedStyle(el).backgroundImage);
  }
  // Isola la parola sotto il punto in uno <span>, così si può staccare anche il testo di blocchi grandi
  function wordAt(x, y) {
    var node, off;
    if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      node = pos.offsetNode; off = pos.offset;
    } else if (document.caretRangeFromPoint) {
      var cr = document.caretRangeFromPoint(x, y);
      if (!cr) return null;
      node = cr.startContainer; off = cr.startOffset;
    }
    if (!node || node.nodeType !== 3) return null;
    var p = node.parentElement;
    if (!p || p.closest('[data-sm],[data-sm-dead],[data-mascot],script,style,textarea,select')) return null;
    var d = node.data, a = off, b = off;
    while (a > 0 && !/\s/.test(d[a - 1])) a--;
    while (b < d.length && !/\s/.test(d[b])) b++;
    if (b <= a) return null;
    var rg = document.createRange();
    rg.setStart(node, a); rg.setEnd(node, b);
    var rc = rg.getBoundingClientRect();
    if (x < rc.left - 2 || x > rc.right + 2 || y < rc.top - 2 || y > rc.bottom + 2) return null;
    var span = document.createElement('span');
    try { rg.surroundContents(span); } catch (e) { return null; }
    words.push(span);
    return span;
  }
  // immagini che non ricevono il puntatore o sono coperte da altri elementi
  function mediaAt(x, y) {
    var best = null, ba = Infinity;
    for (var i = 0; i < media.length; i++) {
      var el = media[i];
      if (!ok(el)) continue;
      var r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      var a = r.width * r.height;
      if (a < ba) { best = el; ba = a; }
    }
    return best;
  }
  // px, py in coordinate di pagina. Ordine: elemento piccolo o media → parola → immagine nascosta → blocco medio
  function pick(px, py) {
    var x = px - scrollX, y = py - scrollY;
    if (x < 0 || y < 0 || x > W || y > H) return null;
    var list = document.elementsFromPoint(x, y), big = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      while (el.ownerSVGElement) el = el.ownerSVGElement; // colpisci l'svg intero, non il singolo path
      if (!ok(el)) continue;
      var a = area(el);
      if (a <= W * H * 0.06 || isMedia(el)) return el;
      if (!big && a <= W * H * 0.25) big = el;
    }
    return wordAt(x, y) || mediaAt(x, y) || big;
  }
  function refresh() {
    media = Array.prototype.slice.call(document.querySelectorAll('img,svg,video,canvas,picture,iframe')).filter(function (e) { return !e.ownerSVGElement; });
    plats = [];
    var els = document.querySelectorAll(SEL);
    for (var i = 0; i < els.length && plats.length < 500; i++) {
      var el = els[i];
      if (el.ownerSVGElement || el.closest('[data-sm]') || el.closest('[data-sm-dead]')) continue;
      var r = el.getBoundingClientRect();
      if (r.bottom < -H * 0.5 || r.top > H * 1.5 || r.right < 0 || r.left > W || r.width < 24 || r.height < 8) continue;
      if (r.width * r.height > W * H * 0.2) continue;
      plats.push({ l: r.left + scrollX, r: r.right + scrollX, t: r.top + scrollY });
    }
  }
  // superfici su cui si può atterrare: elementi della pagina + detriti fermi
  function surfaces() {
    var all = plats.slice();
    debris.forEach(function (d) {
      if (!d.dying && Math.abs(d.vy) < 1 && Math.abs(d.vx) < 2) all.push({ l: d.x, r: d.x + d.w, t: d.y });
    });
    return all;
  }
  function center(el) {
    var r = el.getBoundingClientRect();
    return [(r.left + r.right) / 2 + scrollX, (r.top + r.bottom) / 2 + scrollY];
  }

  function smash(el, dx, dy, pow, px, py, quiet, rot) {
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var w = el.offsetWidth || r.width, h = el.offsetHeight || r.height;
    var cx = (r.left + r.right) / 2 + scrollX, cy = (r.top + r.bottom) / 2 + scrollY;
    var c = el.cloneNode(true);
    c.removeAttribute('id');
    for (var i = 0; i < PROPS.length; i++) { try { c.style[PROPS[i]] = cs[PROPS[i]]; } catch (e) {} }
    c.setAttribute('data-sm', '1');
    var s = c.style;
    s.position = 'absolute'; s.left = '0'; s.top = '0'; s.margin = '0';
    s.width = w + 'px'; s.height = h + 'px'; s.boxSizing = 'border-box';
    s.maxWidth = 'none'; s.maxHeight = 'none'; s.minWidth = '0'; s.minHeight = '0';
    s.zIndex = Z + 1; s.pointerEvents = 'none'; s.transformOrigin = '50% 50%';
    s.overflow = 'hidden'; s.transition = 'none'; s.animation = 'none'; s.visibility = 'visible';
    root.appendChild(c);

    if (!el.closest('[data-sm]')) killed.push({ el: el, v: el.style.visibility });
    el.style.visibility = 'hidden';
    el.setAttribute('data-sm-dead', '1');

    var mass = Math.max(1, Math.min(4, Math.sqrt(w * h) / 70));
    var d = {
      el: c, x: cx - w / 2, y: cy - h / 2, w: w, h: h, rot: rot || 0, heat: heat.get(el) || 0, dying: 0,
      vx: dx * pow * (0.7 + Math.random() * 0.5) / mass,
      vy: (dy * pow - 4 - Math.random() * 5) / Math.sqrt(mass),
      vr: (dx * (4 + Math.random() * 8) + (Math.random() - 0.5) * 4) / mass
    };
    debris.push(d); place(d);
    if (debris.length > 90) debris.shift().el.remove();
    score++;
    boom(px, py, pow, quiet);
  }

  // Un detrito che contiene altri elementi si spezza: si stacca l'elemento colpito (o uno a caso se px è null)
  function breakDebris(d, px, py, dx, dy, pow, quiet) {
    var all = d.el.querySelectorAll('*'), cands = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.ownerSVGElement || e.closest('[data-sm-dead]')) continue;
      var r = e.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      if (px != null) {
        var x = px - scrollX, y = py - scrollY;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      }
      cands.push({ e: e, a: r.width * r.height });
    }
    if (!cands.length) return false;
    var pickE;
    if (px == null) pickE = cands[Math.random() * cands.length | 0].e;
    else { cands.sort(function (a, b) { return a.a - b.a; }); pickE = cands[0].e; }
    var c = center(pickE);
    smash(pickE, dx, dy, pow, px == null ? c[0] : px, py == null ? c[1] : py, quiet, d.rot);
    d.vx += dx * 2; d.vr += (Math.random() - 0.5) * 6;
    return true;
  }

  function debrisAt(x, y, pad) {
    for (var j = debris.length - 1; j >= 0; j--) {
      var d = debris[j];
      if (!d.dying && Math.abs(x - (d.x + d.w / 2)) < d.w / 2 + pad && Math.abs(y - (d.y + d.h / 2)) < d.h / 2 + pad) return d;
    }
    return null;
  }

  function hitAt(pts, pow, dx, dy, quiet) {
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i][0], py = pts[i][1];
      var d = debrisAt(px, py, 10);
      if (d) {
        if (!breakDebris(d, px, py, dx, dy, pow, quiet)) {
          d.vx += dx * pow * 0.9; d.vy += dy * pow - 6;
          d.vr += (Math.random() - 0.5) * 16 + dx * 6;
          boom(px, py, pow, quiet);
        }
        return true;
      }
      var el = pick(px, py);
      if (el) { smash(el, dx, dy, pow, px, py, quiet); return true; }
    }
    return false;
  }

  function explode(x, y, R, pow, label, knock) {
    rings.push({ x: x, y: y, r: 15, life: 1 });
    shake = Math.max(shake, 16);
    for (var i = 0; i < 28; i++) {
      var a = Math.random() * Math.PI * 2, sp = Math.random() * 7;
      parts.push({ k: 'fire', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, r: 6 + Math.random() * 8 });
    }
    for (var s = 0; s < 14; s++)
      parts.push({ k: 'smoke', x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2, life: 1, r: 10 });
    boom(x, y, pow, true);

    var seen = [];
    for (var rr = R / 4; rr <= R; rr += R / 4) {
      for (var an = 0; an < Math.PI * 2; an += Math.PI / 8) {
        var px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr;
        var el = pick(px, py);
        if (el && seen.indexOf(el) < 0 && seen.length < 14) {
          seen.push(el);
          var c = center(el), ex = c[0] - x, ey = c[1] - y, m = Math.hypot(ex, ey) || 1;
          smash(el, ex / m, ey / m - 0.3, pow, px, py, true);
        }
      }
    }
    debris.slice().forEach(function (d) {
      if (d.dying) return;
      var ex = d.x + d.w / 2 - x, ey = d.y + d.h / 2 - y, m = Math.hypot(ex, ey) || 1;
      if (m < R * 1.3) {
        if (Math.random() < 0.6) breakDebris(d, null, null, ex / m, ey / m - 0.3, pow * 0.8, true);
        d.vx += ex / m * pow * 0.9; d.vy += ey / m * pow * 0.9 - 6; d.vr += (Math.random() - 0.5) * 20;
      }
    });
    if (knock) {
      var kx = P.x - x, ky = P.y - 25 - y, km = Math.hypot(kx, ky) || 1;
      if (km < R) { P.vx += kx / km * 7; P.vy = Math.min(P.vy, -7); P.ground = false; }
    }
    texts.push({ x: x, y: y - 40, t: 0, s: label, big: true, rot: (Math.random() - 0.5) * 0.3 });
  }

  // ---------- fuoco ----------
  function charFilter(h) {
    var k = Math.min(1, h / 40);
    return 'sepia(' + k + ') brightness(' + (1 - k * 0.65) + ') contrast(' + (1 + k * 0.3) + ')';
  }
  function heatEl(el, amt, dx) {
    if (!heat.has(el)) burnt.push({ el: el, f: el.style.filter });
    var h = (heat.get(el) || 0) + amt;
    heat.set(el, h);
    el.style.filter = charFilter(h);
    if (h > 30) { var c = center(el); smash(el, dx, -0.4, 5, c[0], c[1], Math.random() < 0.6); }
  }
  function heatDebris(d, amt) {
    d.heat += amt;
    d.el.style.filter = charFilter(d.heat);
    if (d.heat > 70 && !d.dying) {
      d.dying = 1;
      for (var i = 0; i < 8; i++) parts.push({ k: 'smoke', x: d.x + Math.random() * d.w, y: d.y + Math.random() * d.h, vx: (Math.random() - 0.5), vy: -1 - Math.random(), life: 1, r: 8 });
    }
  }

  // ---------- effetti ----------
  function boom(x, y, pow, quiet) {
    for (var i = 0; i < 12; i++) {
      var a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * pow * 0.5;
      parts.push({ k: Math.random() < 0.6 ? 'spark' : 'dust', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 1 });
    }
    if (!quiet) texts.push({ x: x, y: y - 10, t: 0, s: WORDS[Math.random() * WORDS.length | 0], rot: (Math.random() - 0.5) * 0.4 });
    shake = Math.max(shake, 5);
  }
  function dust(x, y, n) {
    for (var i = 0; i < n; i++) parts.push({ k: 'dust', x: x, y: y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 2, life: 0.7 });
  }
  function place(d) {
    d.el.style.transform = 'translate3d(' + d.x + 'px,' + d.y + 'px,0) rotate(' + d.rot + 'deg)';
  }

  // ---------- simulazione ----------
  function update(dt) {
    var acc = P.ground ? 1.3 : 0.8, max = 5.2, f = P.face;
    if (keys.L) { P.vx -= acc * dt; P.face = -1; }
    if (keys.R) { P.vx += acc * dt; P.face = 1; }
    if (!keys.L && !keys.R) P.vx *= Math.pow(P.ground ? 0.72 : 0.95, dt);
    P.vx = Math.max(-max * 1.6, Math.min(max * 1.6, P.vx));
    if (Math.abs(P.vx) > max && (keys.L || keys.R)) P.vx *= 0.9;
    P.vy = Math.min(18, P.vy + 0.75 * dt);

    // jetpack: tenendo premuto salto
    P.hold = keys.J ? P.hold + dt : 0;
    P.jetting = false;
    if (keys.J && P.hold > 10 && P.fuel > 0 && !P.ground) {
      P.vy = Math.max(-7, P.vy - 1.3 * dt);
      P.fuel -= dt; P.jetting = true;
      for (var jj = 0; jj < 2; jj++)
        parts.push({ k: 'fire', x: P.x - f * 8 + (Math.random() - 0.5) * 4, y: P.y - 26, vx: (Math.random() - 0.5) * 1.2, vy: 3 + Math.random() * 3, life: 0.7, r: 3 + Math.random() * 3 });
    }
    if (P.ground) P.fuel = Math.min(FUEL, P.fuel + 1.5 * dt);

    var py = P.y;
    P.x += P.vx * dt; P.y += P.vy * dt;
    if (P.x < scrollX + 12) { P.x = scrollX + 12; P.vx = 0; }
    if (P.x > scrollX + W - 12) { P.x = scrollX + W - 12; P.vx = 0; }
    if (P.y < 70) { P.y = 70; P.vy = Math.max(0, P.vy); }

    var wasGround = P.ground, fall = P.vy;
    P.ground = false;
    if (P.vy >= 0) {
      if (P.drop <= 0) {
        var all = surfaces();
        for (var i = 0; i < all.length; i++) {
          var p = all[i];
          if (P.x >= p.l - 4 && P.x <= p.r + 4 && py <= p.t + 2 && P.y >= p.t) { P.y = p.t; land(); break; }
        }
      }
      if (P.y >= FLOOR) { P.y = FLOOR; land(); }
    }
    if (P.ground && !wasGround && fall > 10) dust(P.x, P.y, 10);
    if (P.drop > 0) P.drop -= dt;
    if (P.cool > 0) P.cool -= dt;
    if (P.fireCD > 0) P.fireCD -= dt;
    if (P.flash > 0) P.flash -= dt;
    if (P.throwT > 0) P.throwT -= dt;
    if (P.ground && Math.abs(P.vx) > 0.3) P.walk += Math.abs(P.vx) * 0.09 * dt;

    // con il mouse l'omino guarda sempre verso il mirino
    var am = aim();
    if (mouse && Math.abs(am.dx) > 4) P.face = am.dx > 0 ? 1 : -1;

    if (keys.P || P.tap || mdown) fire();
    P.tap = false;

    if (P.act) {
      P.actT += dt;
      var t = P.actT;
      f = P.face;
      var sx = P.x, sy = P.y - 46;
      if (P.act === 'punch' && !P.hit && t >= 4 && t <= 10)
        P.hit = hitAt([[sx + am.x * 34, sy + am.y * 34], [sx + am.x * 26, sy + am.y * 26], [sx + am.x * 36 - am.y * 8, sy + am.y * 36 + am.x * 8]], 14, am.x, am.y - 0.3);
      if (P.act === 'kick' && !P.hit && t >= 6 && t <= 13)
        P.hit = hitAt([[P.x + f * 36, P.y - 26], [P.x + f * 28, P.y - 20], [P.x + f * 38, P.y - 34]], 19, f, -0.55);
      if (P.act === 'wave' && !P.hit && t >= 9) { P.hit = true; explode(P.x, P.y - 30, 170, 16, 'KA-BOOOM!', false); }
      if (t >= DUR[P.act]) P.act = null;
    }

    updateProj(dt);
    updateFlames(dt);

    for (var j = debris.length - 1; j >= 0; j--) {
      var d = debris[j];
      if (d.dying) {
        d.dying -= 0.02 * dt;
        d.el.style.opacity = Math.max(0, d.dying);
        if (d.dying <= 0) { d.el.remove(); debris.splice(j, 1); continue; }
      }
      d.vy += 0.7 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      if (d.y + d.h > FLOOR) {
        d.y = FLOOR - d.h;
        d.vy = d.vy > 2 ? d.vy * -0.3 : 0;
        d.vx *= Math.pow(0.85, dt);
        d.vr *= 0.6;
        var target = Math.round(d.rot / 180) * 180; // si appoggia "piatto"
        d.rot += (target - d.rot) * 0.15;
      }
      if (d.w < W) {
        if (d.x < scrollX) { d.x = scrollX; d.vx = Math.abs(d.vx) * 0.5; }
        if (d.x + d.w > scrollX + W) { d.x = scrollX + W - d.w; d.vx = -Math.abs(d.vx) * 0.5; }
      }
      place(d);
    }

    for (var k = parts.length - 1; k >= 0; k--) {
      var q = parts[k];
      if (q.k === 'fire') { q.vy -= 0.05 * dt; q.life -= 0.035 * dt; q.r += 0.25 * dt; }
      else if (q.k === 'smoke') { q.vy -= 0.02 * dt; q.life -= 0.015 * dt; q.r += 0.35 * dt; }
      else { q.vy += 0.3 * dt; q.life -= 0.03 * dt; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life <= 0) parts.splice(k, 1);
    }
    if (parts.length > 700) parts.splice(0, parts.length - 700);
    for (var m = texts.length - 1; m >= 0; m--) { texts[m].t += dt; if (texts[m].t > 45) texts.splice(m, 1); }
    for (var n = rings.length - 1; n >= 0; n--) { rings[n].r += 12 * dt; rings[n].life -= 0.05 * dt; if (rings[n].life <= 0) rings.splice(n, 1); }
    if (shake > 0) shake = Math.max(0, shake - dt);
  }
  function land() { P.vy = 0; P.ground = true; P.jumps = 0; }

  function updateProj(dt) {
    for (var i = proj.length - 1; i >= 0; i--) {
      var b = proj[i], dead = false, s;
      if (b.t === 'bullet') {
        for (s = 0; s < 4 && !dead; s++) {
          b.x += b.vx * dt / 4; b.y += b.vy * dt / 4;
          if (hitAt([[b.x, b.y]], 9, Math.sign(b.vx), -0.15, Math.random() < 0.75)) dead = true;
        }
        b.life -= dt;
        if (b.life <= 0) dead = true;
      } else if (b.t === 'rocket') {
        b.sp = Math.min(17, b.sp * Math.pow(1.09, dt));
        for (s = 0; s < 3 && !dead; s++) {
          b.x += b.ax * b.sp * dt / 3; b.y += b.ay * b.sp * dt / 3;
          if (debrisAt(b.x, b.y, 4) || pick(b.x, b.y) || b.y >= FLOOR) dead = true;
        }
        parts.push({ k: 'smoke', x: b.x - b.ax * 12, y: b.y - b.ay * 12, vx: -b.ax * b.sp * 0.05, vy: -b.ay * b.sp * 0.05 + (Math.random() - 0.5) * 0.6, life: 0.7, r: 4 });
        b.life -= dt;
        if (b.life <= 0 || b.x < scrollX || b.x > scrollX + W || b.y < scrollY || b.y > scrollY + H) dead = true;
        if (dead) explode(b.x, b.y, 150, 17, 'KABOOM!', true);
      } else if (b.t === 'gren') {
        var py = b.y;
        b.vy += 0.5 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vx * 0.15 * dt;
        if (b.vy > 0) {
          var all = surfaces(), landed = b.y >= FLOOR - 5;
          if (landed) b.y = FLOOR - 5;
          for (var j = 0; j < all.length && !landed; j++) {
            var p = all[j];
            if (b.x >= p.l && b.x <= p.r && py <= p.t - 5 && b.y >= p.t - 5) { b.y = p.t - 5; landed = true; }
          }
          if (landed) { b.vy = b.vy > 2 ? -b.vy * 0.45 : 0; b.vx *= 0.7; }
        }
        if (b.x < scrollX + 5 || b.x > scrollX + W - 5) b.vx = -b.vx * 0.6;
        b.fuse -= dt;
        if (b.fuse <= 0) { dead = true; explode(b.x, b.y - 5, 130, 15, 'BOOOM!', true); }
      }
      if (dead) proj.splice(i, 1);
    }
  }

  function updateFlames(dt) {
    for (var i = flames.length - 1; i >= 0; i--) {
      var q = flames[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy -= 0.04 * dt; q.vx *= Math.pow(0.97, dt);
      q.life -= 0.028 * dt; q.n++;
      if (q.n % 3 === 0 && q.life > 0.3) {
        var d = debrisAt(q.x, q.y, 4);
        if (d) { heatDebris(d, 2); q.vx *= 0.3; }
        else {
          var el = pick(q.x, q.y);
          if (el) { heatEl(el, 2.5, Math.sign(q.vx) || 1); q.vx *= 0.3; q.vy -= 0.4; }
        }
      }
      if (q.life <= 0) flames.splice(i, 1);
    }
  }

  function camera(dt) {
    if (camPause > 0) { camPause -= dt; return; }
    var sy = P.y - scrollY, t = scrollY;
    if (sy > H * 0.62) t = P.y - H * 0.62;
    else if (sy < H * 0.3) t = P.y - H * 0.3;
    t = Math.max(0, Math.min(FLOOR - H, t));
    if (Math.abs(t - scrollY) > 1) window.scrollTo({ left: scrollX, top: scrollY + (t - scrollY) * 0.25, behavior: 'instant' });
  }

  // ---------- disegno ----------
  function limb(ax, ay, a1, a2, len, f) {
    var kx = ax + f * Math.sin(a1) * len, ky = ay + Math.cos(a1) * len;
    return [ax, ay, kx, ky, kx + f * Math.sin(a1 + a2) * len, ky + Math.cos(a1 + a2) * len];
  }
  function pose() {
    var s = Math.sin(P.walk), c = Math.cos(P.walk), moving = P.ground && Math.abs(P.vx) > 0.3, id = WEAP[P.w].id;
    var o = { l1: [0.18, -0.05], l2: [-0.18, 0.02], a1: [0.25, 0.5], a2: [-0.2, 0.4], lean: 0 };
    if (moving) {
      o.l1 = [s * 0.65, -0.15 - 0.55 * Math.max(0, -c)];
      o.l2 = [-s * 0.65, -0.15 - 0.55 * Math.max(0, c)];
      o.a1 = [-s * 0.6, 0.5]; o.a2 = [s * 0.6, 0.5]; o.lean = 3;
    } else if (P.ground) {
      var b = Math.sin(frame * 0.08) * 0.06;
      o.a1 = [0.25 + b, 0.5]; o.a2 = [-0.2 - b, 0.4];
    }
    if (!P.ground) {
      o.l1 = P.jetting ? [0.15, -0.3] : [0.7, -1.2];
      o.l2 = P.jetting ? [-0.1, -0.2] : [-0.1, -0.6];
      o.a1 = [2.3, 0.2]; o.a2 = [-2.2, -0.2];
    }
    // angolo del braccio verso il mirino (0 = giù, PI/2 = avanti, PI = su)
    var am = aim(), aa = Math.atan2(am.x * P.face, am.y);
    if (id === 'gun' || id === 'flame') { o.a1 = [aa, 0]; o.a2 = [1.1, 0.7]; }
    else if (id === 'rocket') { o.a1 = [aa - 0.5, -0.4]; o.a2 = [1.3, 0.2]; }
    else if (id === 'gren') { o.a1 = P.throwT > 0 ? [2.5 - (12 - P.throwT) * 0.12, 0.1] : [0.5, 1.4]; }
    if (P.act) {
      var k = P.actT / DUR[P.act];
      var ext = k < 0.3 ? k / 0.3 : k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      if (P.act === 'punch') {
        o.a1 = [0.3 + ext * (aa - 0.3), (1 - ext) * 1.6];
        o.a2 = [-0.5, 1.5];
        if (P.ground) { o.l1 = [0.4, -0.1]; o.l2 = [-0.35, -0.05]; }
        o.lean = 5 * ext;
      } else if (P.act === 'kick') {
        o.l1 = [ext * (Math.PI / 2 + 0.1), -(1 - ext) * 1.5];
        o.l2 = [-0.15, 0];
        o.a1 = [-0.9, 0.5]; o.a2 = [1.1, 0.8]; o.lean = -4 * ext;
      } else {
        var up = Math.min(1, k * 3);
        o.a1 = [0.3 + up * 2.5, 0]; o.a2 = [-0.3 - up * 2.5, 0];
        o.l1 = [0.5, 0]; o.l2 = [-0.5, 0];
      }
    }
    return o;
  }
  function stroke(pts, w, col) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }
  function box(x, y, w, h, col) {
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
  }
  function drawWeapon(hx, hy, neckX, shY, f) {
    var id = WEAP[P.w].id, am = aim(), elev = Math.atan2(am.y, am.x * f);
    if (id === 'fists' || P.act === 'kick' || P.act === 'wave') return;
    ctx.save();
    if (id === 'rocket') {
      ctx.translate(neckX, shY - 5); ctx.scale(f, 1); ctx.rotate(elev);
      box(-20, -5, 44, 9, '#556b2f');
      box(-24, -6, 5, 11, '#333');
      if (P.fireCD <= 0) { ctx.fillStyle = '#e11d2e'; ctx.beginPath(); ctx.moveTo(24, -5); ctx.lineTo(32, -0.5); ctx.lineTo(24, 4); ctx.fill(); }
    } else if (id === 'gren') {
      if (P.fireCD < 12) {
        ctx.translate(hx, hy);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3f6212'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#999'; ctx.fillRect(-1.5, -8, 3, 4);
      }
    } else {
      ctx.translate(hx, hy); ctx.scale(f, 1); ctx.rotate(elev);
      if (id === 'gun') {
        box(-2, -5, 15, 5, '#222'); box(-1, -1, 4, 7, '#222');
        if (P.flash > 0) { ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(17, -2.5, 5, 0, Math.PI * 2); ctx.fill(); }
      } else {
        box(-8, -5, 28, 7, '#444'); box(18, -6, 5, 9, '#222'); box(-6, 2, 4, 6, '#444');
        ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(25, -1.5, 2 + Math.random(), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawMan() {
    var f = P.face, o = pose(), id = WEAP[P.w].id;
    var hipX = P.x, hipY = P.y - 26;
    var leg1 = limb(hipX, hipY, o.l1[0], o.l1[1], 13, f);
    var leg2 = limb(hipX, hipY, o.l2[0], o.l2[1], 13, f);
    var dy = 0;
    if (P.ground) dy = P.y - Math.max(leg1[5], leg2[5], leg1[3], leg2[3]);
    leg1 = leg1.map(function (v, i) { return i % 2 ? v + dy : v; });
    leg2 = leg2.map(function (v, i) { return i % 2 ? v + dy : v; });
    hipY += dy;
    var neckX = hipX + f * o.lean, neckY = hipY - 24;
    var shY = neckY + 4;
    var arm1 = limb(neckX, shY, o.a1[0], o.a1[1], 12, f);
    var arm2 = limb(neckX, shY, o.a2[0], o.a2[1], 12, f);
    var hx = neckX + f * o.lean * 0.3, hy = neckY - 10;

    if (P.ground) {
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.ellipse(P.x, P.y - 1, 16, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // jetpack sulla schiena
    var jx = (hipX + neckX) / 2 - f * 9;
    box(jx - 4, neckY + 3, 8, 17, '#6b7280');
    box(jx - 3, neckY + 20, 6, 3, '#222');
    if (id === 'flame') box(jx - f * 7 - 3, neckY + 5, 6, 14, '#b91c1c');
    // bandana
    var tail = [hx - f * 8, hy - 3, hx - f * 20, hy - 6 + Math.sin(frame * 0.3) * 3, hx - f * 30, hy - 2 + Math.sin(frame * 0.3 + 1) * 4];
    [[7, 'rgba(255,255,255,.9)'], [3.5, '#111']].forEach(function (st) {
      stroke(arm2, st[0], st[1]); stroke(leg2, st[0], st[1]);
      stroke([hipX, hipY, neckX, neckY], st[0], st[1]);
      stroke(leg1, st[0], st[1]);
    });
    drawWeapon(arm1[4], arm1[5], neckX, shY, f);
    stroke(arm1, 7, 'rgba(255,255,255,.9)'); stroke(arm1, 3.5, '#111');
    stroke(tail, 6, 'rgba(255,255,255,.9)'); stroke(tail, 3, '#e11d2e');
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    ctx.lineWidth = 3.5; ctx.strokeStyle = '#111'; ctx.stroke();
    stroke([hx - 9, hy - 3, hx + 9, hy - 3], 3, '#e11d2e');
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(hx + f * 4, hy + 1, 1.8, 0, Math.PI * 2); ctx.fill();
    // carburante jetpack
    if (P.fuel < FUEL) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(hx - 15, hy - 22, 30, 5);
      ctx.fillStyle = P.fuel > FUEL * 0.25 ? '#22c55e' : '#ef4444';
      ctx.fillRect(hx - 14, hy - 21, 28 * Math.max(0, P.fuel) / FUEL, 3);
    }
  }
  function drawProj() {
    proj.forEach(function (b) {
      if (b.t === 'bullet') {
        stroke([b.x, b.y, b.x - b.vx * 0.6, b.y - b.vy * 0.6], 3, '#ffb000');
      } else if (b.t === 'rocket') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.ay, b.ax));
        box(-12, -3, 16, 6, '#556b2f');
        ctx.fillStyle = '#e11d2e'; ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(10, 0); ctx.lineTo(4, 3); ctx.fill();
        ctx.fillStyle = '#ffb000'; ctx.beginPath(); ctx.arc(-15, 0, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3f6212'; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#999'; ctx.fillRect(-1.5, -9, 3, 4);
        if ((b.fuse | 0) % 10 < 5) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    });
  }
  function flameColor(l) {
    return l > 0.75 ? '255,243,160' : l > 0.5 ? '255,176,0' : l > 0.3 ? '255,90,0' : '90,90,90';
  }
  function bubble(txt, x, y) {
    ctx.font = '600 13px system-ui,-apple-system,sans-serif';
    var w = ctx.measureText(txt).width + 20, bx = Math.max(scrollX + 6, Math.min(scrollX + W - w - 6, x - w / 2)), by = y - 34;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, w, 26, 13); else ctx.rect(bx, by, w, 26); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + 10, by + 13);
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.translate(-scrollX, -scrollY);
    rings.forEach(function (r) {
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.lineWidth = 6 * r.life; ctx.strokeStyle = 'rgba(255,190,0,' + r.life + ')'; ctx.stroke();
    });
    parts.forEach(function (q) {
      var a = Math.max(0, q.life);
      if (q.k === 'smoke') { ctx.fillStyle = 'rgba(110,110,110,' + a * 0.45 + ')'; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill(); }
      else if (q.k === 'fire') { ctx.fillStyle = 'rgba(' + flameColor(q.life) + ',' + a + ')'; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill(); }
      else if (q.k === 'spark') { ctx.globalAlpha = a; stroke([q.x, q.y, q.x - q.vx * 2, q.y - q.vy * 2], 2.5, '#ffb000'); ctx.globalAlpha = 1; }
      else { ctx.fillStyle = 'rgba(154,154,154,' + a + ')'; ctx.fillRect(q.x - 2, q.y - 2, 4, 4); }
    });
    flames.forEach(function (q) {
      var r = 4 + (1 - q.life) * 14;
      ctx.fillStyle = 'rgba(' + flameColor(q.life) + ',' + Math.max(0, q.life) * 0.9 + ')';
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
    });
    drawProj();
    drawMan();
    texts.forEach(function (t) {
      var a = 1 - t.t / 45, sc = Math.min(1, t.t / 5) * (t.big ? 1.6 : 1);
      ctx.save();
      ctx.translate(t.x, t.y - t.t * 0.8); ctx.rotate(t.rot || 0); ctx.scale(sc, sc);
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = '900 26px Impact,"Arial Black",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = '#111'; ctx.strokeText(t.s, 0, 0);
      ctx.fillStyle = '#ffd400'; ctx.fillText(t.s, 0, 0);
      ctx.restore();
    });
    if (frame < 170) bubble('Che pagina fragile... 😈', P.x, P.y - 70);
    ctx.restore();
    if (mouse) drawCrosshair(mouse.cx, mouse.cy);
  }
  function drawCrosshair(x, y) {
    [[5, 'rgba(255,255,255,.9)'], [2, '#e11d2e']].forEach(function (st) {
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.lineWidth = st[0]; ctx.strokeStyle = st[1]; ctx.stroke();
      stroke([x - 16, y, x - 5, y], st[0], st[1]); stroke([x + 5, y, x + 16, y], st[0], st[1]);
      stroke([x, y - 16, x, y - 5], st[0], st[1]); stroke([x, y + 5, x, y + 16], st[0], st[1]);
    });
    ctx.fillStyle = '#e11d2e'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  function drawHud() {
    var fuel = Math.round(10 * Math.max(0, P.fuel) / FUEL);
    var arms = WEAP.map(function (w, i) { return (i === P.w ? '▶' : ' ') + (i + 1) + ' ' + w.n; });
    hud.textContent = '🥊 OMINO DISTRUTTORE\n' +
      '← →   muovi        ↓  scendi\n' +
      'spazio salta (x2) · tienilo = jetpack\n' +
      'mouse  mira · clic / F  usa arma\n' +
      'X  calcio   C  onda d\'urto' + (P.cool > 0 ? '…' : '') + '\n' +
      '1-5 / Q  cambia arma\n' +
      arms.slice(0, 3).join('  ') + '\n' + arms.slice(3).join('  ') + '\n' +
      'Jetpack [' + '█'.repeat(fuel) + '░'.repeat(10 - fuel) + ']\n' +
      'Distrutti: ' + score + '   ·   Esc esci';
  }

  function loop(now) {
    var dt = Math.max(0, Math.min(2.5, (now - last) / 16.667));
    last = now; frame++;
    if (frame % 10 === 1) refresh();
    if (frame % 6 === 1) drawHud();
    update(dt);
    camera(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', kd, true);
    removeEventListener('keyup', ku, true);
    removeEventListener('blur', blur);
    removeEventListener('resize', resize);
    removeEventListener('wheel', wheel);
    removeEventListener('touchmove', wheel);
    removeEventListener('mousemove', mm, true);
    removeEventListener('mousedown', md, true);
    removeEventListener('mouseup', mu, true);
    removeEventListener('click', clk, true);
    cv.remove(); hud.remove(); cursorStyle.remove();
    debris.forEach(function (d) { d.el.remove(); });
    killed.forEach(function (k) { k.el.style.visibility = k.v; k.el.removeAttribute('data-sm-dead'); });
    // rimette le parole isolate dentro il testo originale
    words.forEach(function (w) {
      var p = w.parentNode;
      if (!p) return;
      while (w.firstChild) p.insertBefore(w.firstChild, w);
      p.removeChild(w);
      p.normalize();
    });
    burnt.forEach(function (b) { b.el.style.filter = b.f; });
    root.style.overflowX = oldOverflowX;
    delete window.__stickman;
  }

  window.__stickman = { stop: stop, P: P, debris: debris, pick: pick };
  refresh();
  raf = requestAnimationFrame(loop);
};
