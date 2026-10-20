// Nimblu — una creatura del laghetto che vive sulla pagina. Cammina sopra gli elementi, sui loro lati
// e sulle pareti dello schermo (soprattutto ai bordi), mangia le lettere tenendole tra le zampe, segue lo
// scroll e si può trascinare, cliccare e chattare. Dal menu si sceglie quanto si muove, o lo si manda nell'angolo.
// index.html trasforma questa funzione in un bookmarklet (javascript:...); l'estensione la chiama con opts.
// Posizioni in coordinate di pagina: (M.x, M.y) è il punto dove poggiano i piedi.
// opts.persistent (estensione): Esc non lo chiude e "Nascondi" vale solo per la pagina corrente.
// opts.level / opts.onLevel: livello di movimento iniziale e callback per salvarlo.
// opts.state / opts.onState: stato della pagina precedente da riprendere, e callback per salvarlo
// (così cambiando pagina ricompare dov'era invece di ripartire da capo).
// opts.talk / opts.uxAuto / opts.onPrefs: chiacchiere e consigli automatici accesi o spenti, e callback per salvarli.
// opts.ai(payload) → Promise<{reply, action}>: risposte generate da un modello (estensione); opts.aiPage: può leggere la pagina.
window.__MASCOT_SRC = function (opts) {
  opts = opts || {};
  if (window.__mascot) { if (!opts.persistent) window.__mascot.stop(); return; }
  if (!document.body) return;

  // livello massimo: a parità, vince chi viene dopo nel documento, e i nostri elementi sono aggiunti in fondo
  // (ordine: canvas < area cliccabile < menu < fumetto < pannello UX)
  var Z = 2147483647;
  var root = document.documentElement;
  var G = 0.55, R = 16 * (opts.scale || 1);
  var SEL = 'h1,h2,h3,h4,h5,h6,p,img,button,a,li,input,textarea,select,video,svg,blockquote,pre,table,figure,label,article,nav,[role=button]';
  // pausa tra un'azione e l'altra (in fotogrammi a 60 fps) e velocità
  var LEVELS = {
    vivace: { pause: [50, 160], speed: 1.35 },
    normale: { pause: [140, 320], speed: 1 },
    calmo: { pause: [420, 800], speed: 0.8 },
    angolo: { pause: [300, 700], speed: 1 }
  };
  var LEVEL_SAY = { vivace: 'Evviva, si gioca!', normale: 'Ok: tranquillo ma curioso.', calmo: 'Va bene, faccio il bravo.', angolo: 'Vado nel mio angolino!' };
  var CHATTER = [
    'Che bella pagina!',
    'Qui manca solo un laghetto.',
    'Blub blub!',
    'Dai bordi si vede tutto.',
    'Le vocali sono più dolci, le consonanti più croccanti.',
    'Pssst... puoi trascinarmi dove vuoi.',
    'Cliccami se vuoi che stia più tranquillo.',
    'Le mie branchie dicono che oggi è una bella giornata.'
  ];
  var HUNGRY = ['Ho un languorino...', 'Quella parola sembra buona!', 'È ora di merenda.'];
  var YUM = ['Gnam!', 'Buonissima!', 'Croccante!', 'Sa di inchiostro.'];
  var FALLS = ['Whoa!', 'Aspettami!', 'Blub!'];
  var TICKLE = ['Blub! Soffro il solletico!', 'Ciao! Cosa facciamo?', 'Eccomi!'];
  // modalità "sul posto" a tempo: finiscono da sole e tornano in attesa
  var TIMED = /^(dance|happy|stand|curious|yawn|wag|sit|front|stretch|scratch|sniff|sniffUp|shake)$/;

  // messaggi che dice da solo: talk = chiacchiere, tips = consigli UX automatici
  function storedPrefs() { try { return JSON.parse(localStorage.getItem('__nimblu_prefs') || '{}'); } catch (e) { return {}; } }
  var prefs = { talk: true, tips: true, water: false, noEat: false, wpAuto: false, noGlass: false }, sp0 = storedPrefs();
  if (typeof sp0.talk === 'boolean') prefs.talk = sp0.talk;
  if (typeof sp0.tips === 'boolean') prefs.tips = sp0.tips;
  if (typeof opts.talk === 'boolean') prefs.talk = opts.talk;
  if (typeof opts.uxAuto === 'boolean') prefs.tips = opts.uxAuto;
  if (typeof sp0.water === 'boolean') prefs.water = sp0.water;
  if (typeof opts.water === 'boolean') prefs.water = opts.water;
  if (typeof sp0.noEat === 'boolean') prefs.noEat = sp0.noEat;
  if (typeof opts.noEat === 'boolean') prefs.noEat = opts.noEat;
  if (typeof sp0.wpAuto === 'boolean') prefs.wpAuto = sp0.wpAuto;
  if (typeof opts.wpAuto === 'boolean') prefs.wpAuto = opts.wpAuto;
  // noGlass: niente salti verso chi guarda (contro il vetro dello schermo) durante le corse pazze
  if (typeof sp0.noGlass === 'boolean') prefs.noGlass = sp0.noGlass;
  if (typeof opts.noGlass === 'boolean') prefs.noGlass = opts.noGlass;
  if (opts.app) prefs.tips = false; // nell'app non c'è una pagina da controllare
  function storedLevel() { try { return localStorage.getItem('__nimblu_level'); } catch (e) { return null; } }
  var level = LEVELS[opts.level] ? opts.level : LEVELS[storedLevel()] ? storedLevel() : 'normale';

  function mk(tag, css) {
    var e = document.createElement(tag);
    e.setAttribute('data-mascot', '1');
    if (css) e.style.cssText = css;
    root.appendChild(e);
    return e;
  }
  var cv = mk('canvas', 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:' + Z);
  // acqua sulla metà bassa dello schermo (tra il canvas e l'area cliccabile: copre Nimblu solo quando è immerso)
  var water = mk('div');
  water.id = '__nimblu_water';
  var grab = mk('div', 'position:fixed;left:0;top:0;width:10px;height:10px;z-index:' + Z + ';cursor:grab;border-radius:40%;touch-action:none;background:transparent');
  grab.title = 'Cliccami o trascinami';
  // area cliccabile sull'omino durante la rissa (colpirlo aiuta Nimblu)
  var foeGrab = mk('div', 'position:fixed;left:0;top:0;width:10px;height:10px;z-index:' + Z + ';cursor:crosshair;display:none;touch-action:none;background:transparent');
  foeGrab.title = 'Colpisci l\'omino!';
  // bottone per comandare tu l'omino (sotto le barre della vita)
  var fightBtn = mk('button', 'all:unset;box-sizing:border-box;position:fixed;left:0;top:0;z-index:' + Z + ';display:none;cursor:pointer;padding:6px 14px;border-radius:999px;background:#e11d2e;color:#fff;font:700 12px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.25);white-space:nowrap;letter-spacing:0;text-transform:none');
  fightBtn.type = 'button';
  fightBtn.setAttribute('data-fbtn', '1');
  // area cliccabile della pallina (la prendi e la lanci)
  var ballGrab = mk('div', 'position:fixed;left:0;top:0;width:10px;height:10px;z-index:' + Z + ';cursor:grab;display:none;touch-action:none;border-radius:50%;background:transparent');
  ballGrab.title = 'Prendi la pallina e lanciala!';
  var css = mk('style');
  css.textContent =
    '#__nimblu{position:fixed;left:0;top:0;z-index:' + Z + ';width:272px;display:none;background:#f5f8fd;color:#22314f;border:2px solid #2d3e63;border-radius:14px;box-shadow:0 10px 30px rgba(30,45,80,.25);font:500 13px/1.4 system-ui,-apple-system,sans-serif;padding:10px;text-align:left;letter-spacing:0;text-transform:none}' +
    '#__nimblu *{box-sizing:border-box;letter-spacing:0;text-transform:none}' +
    '#__nimblu_water{position:fixed;left:0;right:0;top:50vh;bottom:0;z-index:' + Z + ';pointer-events:none;display:none;background:linear-gradient(180deg,rgba(150,205,240,.3),rgba(60,125,195,.45));box-shadow:inset 0 2px 0 rgba(255,255,255,.55)}' +
    '#__nimblu_water::before{content:"";position:absolute;left:0;right:0;top:-8px;height:8px;background:radial-gradient(ellipse 24px 8px at 50% 100%,rgba(150,205,240,.3) 97%,transparent 100%) repeat-x;background-size:48px 8px;animation:__nwave 5s linear infinite}' +
    '#__nimblu_water::after{content:"";position:absolute;inset:0;opacity:.35;background:repeating-linear-gradient(100deg,transparent 0 38px,rgba(255,255,255,.18) 40px,transparent 44px 90px);background-size:260px 100%;animation:__nlight 9s linear infinite}' +
    '@keyframes __nwave{from{background-position:0 0}to{background-position:48px 0}}' +
    '@keyframes __nlight{from{background-position:0 0}to{background-position:260px 0}}' +
    '#__nimblu .said{margin:0 0 8px;padding:8px 10px;border-radius:10px;background:#fff;border:1px solid #dbe4f3;font:600 13px/1.4 system-ui,-apple-system,sans-serif;color:#22314f}' +
    '#__nimblu_say{position:fixed;left:0;top:0;z-index:2147483647;max-width:240px;display:none;pointer-events:none;background:#f5f8fd;color:#22314f;border:2px solid #2d3e63;border-radius:12px;padding:7px 11px;font:600 13px/1.35 system-ui,-apple-system,sans-serif;text-align:left;letter-spacing:0;text-transform:none;box-shadow:0 4px 14px rgba(30,45,80,.18);white-space:normal;overflow-wrap:break-word;margin:0}' +
    '#__nimblu_say::after{content:"";position:absolute;left:var(--tx,50%);bottom:-8px;width:12px;height:12px;background:#f5f8fd;border-right:2px solid #2d3e63;border-bottom:2px solid #2d3e63;transform:translateX(-50%) rotate(45deg)}' +
    '#__nimblu_say.below::after{bottom:auto;top:-8px;transform:translateX(-50%) rotate(225deg)}' +
    '#__nimblu_say .rest{visibility:hidden}' +
    '#__nimblu .h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 8px;font:700 14px/1.3 system-ui,-apple-system,sans-serif;color:#22314f}' +
    '#__nimblu .h small{font:500 11px/1.3 system-ui,sans-serif;color:#5b6f96}' +
    '#__nimblu .lbl{font:600 11px/1.3 system-ui,sans-serif;color:#5b6f96;margin:0 0 4px}' +
    '#__nimblu button{all:unset;box-sizing:border-box;cursor:pointer;text-align:center;padding:7px 4px;border-radius:9px;background:#e2eaf7;font:600 12px/1.2 system-ui,-apple-system,sans-serif;color:#22314f}' +
    '#__nimblu button:hover{background:#cfdcf0}' +
    '#__nimblu button:focus-visible{outline:2px solid #4f74b3;outline-offset:1px}' +
    '#__nimblu .seg{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;padding:3px;background:#e2eaf7;border-radius:10px;margin:0 0 10px}' +
    '#__nimblu .seg button{padding:6px 2px;background:transparent;font-size:11px}' +
    '#__nimblu .seg button:hover{background:#cfdcf0}' +
    '#__nimblu .seg button[aria-pressed=true]{background:#4f74b3;color:#fff}' +
    '#__nimblu .seg.two{grid-template-columns:1fr 1fr}' +
    '#__nimblu .seg.three{grid-template-columns:1fr 1fr 1fr}' +
    '#__nimblu .g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:0 0 8px}' +
    '#__nimblu form{display:flex;gap:6px;margin:0}' +
    '#__nimblu input{all:unset;box-sizing:border-box;flex:1;min-width:0;background:#fff;border:1.5px solid #b7c8e6;border-radius:9px;padding:7px 9px;font:500 13px/1.2 system-ui,-apple-system,sans-serif;color:#22314f;cursor:text}' +
    '#__nimblu input:focus{border-color:#4f74b3}' +
    '#__nimblu form button{background:#4f74b3;color:#fff;padding:7px 11px}' +
    '#__nimblu form button:hover{background:#3d5f99}' +
    '#__nimblu form button.hist{background:#e2eaf7;color:#22314f;padding:7px 9px}' +
    '#__nimblu form button.hist:hover{background:#cfdcf0}' +
    '#__nimblu .row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0 0}' +
    '#__nimblu .bye{display:block;background:transparent;border:1.5px solid #c9d6ee}' +
    '#__nimblu .uxb{display:block;width:100%;margin:0 0 8px;background:#4f74b3;color:#fff}' +
    '#__nimblu .uxb:hover{background:#3d5f99}' +
    '#__nimblu .fightb{background:#fde4e4;color:#8a1c24}' +
    '#__nimblu .fightb:hover{background:#f9cfcf}';
  var menu = mk('div');
  menu.id = '__nimblu';
  menu.innerHTML =
    '<div class="said" hidden></div>' +
    '<div class="h"><span>💧 Nimblu</span><small>lettere mangiate: <b class="n">0</b></small></div>' +
    '<div class="lbl">Quanto si muove</div>' +
    '<div class="seg">' +
    '<button type="button" data-l="vivace">Vivace</button><button type="button" data-l="normale">Normale</button>' +
    '<button type="button" data-l="calmo">Calmo</button><button type="button" data-l="angolo" title="Va in basso a destra: sta seduto, si guarda intorno o dorme">↘ Angolo</button>' +
    '</div>' +
    '<div class="lbl">Acqua, lettere e schermo</div>' +
    '<div class="seg three"><button type="button" data-p="water">🌊 Acqua sulla pagina</button><button type="button" data-p="noEat">🙅 Non mangia lettere</button><button type="button" data-p="noGlass" title="Nelle corse pazze non salta più contro lo schermo">🪟 Non salta sullo schermo</button></div>' +
    '<div class="wpb" hidden><div class="lbl">Barra nera di WordPress</div>' +
    '<div class="seg two"><button type="button" data-a="wpbar">💥 Spaccala</button><button type="button" data-p="wpAuto" title="La spacca da solo su ogni pagina">🔁 Sempre</button></div></div>' +
    '<div class="lbl">Messaggi che dice da solo</div>' +
    '<div class="seg two msgs"><button type="button" data-p="talk">💬 Chiacchiere</button><button type="button" data-p="tips">💡 Consigli UX</button></div>' +
    '<div class="g">' +
    '<button type="button" data-a="eat">🍽️ Mangia</button><button type="button" data-a="jump">🦘 Salta</button><button type="button" data-a="happy">😊 Saluta</button>' +
    '<button type="button" data-a="spin">🌀 Gira</button><button type="button" data-a="shake">💦 Scrollati</button><button type="button" data-a="sniffUp">👃 Annusa</button>' +
    '<button type="button" data-a="follow">👣 Seguimi</button><button type="button" data-a="front">🪑 Siediti</button><button type="button" data-a="sleep">💤 Dormi</button>' +
    '<button type="button" data-a="hide">🙈 Nasconditi</button><button type="button" data-a="peek">👀 Sbircia</button><button type="button" data-a="climb">🧗 Arrampica</button>' +
    '<button type="button" data-a="zoom" title="Corsa pazza, come i gatti">🏃 Corri!</button><button type="button" data-a="ball" title="Una pallina da lanciargli">🎾 Pallina</button><button type="button" class="fightb" data-a="fight" title="Fai entrare l\'omino del jetpack">🥊 Omino</button>' +
    '</div>' +
    '<button type="button" class="uxb" data-a="ux">🔍 Controlla la pagina: UX, SEO e non vedenti</button>' +
    '<form><input type="text" maxlength="200" placeholder="Scrivi a Nimblu…" aria-label="Messaggio per Nimblu"><button type="submit">Invia</button><button type="button" class="hist" data-a="hist" title="Cronologia della chat" aria-label="Cronologia della chat">🕘</button></form>' +
    '<div class="row"><button type="button" class="bye" data-a="spit">↩️ Ridai le lettere</button><button type="button" class="bye" data-a="bye">👋 ' + (opts.persistent ? 'Nascondi' : 'Chiudi') + '</button></div>';
  var bubble = mk('div');
  bubble.id = '__nimblu_say';
  bubble.setAttribute('aria-live', 'polite');
  var counter = menu.querySelector('.n'), input = menu.querySelector('input');
  if (opts.app) {
    // nell'app: niente controllo UX né bottone per chiudere
    [].forEach.call(menu.querySelectorAll('.uxb,[data-p="tips"],[data-a="bye"]'), function (b) { b.remove(); });
    menu.querySelector('.seg.msgs').style.gridTemplateColumns = '1fr';
    menu.querySelector('.row').style.gridTemplateColumns = '1fr';
  }

  var ctx = cv.getContext('2d');
  var W, H;
  function resize() {
    var d = window.devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    cv.width = W * d; cv.height = H * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  resize();

  // att: dove è appoggiato. floor = bordo basso dello schermo, top = sopra un elemento,
  // wall = parete sinistra/destra dello schermo (side -1/1), eside = lato di un elemento (side -1 sinistro, 1 destro)
  var M = {
    x: scrollX + W * 0.85, y: scrollY - 20, vx: 0, vy: 0, face: -1, mode: 'fall', att: null, t: 0,
    wy: 0, vTo: 0, vdir: 1, wallGoal: null,
    plan: [], say: '', sayT: 0, sayStart: 0, full: 0, eaten: 0, recent: [], blinkT: 0, squash: 0, blush: 0,
    rot: 0, follow: 0, walkTo: 0, walkPh: 0, eat: null, jumpTarget: null, drag: null, idleCount: 0,
    greet: true, reply: null, lastScrollTalk: -99999, drawn: null,
    rise: 0, wave: false, vb: 0, turnFlipped: false, resume: null, spins: 0, frontUp: 0, fu: 0,
    swing: 0, swingV: 0, dragVx: 0,
    // pose morbide (0..1) e angolo di vista di base; gioco (caccia, lettera-giocattolo, aggrappato), video
    sitA: 0, crA: 0, yb: 0.22, look34: false, hunt: null, toy: null, pounce: null, batT: 0, batHit: false, chaseRun: false,
    cling: null, lastHunt: -99999, video: null, watchLand: false, jumpBottom: false
  };
  var surfList = [], parts = [], eatenText = new Map();
  var frame = 0, raf, last = performance.now(), mouse = null, menuOpen = false, needRefresh = true;

  function pick(a) { return a[Math.random() * a.length | 0]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function toward(v, to, step) { return v < to ? Math.min(to, v + step) : Math.max(to, v - step); }
  function say(t) { M.say = t; M.sayT = 90 + t.length * 3; M.sayStart = frame; }
  // frasi che dice di sua iniziativa: si possono spegnere dal menu
  function chat2(t) { if (prefs.talk) say(t); }
  function scale() { return 1 + M.full * 0.03; }
  function spd() { return LEVELS[level].speed; }
  function calm() { var p = LEVELS[level].pause; return p[0] + Math.random() * (p[1] - p[0]); }

  // ---------- elementi della pagina ----------
  function rectOf(el) {
    if (!el || !el.isConnected || el.closest('[data-sm-dead]')) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { l: r.left + scrollX, r: r.right + scrollX, t: r.top + scrollY, b: r.bottom + scrollY };
  }
  function refresh() {
    surfList = [];
    var els = document.querySelectorAll(SEL);
    for (var i = 0; i < els.length && surfList.length < 500; i++) {
      var el = els[i];
      if (el.ownerSVGElement || el.closest('[data-mascot],[data-sm],[data-sm-dead],#wpadminbar')) continue;
      var r = el.getBoundingClientRect();
      if (r.bottom < -H * 0.3 || r.top > H * 1.3 || r.right < 0 || r.left > W || r.width < 30 || r.height < 8) continue;
      if (r.width * r.height > W * H * 0.35) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      surfList.push({ el: el, l: r.left + scrollX, r: r.right + scrollX, t: r.top + scrollY, b: r.bottom + scrollY });
    }
  }
  function curEl() { return M.att && (M.att.k === 'top' || M.att.k === 'eside') ? M.att.el : null; }
  function visibleTargets() {
    return surfList.filter(function (s) {
      return s.el !== curEl() && !(prefs.water && s.t > scrollY + waterTop() - 20) && s.t > scrollY + 60 && s.t < scrollY + H - 30 && s.r - s.l > 2.5 * R;
    });
  }
  // Dove le lettere non si toccano: testo che si sta scrivendo o che verrà salvato (editor, campi, aree modificabili),
  // form, bottoni, finestre di conferma, avvisi e messaggi che cambiano, codice. Nelle aree di lavoro (vedi editPage)
  // e mentre scrivi in un campo Nimblu non tocca proprio la pagina: niente lettere, niente elementi rotti, barra al suo posto.
  var NO_EAT = 'input,textarea,select,option,button,[role=button],a[class*=btn],a[class*=button],[contenteditable]:not([contenteditable=false]),' +
    '[role=textbox],[role=dialog],[role=alertdialog],dialog,[aria-modal=true],[role=alert],[role=status],[aria-live],form,label,' +
    '.notice,.updated,code,pre,kbd,#wpadminbar,[data-mascot],script,style,noscript,[data-sm-dead]';
  function safeText(p) { return !p.isContentEditable && !p.closest(NO_EAT); }
  // Pagine dove si lavora: pannelli di amministrazione (WordPress, Joomla, Ghost, Shopify...), costruttori di pagine
  // (Gutenberg, Elementor, Divi, Beaver, Oxygen, Bricks, WPBakery, Brizy, Thrive, Avada...), editor di email e di documenti
  // (ActiveCampaign, Mailchimp, HubSpot, Brevo, Google Docs, Canva, Figma, Notion...), app web su sottodomini app./admin./...
  // e qualsiasi pagina con un editor di testo vero e proprio (TinyMCE, CKEditor, Quill, ProseMirror, BEE, Unlayer...).
  var EDIT_HOST = /(^|\.)(activehosted\.com|docs\.google\.com|mail\.google\.com|sites\.google\.com|script\.google\.com|canva\.com|figma\.com|notion\.so|airtable\.com|miro\.com|trello\.com|webflow\.com|framer\.com|office\.com|sharepoint\.com|atlassian\.net|monday\.com|force\.com|zoho\.com|zoho\.eu|pipedrive\.com|hubspot\.com|stripo\.email|beefree\.io|unlayer\.com|codepen\.io|codesandbox\.io|stackblitz\.com|replit\.com|editor\.wix\.com|manage\.wix\.com|admin\.mailchimp\.com|admin\.shopify\.com)$|^(admin|app|apps|dashboard|editor|studio|builder|console|manage|my|cp|cpanel|panel|backend|backoffice|cms|crm|portal|account|accounts)\./i;
  var EDIT_PATH = /\/(wp-admin|wp-login\.php|administrator|ghost|admin|dashboard|backoffice|backend|cms|editor|builder)(\/|$)|\/edit(\/|$)|\/node\/\d+\/edit/i;
  var EDIT_QUERY = /[?&](elementor-preview|fl_builder|et_fb|ct_builder|bricks=run|vc_editable|vc_action=vc_inline|tve=true|brizy-edit|fb-edit|preview_id|action=edit|customize_changeset_uuid|ux_builder|cornerstone|siteorigin_panels_live_editor)/i;
  var EDIT_CLASS = /\b(wp-admin|wp-customizer|block-editor-page|elementor-editor-active|elementor-editor-preview|et-fb|et_fb|fl-builder-edit|oxygen-builder-body|vc_editor|compose-mode|brz-ed|tve_editor_page|tcb-editor|fusion-builder-live|bricks-is-builder|ux-builder|cs-editor)\b/;
  var EDIT_DOM = '.mce-tinymce,.tox-tinymce,.ck-editor,.cke,.ql-editor,.ProseMirror,.DraftEditor-root,.monaco-editor,.CodeMirror,.cm-editor,.fr-box,.note-editor,.redactor-box,' +
    '.gjs-editor,#bee-plugin-container,iframe[id*="bee-plugin"],iframe[src*="unlayer"],iframe[src*="stripo"],.block-editor,#elementor-editor-wrapper,#wpwrap';
  var editCache = { t: -1e9, v: false };
  function bigEditable() {
    var list = document.querySelectorAll('[contenteditable]:not([contenteditable=false]),[role=textbox][aria-multiline=true]');
    for (var i = 0; i < list.length && i < 30; i++) {
      if (list[i].closest('[data-mascot]')) continue;
      var r = list[i].getBoundingClientRect();
      if (r.width * r.height > 40000) return true;
    }
    return false;
  }
  function editPage() {
    var now = Date.now();
    if (now - editCache.t < 2000) return editCache.v;
    var v = true, b = document.body;
    try {
      v = document.designMode === 'on' || EDIT_HOST.test(location.hostname) || EDIT_PATH.test(location.pathname) || EDIT_QUERY.test(location.search) ||
        EDIT_CLASS.test(((b && b.className) || '') + ' ' + (root.className || '')) || !!document.querySelector(EDIT_DOM) || bigEditable();
    } catch (e) {}
    editCache = { t: now, v: v };
    return v;
  }
  function workArea() {
    var b = document.body, ae = document.activeElement;
    if (editPage()) return true;
    return !!ae && ae !== b && !ae.closest('[data-mascot]') && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable);
  }
  // lettere della prima riga di testo dell'elemento, subito sotto il bordo su cui cammina
  function letters(el) {
    var out = [], n = 0, top = rectOf(el);
    if (!top || workArea()) return out;
    var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), node, range = document.createRange();
    while ((node = tw.nextNode()) && n < 300) {
      var p = node.parentElement;
      if (!p || !safeText(p)) continue;
      var d = node.data;
      for (var i = 0; i < d.length && n < 300; i++) {
        if (/\s/.test(d[i]) || /[\uD800-\uDFFF]/.test(d[i])) continue;
        n++;
        range.setStart(node, i); range.setEnd(node, i + 1);
        var r = range.getBoundingClientRect();
        if (!r.width) continue;
        out.push({ node: node, i: i, ch: d[i], x: r.left + r.width / 2 + scrollX, y: r.top + scrollY, h: r.height });
      }
    }
    if (!out.length) return out;
    var minY = Math.min.apply(null, out.map(function (o) { return o.y; }));
    if (minY - top.t > 45) return [];
    return out.filter(function (o) { return o.y < minY + 4; });
  }
  function edible(el) {
    return !/^(INPUT|TEXTAREA|SELECT|IMG|VIDEO|svg|SVG)$/.test(el.tagName) && safeText(el) && /\S{2}/.test(el.textContent || '');
  }
  function sideZone(x) { var rel = (x - scrollX) / W; return rel < 0.25 || rel > 0.75; }
  function nearSide() {
    if (Math.random() < 0.7) return M.x - scrollX < W / 2 ? -1 : 1;
    return Math.random() < 0.5 ? -1 : 1;
  }

  // ---------- appoggi ----------
  function isVert() { return !!M.att && (M.att.k === 'wall' || M.att.k === 'eside'); }
  // da che parte sporge il corpo quando è su una parete: +1 verso destra, -1 verso sinistra
  function norm() { return M.att.k === 'wall' ? -M.att.side : M.att.side; }
  function settle() {
    M.vx = 0; M.vy = 0; M.jumpTarget = null; M.rot = 0; M.squash = 0.8;
    for (var i = 0; i < 5; i++) parts.push({ k: 'dust', x: M.x, y: M.y, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 1.5, life: 0.8 });
    idle(M.plan.length ? 3 : calm());
    if (M.greet) { M.greet = false; chat2(myName() ? 'Blub! Ciao ' + myName() + ', eccomi! 💙' : opts.app ? 'Blub! Sono Nimblu 💧 Toccami per giocare!' : 'Blub! Sono Nimblu 💧 Cliccami per giocare!'); }
    if (M.wallGoal != null && M.att.k === 'wall') { vTo(M.wallGoal); M.wallGoal = null; }
    if (prefs.wpAuto && !wp.autoDone && wpBar()) M.t = Math.min(M.t, 25); // in automatico va subito a spaccare la barra
    var pc = M.pounce, wl = M.watchLand;
    M.pounce = null; M.watchLand = false; M.jumpBottom = false;
    if (pc && pc.kind === 'letter') knockLetter();
    else if (pc && pc.kind === 'mouse') { M.hunt = null; if (Math.random() < 0.7) chat2(pick(['Mancato!', 'Quasi preso!', 'Uffa, la prossima volta!'])); curious(); }
    else if (wl && playing(M.video) && !isVert()) { M.mode = 'watch'; M.t = 0; }
    else if (M.toy && M.hunt) { if (isVert()) giveUpToy(); else M.mode = 'chase'; }
    M.ballJump = false;
    if (M.zoom) zoomLanded();
    else if (M.ball && B) {
      if (M.att && !isVert() && M.att.k !== 'water' && M.att.k !== 'cover') {
        M.mode = 'ball';
        if (!/^(watch|wait)$/.test(M.ball.sub)) { M.ball.sub = B.held === 'nimblu' ? 'hold' : 'chase'; M.ball.t = B.held === 'nimblu' ? 40 : 0; }
      } else dropBall();
    }
  }
  function attachFloor() { M.att = { k: 'floor' }; M.y = scrollY + H - 2; settle(); }
  function attachTop(el) { M.att = { k: 'top', el: el }; settle(); }
  // in piedi sul bordo basso di un elemento (il video che sta guardando)
  function attachVbot(el) { M.att = { k: 'vbot', el: el }; settle(); }
  function attachWall(side) {
    if (underWaterY(M.y)) { enterWater(); return; }
    M.att = { k: 'wall', side: side };
    M.wy = clamp(M.y - scrollY, 70, H - 2);
    M.x = side < 0 ? scrollX : scrollX + W;
    M.y = scrollY + M.wy;
    settle();
  }
  function attachSide(el, side) {
    var r = rectOf(el);
    if (!r) { fall(); return false; }
    M.att = { k: 'eside', el: el, side: side };
    M.x = side < 0 ? r.l : r.r;
    M.y = clamp(M.y, r.t, r.b);
    M.vx = 0; M.vy = 0; M.rot = 0;
    return true;
  }
  function fall() {
    M.att = null; M.mode = 'fall'; M.vy = Math.max(M.vy, 0); M.jumpTarget = null; M.plan = []; M.eat = null;
  }
  // l'elemento su cui sta esce dallo schermo: salta verso la parete più vicina e ci si aggrappa
  function escape() {
    var side = M.x - scrollX < W / 2 ? -1 : 1;
    fall();
    M.y = clamp(M.y, scrollY + 40, scrollY + H - 40);
    M.vx = side * 6; M.vy = -4; M.face = side;
    if (frame - M.lastScrollTalk > 1800 && Math.random() < 0.3) { M.lastScrollTalk = frame; chat2(pick(FALLS)); }
  }
  // tiene l'appoggio aggiornato (lo scroll e il layout spostano gli elementi); false se è caduto
  function stand() {
    var a = M.att, FL = scrollY + H - 2;
    if (!a) { fall(); return false; }
    if (a.k === 'water') { M.x = scrollX + M.swx; M.y = scrollY + M.swy; return true; }
    if (prefs.water && a.k === 'floor') { enterWater(); return false; } // il fondo è sott'acqua
    if (prefs.water && a.k === 'wall' && M.wy > waterTop() - 2) { enterWater(); return false; }
    if (a.k === 'floor') { M.y = FL; M.x = clamp(M.x, scrollX + R, scrollX + W - R); return true; }
    if (a.k === 'wall') { M.wy = clamp(M.wy, 70, H - 2); M.y = scrollY + M.wy; M.x = a.side < 0 ? scrollX : scrollX + W; return true; }
    if (a.k === 'cover') {
      var rc = rectOf(a.el);
      if (!rc || rc.b < scrollY + 30 || rc.t > scrollY + H - 10 || underWaterY(rc.b)) { exitCover(); return false; }
      a.r = rc;
      M.x = rc.l + a.dx;
      M.y = a.how === 'top' ? rc.t + (M.peekDy || 0) : a.how === 'climb' ? rc.t + a.dy : rc.b - 0.35 * R * scale(); // dietro: piedi un po' sopra il bordo
      return true;
    }
    var r = rectOf(a.el);
    if (!r) { fall(); return false; }
    if (a.k === 'vbot') {
      if (r.b > FL) { M.att = { k: 'floor' }; M.y = FL; return true; } // il fondo del video è sotto lo schermo: resta in basso
      if (r.b < scrollY + 24) { escape(); return false; }
      if (underWaterY(r.b)) { enterWater(); return false; }
      M.y = r.b; M.x = clamp(M.x, r.l + R, r.r - R);
      return true;
    }
    if (a.k === 'top') {
      if (M.x < r.l - 4 || M.x > r.r + 4) { fall(); M.vx = M.face * 1.3; return false; }
      M.y = r.t;
      if (underWaterY(r.t)) { enterWater(); return false; } // l'elemento è finito sott'acqua
      if (M.y < scrollY + 24) { escape(); return false; }
      if (M.y > FL) { M.att = { k: 'floor' }; M.y = FL; }
      return true;
    }
    M.x = a.side < 0 ? r.l : r.r;
    M.y = clamp(M.y, r.t, r.b);
    if (M.y < scrollY + 24 || M.y > FL + 10) { escape(); return false; }
    return true;
  }

  // ---------- azioni ----------
  function idle(t) {
    M.mode = 'idle'; M.t = t != null ? t : calm();
    if (M.t > 30) M.look34 = Math.random() < 0.45; // ogni tanto si gira di 3/4 verso chi guarda
  }
  function arrive() { idle(M.plan.length ? 2 : M.follow > 0 ? 8 : calm()); }
  function vTo(v) { M.vTo = v; M.mode = 'vwalk'; }
  function route(s) {
    // arrampicata sul lato se l'elemento arriva fino al nostro livello, altrimenti salto
    if (M.att && !isVert() && s.t < M.y - 40 && s.b >= M.y - 14 && Math.random() < 0.7) {
      var cur = M.att.k === 'top' ? rectOf(M.att.el) : null;
      var side = Math.abs(s.l - M.x) < Math.abs(s.r - M.x) ? -1 : 1;
      var cx = side < 0 ? s.l - R * 0.3 : s.r + R * 0.3;
      var lo = cur ? cur.l : scrollX + R, hi = cur ? cur.r : scrollX + W - R;
      if (cx >= lo && cx <= hi) return [{ k: 'walk', x: cx }, { k: 'climbSide', el: s.el, side: side }];
    }
    return [{ k: 'jump', el: s.el }];
  }
  function runPlan() {
    var p = M.plan.shift();
    if (!p) { idle(); return; }
    if (p.k === 'walk') {
      if (isVert()) { runPlan(); return; }
      M.walkTo = clamp(p.x, scrollX + R, scrollX + W - R); M.mode = 'walk';
    } else if (p.k === 'vto') {
      if (isVert()) vTo(p.v); else runPlan();
    } else if (p.k === 'wallUp') {
      if (M.att && M.att.k === 'floor') { M.plan.unshift({ k: 'vto', v: p.sy }); attachWall(p.side); }
      else runPlan();
    } else if (p.k === 'climbSide') {
      var r = rectOf(p.el);
      if (r && attachSide(p.el, p.side)) vTo(r.t); else idle();
    } else if (p.k === 'down') {
      var rd = rectOf(p.el);
      if (rd) { M.y = rd.t; if (attachSide(p.el, p.side)) vTo(rd.b); } else idle();
    } else if (p.k === 'leap') leap(p.side, p.sy);
    else if (p.k === 'jump') jumpTo(p.el);
    else if (p.k === 'eat') startEat();
  }
  function jumpTo(el) {
    var r = rectOf(el);
    if (!r) { idle(); return; }
    var tx = r.r - r.l > 2 * R ? r.l + R + Math.random() * (r.r - r.l - 2 * R) : (r.l + r.r) / 2;
    if (isVert()) M.x += norm() * R; // si stacca dalla parete
    var peak = Math.min(M.y, r.t) - 45 - Math.random() * 30;
    var vy0 = -Math.sqrt(2 * G * (M.y - peak));
    var T = -vy0 / G + Math.sqrt(2 * (r.t - peak) / G);
    M.att = null;
    M.vx = (tx - M.x) / T; M.vy = vy0;
    M.face = M.vx >= 0 ? 1 : -1;
    M.jumpTarget = el; M.mode = 'fall'; M.squash = 0.8;
  }
  function leap(side, sy) {
    if (isVert()) M.x += norm() * R;
    M.att = null; M.mode = 'fall';
    M.vx = side * 6.5; M.vy = -5; M.face = side;
    M.wallGoal = sy;
  }
  function goWall(side, sy) {
    var a = M.att, edge = side < 0 ? scrollX + R : scrollX + W - R;
    if (a.k === 'floor') M.plan = [{ k: 'walk', x: edge }, { k: 'wallUp', side: side, sy: sy }];
    else if (a.k === 'wall') M.plan = a.side === side ? [{ k: 'vto', v: sy }] : [{ k: 'vto', v: H - 2 }, { k: 'walk', x: edge }, { k: 'wallUp', side: side, sy: sy }];
    else M.plan = [{ k: 'leap', side: side, sy: sy }];
    runPlan();
  }
  function jumpToZone(edge) {
    var c = visibleTargets().filter(function (s) {
      var cx = (s.l + s.r) / 2;
      return sideZone(cx) === edge && Math.abs(cx - M.x) < 420;
    });
    if (!c.length) {
      if (edge) goWall(nearSide(), 80 + Math.random() * (H - 160));
      else wander();
      return;
    }
    var s = pick(c);
    M.plan = route(s);
    if (Math.random() < 0.3 && edible(s.el)) M.plan.push({ k: 'eat' });
    runPlan();
  }
  // dal bordo di un elemento scende lungo il suo lato
  function downSide() {
    var r = rectOf(M.att.el);
    if (!r) { wander(); return; }
    var side = M.x - r.l < r.r - M.x ? -1 : 1;
    M.plan = [{ k: 'walk', x: side < 0 ? r.l + R * 0.5 : r.r - R * 0.5 }, { k: 'down', el: M.att.el, side: side }];
    runPlan();
  }
  function wander() {
    if (!M.att) return;
    if (isVert()) {
      if (M.att.k === 'wall') vTo(70 + Math.random() * (H - 140));
      else { var r = rectOf(M.att.el); if (r) vTo(r.t); }
      return;
    }
    var rr = M.att.k === 'top' ? rectOf(M.att.el) : null;
    var lo = Math.max(rr ? rr.l + R * 0.6 : scrollX + R, scrollX + R), hi = Math.min(rr ? rr.r - R * 0.6 : scrollX + W - R, scrollX + W - R);
    M.walkTo = clamp(M.x + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 110), lo, Math.max(lo, hi));
    M.mode = 'walk';
  }
  // 80% del tempo ai lati della pagina, 20% al centro
  function patrol() {
    var a = M.att, r = Math.random();
    if (!a) return;
    if (Math.random() < 0.8) {
      if (a.k === 'wall') {
        if (r < 0.65) vTo(70 + Math.random() * (H - 140));
        else if (r < 0.85) vTo(H - 2);
        else jumpToZone(true);
      } else if (a.k === 'eside') wander();
      else if (r < 0.4) goWall(nearSide(), 80 + Math.random() * (H - 160));
      else if (r < 0.7) jumpToZone(true);
      else if (a.k === 'floor') {
        var sd = nearSide();
        M.walkTo = sd < 0 ? scrollX + R + Math.random() * W * 0.18 : scrollX + W - R - Math.random() * W * 0.18;
        M.mode = 'walk';
      } else downSide();
    } else {
      if (r < 0.6) jumpToZone(false);
      else if (a.k === 'floor') { M.walkTo = scrollX + W * (0.3 + Math.random() * 0.4); M.mode = 'walk'; }
      else if (a.k === 'wall') vTo(H - 2);
      else wander();
    }
  }
  function planEat() {
    if (prefs.noEat) { say(pick(['Ho promesso: niente lettere! 🙅', 'Niente lettere, promesso. Però che fame...'])); idle(60); return; }
    if (workArea()) { say(pick(['Qui stai lavorando: niente lettere, faccio il bravo 😇', 'Mentre scrivi o salvi non tocco niente!'])); idle(60); return; }
    if (M.att && M.att.k === 'top' && letters(M.att.el).length) { M.plan = [{ k: 'eat' }]; runPlan(); return; }
    var c = visibleTargets().filter(function (s) { return edible(s.el); });
    c.sort(function (a, b) {
      return (Math.abs((a.l + a.r) / 2 - M.x) + Math.abs(a.t - M.y)) - (Math.abs((b.l + b.r) / 2 - M.x) + Math.abs(b.t - M.y));
    });
    var ok = [];
    for (var i = 0; i < c.length && i < 8 && ok.length < 3; i++) if (letters(c[i].el).length) ok.push(c[i]);
    if (!ok.length) { say('Non vedo niente di commestibile...'); idle(60); return; }
    if (Math.random() < 0.4) chat2(pick(HUNGRY));
    M.plan = route(pick(ok)).concat([{ k: 'eat' }]);
    runPlan();
  }
  // toglie una lettera dal testo ricordando l'originale e com'è rimasto: se nel frattempo il sito cambia quel testo
  // (un messaggio "Salvato", un contatore...) non lo si riscrive con una versione vecchia
  function biteText(node, i) {
    var rec = eatenText.get(node);
    if (!rec || rec.cur !== node.data) { rec = { orig: node.data }; eatenText.set(node, rec); }
    node.data = node.data.slice(0, i) + node.data.slice(i + 1);
    rec.cur = node.data;
  }
  function restoreText() {
    eatenText.forEach(function (rec, node) { if (node.isConnected && node.data === rec.cur) node.data = rec.orig; });
    eatenText.clear();
  }
  // prende la lettera, si alza sulle zampe posteriori e la sgranocchia in tre morsi
  function startEat() {
    if (prefs.noEat) { idle(30); return; }
    var L = M.att && M.att.k === 'top' ? letters(M.att.el) : [];
    if (!L.length) { idle(60); return; }
    L.sort(function (a, b) { return Math.abs(a.x - M.x) - Math.abs(b.x - M.x); });
    var c = L[Math.random() * Math.min(3, L.length) | 0];
    if (Math.abs(c.x - M.x) > 4) { M.plan.unshift({ k: 'walk', x: c.x }, { k: 'eat' }); runPlan(); return; }
    var cs = getComputedStyle(c.node.parentElement);
    biteText(c.node, c.i);
    var fs = Math.min(parseFloat(cs.fontSize) || 16, 26);
    M.eat = { ch: c.ch, x0: c.x, y0: c.y + c.h / 2, font: cs.fontStyle + ' ' + cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily, color: cs.color, t: 0, bites: 0 };
    M.eaten++; M.full = Math.min(M.full + 1, 14); M.recent.push(c.ch);
    if (M.recent.length > 20) M.recent.shift();
    counter.textContent = M.eaten;
    M.mode = 'eat';
  }
  function comment() {
    var el = curEl();
    var t = (el && (el.innerText || el.textContent) || '').trim().replace(/\s+/g, ' ');
    if (t.length < 4) { chat2(pick(CHATTER)); idle(); return; }
    var w = t.slice(0, 28) + (t.length > 28 ? '…' : '');
    chat2(pick(['«' + w + '»... mmm, sembra saporito.', 'Qui c\'è scritto «' + w + '». Posso assaggiare?', 'Leggo: «' + w + '». Interessante!']));
    idle();
  }
  function canPose() { return M.att && M.att.k !== 'cover' && !/^(fall|drag|bye|eat|fight)$/.test(M.mode); }
  function timed(mode, t) { if (canPose()) { M.mode = mode; M.t = t; } }
  function flat(mode, t) { if (M.att && !isVert()) timed(mode, t); else idle(); }
  function happy(wave) { M.wave = !!wave || Math.random() < 0.4; timed('happy', wave ? 110 : 70); parts.push({ k: 'txt', ch: '✦', col: '#e98580', x: M.x, y: M.y - 40, vx: 0.3, vy: -0.6, life: 1 }); }
  function curious() { timed('curious', 100); parts.push({ k: 'txt', ch: '?', col: '#2d3e63', x: M.x + M.face * 20, y: M.y - 44, vx: 0, vy: -0.3, life: 1 }); }
  function standUp() { flat('stand', 150); }
  function yawn() { timed('yawn', 90); }
  function wagTail() { timed('wag', 80); }
  function sit() { flat('sit', calm()); }
  // vista frontale: seduto o in piedi, guarda verso chi legge
  function front(up) { M.frontUp = up != null ? up : Math.random() < 0.35 ? 1 : 0; flat('front', 160 + Math.random() * 200); }
  function stretch() { flat('stretch', 110); }
  function scratch() { flat('scratch', 90); }
  function sniff() { flat('sniff', 110); }
  // si alza sulle zampe posteriori e fiuta l'aria girando il muso
  function sniffUp() { flat('sniffUp', 170); }
  function shake() { timed('shake', 70); }
  // si gira su se stesso passando per la vista frontale; spins > 0 = rincorre la coda
  function turn(resume, spins) {
    if (!M.att || isVert()) { M.face = -M.face; if (resume) M.mode = resume; else idle(); return; }
    M.mode = 'turn'; M.turnFlipped = false; M.resume = resume || null; M.spins = spins || 0;
  }
  function dance() { M.plan = []; timed('dance', 200); }
  function sleep() { M.plan = []; timed('sleep', level === 'angolo' ? 1500 : 900); if (level !== 'angolo') chat2('Faccio un pisolino... 😴'); }
  function wake(msg) { if (M.mode === 'sleep') { idle(40); if (msg) say(msg); } }
  function gesture() {
    var r = Math.random();
    if (r < 0.1) happy();
    else if (r < 0.2) curious();
    else if (r < 0.3) standUp();
    else if (r < 0.42) front();
    else if (r < 0.5) turn();
    else if (r < 0.57) stretch();
    else if (r < 0.64) scratch();
    else if (r < 0.68) sniff();
    else if (r < 0.74) sniffUp();
    else if (r < 0.78) shake();
    else if (r < 0.83) { turn(null, 2); }
    else if (r < 0.91) yawn();
    else wagTail();
  }
  function hop() {
    if (F && M.mode === 'fight') { nimJump(M.face * 1.5); say('Hop!'); return; }
    if (!M.att) return;
    M.plan = [];
    if (isVert()) { var n = norm(); M.x += n * R; M.att = null; M.vx = n * 4; M.vy = -6; }
    else { M.att = null; M.vy = -10; M.vx = 0; M.rot = 0.001; }
    M.mode = 'fall';
    say(pick(['Hop!', 'Blub!']));
  }
  function spit(silent) {
    restoreText();
    M.full = 0; M.recent = [];
    if (!silent) say('Ecco, tutte le lettere al loro posto!');
  }
  function burp() {
    M.full = 0; M.squash = 1;
    chat2('Burp! 😅 Scusate.');
    M.recent.slice(-6).forEach(function (ch) {
      parts.push({ k: 'txt', ch: ch, col: '#22314f', grav: true, x: M.x, y: M.y - 20, vx: (Math.random() - 0.5) * 5, vy: -2 - Math.random() * 3, life: 1 });
    });
  }

  // ---------- acqua e nuoto ----------
  function waterTop() { return H * 0.5; } // superficie, in coordinate dello schermo
  function inWater() { return !!M.att && M.att.k === 'water'; }
  function underWaterY(yPage) { return prefs.water && yPage - scrollY > waterTop() + 2; }
  function splash(x, n) {
    var y = scrollY + waterTop();
    for (var i = 0; i < (n || 10); i++) parts.push({ k: 'drop', x: x + (Math.random() - 0.5) * 20, y: y, vx: (Math.random() - 0.5) * 4, vy: -2 - Math.random() * 3.5, life: 1 });
    parts.push({ k: 'ripple', x: x, y: y, life: 1 });
  }
  function enterWater() {
    splash(M.x, 12);
    if (M.zoom) endZoom(true);
    dropBall();
    M.diving = false; M.pounce = null; M.hunt = null; M.watchLand = false; M.jumpBottom = false;
    if (M.toy) giveUpToy();
    M.att = { k: 'water' }; M.mode = 'swim'; M.plan = []; M.jumpTarget = null; M.rot = 0; M.eat = null;
    M.swx = clamp(M.x - scrollX, R * 1.5, W - R * 1.5);
    M.swy = clamp(M.y - scrollY, waterTop() + R * 0.6, H - R * 0.4);
    M.svx = clamp(M.vx * 0.4, -2, 2); M.svy = clamp(M.vy * 0.3, -1, 3);
    M.swimT = 360 + Math.random() * 600; M.swTarget = null;
  }
  // si tuffa dall'elemento o dalla parete su cui si trova
  function goSwim() {
    if (!prefs.water) return;
    if (inWater()) { M.swimT = Math.max(M.swimT, 400); return; }
    if (!M.att || /^(drag|fall)$/.test(M.mode)) return;
    M.plan = [];
    if (M.att.k === 'wall') { vTo(waterTop() + 20); return; }
    if (isVert()) { var n = norm(); M.x += n * R; M.att = null; M.vx = n * 3; M.vy = -5; }
    else { M.att = null; M.vx = M.face * (1.5 + Math.random() * 2); M.vy = -7; }
    M.mode = 'fall'; M.rot = 0.001; M.squash = 0.6; M.diving = true; // il tuffo va dritto in acqua
    say(pick(['Tuffo!', 'Splash!', 'Blub blub!']));
  }
  function pickSwimTarget() {
    var wt = waterTop(), surface = Math.random() < 0.3;
    if (level === 'angolo') M.swTarget = { x: W - R * 3, y: wt + R * 0.7, t: 400 };
    else M.swTarget = {
      x: R * 2 + Math.random() * (W - R * 4),
      y: surface ? wt + R * 0.7 : wt + R * 1.4 + Math.random() * Math.max(10, H - wt - R * 2.2),
      t: 30 + Math.random() * 120
    };
  }
  // esce dall'acqua con un salto: su un elemento della metà alta, o su una parete
  function leaveWater() {
    var wt = scrollY + waterTop();
    var c = visibleTargets().filter(function (s) { return s.t < wt - 30 && Math.abs((s.l + s.r) / 2 - M.x) < 380; });
    splash(M.x, 8);
    if (c.length) { jumpTo(pick(c).el); return; }
    var side = M.x - scrollX < W / 2 ? -1 : 1;
    M.att = null; M.mode = 'fall'; M.vx = side * 5; M.vy = -10 - Math.random() * 3; M.face = side;
    M.wallGoal = waterTop() - 60;
  }
  function swimStep(dt) {
    var wt = waterTop();
    if (!M.swTarget || M.swTarget.t <= 0) pickSwimTarget();
    var dx = M.swTarget.x - M.swx, dy = M.swTarget.y - M.swy, dist = Math.hypot(dx, dy), sp = 1.4 * spd();
    if (dist > 6) { M.svx += dx / dist * 0.08 * dt; M.svy += dy / dist * 0.08 * dt; }
    else M.swTarget.t -= dt; // arrivato: resta un po' a galleggiare
    var v = Math.hypot(M.svx, M.svy);
    if (v > sp) { M.svx *= sp / v; M.svy *= sp / v; }
    M.svx *= Math.pow(0.985, dt); M.svy *= Math.pow(0.985, dt);
    M.swx = clamp(M.swx + M.svx * dt, R * 1.5, W - R * 1.5);
    M.swy = clamp(M.swy + M.svy * dt + Math.sin(frame * 0.05) * 0.08, wt + R * 0.6, H - R * 0.4);
    if (Math.abs(M.svx) > 0.15) M.face = M.svx > 0 ? 1 : -1;
    M.walkPh += (0.08 + v * 0.12) * dt;
    M.x = scrollX + M.swx; M.y = scrollY + M.swy;
    if (Math.random() < 0.02 * dt) parts.push({ k: 'bub', x: M.x + M.face * R * 1.3, y: M.y - R * 1.1, vx: (Math.random() - 0.5) * 0.3, vy: -0.6 - Math.random() * 0.5, life: 1, r: 1.5 + Math.random() * 2.5 });
    M.swimT -= dt;
    if (M.swimT <= 0 && level !== 'angolo') leaveWater();
  }
  // ---------- gioco: caccia come un gattino ----------
  // Vede una lettera (o il puntatore), si acquatta muovendo il sedere, balza. La lettera colpita salta via
  // e lui la rincorre dandole zampate finché non la prende. Il puntatore, se lo prende, ci resta aggrappato.
  function huntOK() { return M.att && !isVert() && M.att.k !== 'vbot' && !inWater() && level !== 'angolo' && !playing(M.video); }
  function mouseFresh() { return mouse && mouse.type === 'mouse' && performance.now() - mouse.at < 3000; }
  function mousePage() { return [mouse.cx + scrollX, mouse.cy + scrollY]; }
  function tryMouseHunt() {
    if (!huntOK() || !mouseFresh() || frame - M.lastHunt < 1500) return false;
    var mp = mousePage(), dx = mp[0] - M.x, up = M.y - mp[1];
    if (Math.abs(dx) < 50 || Math.abs(dx) > 420 || up < -20 || up > 300) return false;
    startStalk({ kind: 'mouse' });
    return true;
  }
  function tryLetterHunt() {
    if (!huntOK() || prefs.noEat || M.att.k !== 'top') return false;
    var L = letters(M.att.el).filter(function (c) { var d = Math.abs(c.x - M.x); return d > 55 && d < 240; });
    if (!L.length) return false;
    var c = pick(L);
    startStalk({ kind: 'letter', x: c.x, y: c.y, el: M.att.el });
    return true;
  }
  function startStalk(h) {
    M.plan = []; M.hunt = h; h.t = 70 + Math.random() * 60; h.bats = 0; h.max = 2 + (Math.random() * 2 | 0); h.age = 0;
    M.mode = 'stalk'; M.lastHunt = frame;
    M.face = (h.kind === 'mouse' ? mousePage()[0] : h.x) > M.x ? 1 : -1;
    parts.push({ k: 'txt', ch: '!', col: '#d9716a', x: M.x + M.face * R, y: M.y - R * 3.3 * scale(), vx: 0, vy: -0.4, life: 0.9 });
  }
  function giveUp(msg) { M.hunt = null; M.pounce = null; if (M.toy) giveUpToy(); idle(40); if (msg) chat2(msg); }
  // balzo: sul puntatore (le zampine davanti devono arrivarci) o sulla lettera, sullo stesso elemento
  function pounce() {
    var h = M.hunt, s = R * scale(), tx, ty;
    if (h.kind === 'mouse') { var mp = mousePage(); tx = mp[0] - M.face * s * 1.3; ty = mp[1] + s * 0.6; M.jumpTarget = null; }
    else { tx = h.x - M.face * s * 0.9; ty = M.y; M.jumpTarget = h.el; }
    var peak = Math.min(M.y, ty) - (h.kind === 'mouse' ? 16 : 36);
    var vy0 = -Math.sqrt(2 * G * Math.max(4, M.y - peak)), T = -vy0 / G + Math.sqrt(2 * Math.max(0, ty - peak) / G);
    M.att = null; M.mode = 'fall'; M.vx = clamp((tx - M.x) / Math.max(8, T), -13, 13); M.vy = vy0;
    M.pounce = { kind: h.kind }; M.squash = 0.9;
  }
  // la zampata stacca la lettera dal testo e la fa volare via
  function knockLetter() {
    var h = M.hunt, el = M.att && M.att.k === 'top' ? M.att.el : null;
    if (!h || !el || prefs.noEat) { M.hunt = null; return; }
    var px = M.x + M.face * R * scale() * 0.9, L = letters(el);
    L.sort(function (a, b) { return Math.abs(a.x - px) - Math.abs(b.x - px); });
    if (!L.length || Math.abs(L[0].x - px) > 70) { M.hunt = null; curious(); return; }
    var c = L[0], cs = getComputedStyle(c.node.parentElement), fs = Math.min(parseFloat(cs.fontSize) || 16, 28);
    biteText(c.node, c.i);
    M.toy = { ch: c.ch, font: cs.fontStyle + ' ' + cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily, color: cs.color, fs: fs,
      x: c.x, y: c.y + c.h, vx: M.face * (2.5 + Math.random() * 2), vy: -4 - Math.random() * 2.5, spin: 0, vs: M.face * 0.25, on: null, rest: false };
    h.bats = 1; h.age = 0;
    M.mode = 'chase'; M.squash = 0.6; M.chaseRun = false;
    if (Math.random() < 0.5) chat2(pick(['Tac!', 'Ecco!', 'Presa... quasi!']));
  }
  function toyLost(t) { return t.y > scrollY + H + 120 || t.y < scrollY - 300 || t.x < scrollX - 60 || t.x > scrollX + W + 60 || t.on === 'water'; }
  function giveUpToy(msg) {
    var t = M.toy;
    M.toy = null; M.hunt = null;
    if (t) parts.push({ k: 'txt', ch: t.ch, col: t.color, x: t.x, y: t.y - t.fs * 0.5, vx: 0, vy: -0.3, life: 0.6 });
    if (msg) chat2(msg);
  }
  function catchToy() {
    var t = M.toy;
    M.toy = null; M.hunt = null;
    M.eat = { ch: t.ch, x0: t.x, y0: t.y - t.fs * 0.5, font: t.font, color: t.color, t: 0, bites: 0 };
    M.eaten++; M.full = Math.min(M.full + 1, 14); M.recent.push(t.ch);
    if (M.recent.length > 20) M.recent.shift();
    counter.textContent = M.eaten;
    M.mode = 'eat';
    if (Math.random() < 0.4) chat2(pick(['Presa! Gnam!', 'Mia!', 'Catturata! 😋']));
  }
  // la lettera-giocattolo: rimbalza, rotola e si ferma sopra gli elementi, sul fondo o a galla
  function toyStep(dt) {
    var t = M.toy;
    if (!t) return;
    if (t.rest) {
      var ly = t.on === 'floor' ? scrollY + H - 2 : t.on === 'water' ? scrollY + waterTop() : null;
      if (t.on && ly == null) {
        var rr = rectOf(t.on);
        if (!rr || t.x < rr.l - 2 || t.x > rr.r + 2) { t.rest = false; t.on = null; return; }
        ly = rr.t;
      }
      t.y = ly;
      if (Math.abs(t.vx) > 0.05) { t.x += t.vx * dt; t.spin += t.vx * 0.08 * dt; t.vx *= Math.pow(0.9, dt); } else t.vx = 0;
      t.spin = Math.atan2(Math.sin(t.spin), Math.cos(t.spin)) * Math.pow(0.85, dt);
      return;
    }
    var py = t.y;
    t.vy = Math.min(14, t.vy + 0.35 * dt); t.x += t.vx * dt; t.y += t.vy * dt; t.spin += t.vs * dt;
    if (t.x < scrollX + 8) { t.x = scrollX + 8; t.vx = Math.abs(t.vx) * 0.6; }
    if (t.x > scrollX + W - 8) { t.x = scrollX + W - 8; t.vx = -Math.abs(t.vx) * 0.6; }
    if (t.vy <= 0) return;
    var on = null, y2 = 0;
    if (prefs.water && t.y - scrollY > waterTop()) { on = 'water'; y2 = scrollY + waterTop(); }
    else {
      for (var i = 0; i < surfList.length; i++) {
        var s = surfList[i];
        if (t.x >= s.l && t.x <= s.r && py <= s.t + 1 && t.y >= s.t && s.t > scrollY + 10) { on = s.el; y2 = s.t; break; }
      }
      if (!on && t.y >= scrollY + H - 2) { on = 'floor'; y2 = scrollY + H - 2; }
    }
    if (!on) return;
    t.y = y2;
    if (on === 'water') { t.rest = true; t.on = on; t.vy = 0; parts.push({ k: 'ripple', x: t.x, y: y2, life: 1 }); }
    else if (t.vy > 2.2) { t.vy = -t.vy * 0.42; t.vx *= 0.8; t.vs = -t.vs * 0.7; }
    else { t.rest = true; t.on = on; t.vy = 0; }
  }
  function drawToy() {
    var t = M.toy;
    if (!t) return;
    ctx.save();
    ctx.translate(t.x, t.y - t.fs * 0.5); ctx.rotate(t.spin);
    ctx.font = t.font; ctx.fillStyle = t.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.ch, 0, 0);
    ctx.restore();
  }
  function chaseStep(dt) {
    var t = M.toy, h = M.hunt;
    if (!t || !h) { M.hunt = null; idle(); return; }
    h.age += dt;
    if (M.batT > 0) {
      M.batT -= dt;
      if (M.batT <= 9 && !M.batHit) { // la zampata arriva: la lettera riparte
        M.batHit = true; h.bats++;
        t.vx = M.face * (2 + Math.random() * 2.5); t.vy = -2.5 - Math.random() * 2.5; t.vs = M.face * 0.3; t.rest = false; t.on = null;
      }
      return;
    }
    if (h.age > 1100) { giveUpToy('Uffa, mi sono stancato.'); idle(40); return; }
    if (toyLost(t)) { giveUpToy(t.on === 'water' ? 'Oh no, è finita in acqua!' : 'Persa! 😿'); idle(40); return; }
    if (Math.abs(t.x - M.x) > 4) M.face = t.x > M.x ? 1 : -1;
    M.chaseRun = false;
    if (!t.rest) return; // la guarda volare, pronto a scattare
    var mine = M.att.k === 'floor' ? 'floor' : M.att.k === 'top' ? M.att.el : null;
    if (t.on !== mine) { // è finita su un'altra superficie: ci salta
      if (t.on === 'floor') { M.att = null; M.mode = 'fall'; M.vx = clamp((t.x - M.x) / 30, -6, 6); M.vy = -4; }
      else jumpTo(t.on);
      return;
    }
    var dx = t.x - M.x, reach = R * scale() * 1.25;
    if (Math.abs(dx) > reach) {
      var sp2 = 2.3 * spd();
      M.chaseRun = true;
      M.x += Math.sign(dx) * Math.min(Math.abs(dx) - reach * 0.8, sp2 * dt); M.walkPh += 0.25 * sp2 * dt;
      return;
    }
    if (h.bats < h.max) { M.batT = 18; M.batHit = false; }
    else catchToy();
  }
  // aggrappato al puntatore: penzola seguendolo; se lo scuoti forte, clicchi o passa un po' di tempo, molla
  function startCling() {
    M.pounce = null; M.hunt = null; M.mode = 'cling'; M.att = null; M.plan = []; M.jumpTarget = null;
    M.cling = { t: 0, max: 420 + Math.random() * 360, shake: 0 };
    M.swing = 0; M.swingV = 0; M.dragVx = 0;
    var mp = mousePage(); M.x = mp[0]; M.y = mp[1];
    say(pick(['Preso! 😸', 'Ti ho preso!', 'Mio! Non mollo!']));
  }
  function releaseCling(msg) {
    if (M.mode !== 'cling') return;
    M.cling = null; M.mode = 'fall'; M.vx = clamp(mouse ? mouse.vx * 0.5 : 0, -10, 10); M.vy = 0;
    M.y += R * scale() * 2.3; M.swing = 0;
    if (msg) say(msg);
  }
  function clingStep(dt) {
    var c = M.cling;
    if (!mouse || !c) { releaseCling(); return; }
    c.t += dt;
    var nx = mouse.cx + scrollX, ny = mouse.cy + scrollY, mvx = nx - M.x, mvy = ny - M.y;
    M.x = nx; M.y = ny;
    M.dragVx += mvx;
    M.swingV += (-M.swing * 0.09 - M.dragVx * 0.005) * dt;
    M.swingV *= Math.pow(0.9, dt);
    M.swing = clamp(M.swing + M.swingV * dt, -0.9, 0.9);
    M.dragVx = 0;
    c.shake = c.shake * Math.pow(0.93, dt) + Math.hypot(mvx, mvy);
    if (c.shake > 420) releaseCling(pick(['Whoa! Mollo, mollo!', 'Aaah! 😵']));
    else if (c.t > c.max) releaseCling(pick(['Ok, ti lascio andare!', 'Mi si stancano le zampine...']));
  }

  // ---------- video: va a guardarlo ----------
  // Quando fai partire un video va sotto, sul bordo basso, e si gira di spalle a guardarlo.
  // Se lo sposti trascinandolo, per quel video non ci torna più.
  var noVideo = typeof WeakSet === 'function' ? new WeakSet() : { has: function () { return false; }, add: function () {} };
  function playing(v) { return !!v && v.isConnected && !v.paused && !v.ended; }
  function onPlay(e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || noVideo.has(v) || v.closest('[data-mascot]')) return;
    var ua = navigator.userActivation;
    if (v.muted && (v.loop || v.autoplay || (ua && !ua.isActive))) return; // video decorativi che partono da soli
    var b = v.getBoundingClientRect();
    if (b.width < 200 || b.height < 110) return;
    M.video = v;
    if (M.att && !/^(fall|drag|cling|eat|bye|watch)$/.test(M.mode)) goWatch();
  }
  function goWatch() {
    var v = M.video;
    if (!playing(v) || level === 'angolo') return false;
    var r = rectOf(v);
    if (!r || r.b < scrollY + 60 || r.t > scrollY + H - 40 || inWater()) return false;
    var fl = scrollY + H - 2, by = Math.min(r.b, fl);
    if (underWaterY(by)) return false;
    if (M.toy) giveUpToy();
    M.hunt = null; M.pounce = null; M.plan = [];
    if (M.mode === 'sleep') M.mode = 'idle';
    if (M.att && M.att.k === 'vbot' && M.att.el === v) { M.mode = 'watch'; return true; }
    var tx = clamp(r.l + (r.r - r.l) * 0.62, scrollX + R * 2, scrollX + W - R * 2);
    if (isVert()) M.x += norm() * R;
    var peak = Math.min(M.y, by) - 50;
    var vy0 = -Math.sqrt(2 * G * Math.max(4, M.y - peak)), T = -vy0 / G + Math.sqrt(2 * Math.max(0, by - peak) / G);
    M.att = null; M.mode = 'fall'; M.vx = clamp((tx - M.x) / T, -16, 16); M.vy = vy0; M.face = M.vx >= 0 ? 1 : -1;
    M.jumpBottom = r.b <= fl; M.jumpTarget = M.jumpBottom ? v : null; M.watchLand = true; M.squash = 0.7;
    if (Math.random() < 0.7) chat2(pick(['Ooh, un video! 🍿', 'Aspetta, voglio vedere!', 'Si guarda un film! 🎬']));
    return true;
  }
  function endWatch() {
    M.video = null;
    if (M.mode === 'watch') { front(0); M.t = 110; chat2(pick(['Bello! 🍿', 'Che bel video!', 'Finito? Peccato.'])); }
  }
  function watchStep(dt) {
    var v = M.video;
    if (!playing(v)) { endWatch(); return; }
    var r = rectOf(v);
    if (!r || r.b < scrollY + 40 || r.t > scrollY + H - 30) { idle(30); return; } // non si vede più: tornerà quando riappare
    M.t += dt;
    if (Math.random() < 0.0012 * dt) chat2(pick(['Ooh!', 'Che bello! 🍿', 'Shh, sto guardando.', 'Blub... interessante.']));
  }

  // ---------- barra di WordPress ----------
  // Da loggati, WordPress mette in alto la sua barra nera. Nimblu la toglie in tre modi (a caso, o quello chiesto):
  // 'rip' ci si appende, la strattona finché si crepa e cade a pezzi (pezzi veri della barra); 'eat' se la mangia
  // a morsi da un capo all'altro; 'laser' carica e la disintegra con un raggio dalla bocca. Poi la si può rimettere.
  // Con prefs.wpAuto lo fa da solo appena arriva sulla pagina. La barra non conta mai negli errori UX.
  // Tolta la barra, chiude anche lo spazio che lasciava (margini del tema, header fissi spostati in basso).
  var wp = { gone: false, style: null, crack: 0, shake: 0, cracks: [], shards: [], hadClass: false, autoDone: false,
    kind: 'rip', edge: 0, dir: 1, bites: [], bh: 32, fixes: [], beam: null };
  var WP_KINDS = ['rip', 'eat', 'laser'];
  function wpEl() { return document.getElementById('wpadminbar'); }
  function wpBar() {
    var b = wpEl();
    if (!b || wp.gone) return null;
    var r = b.getBoundingClientRect();
    return r.height > 0 && r.width > 0 ? b : null;
  }
  function wpHide() {
    if (!wp.style) wp.style = mk('style');
    // la barra sparisce e la pagina risale: margine in alto, variabile usata dai temi, spazio nell'amministrazione
    wp.style.textContent = '#wpadminbar:not([data-mascot]){display:none!important}' +
      'html[data-nimblu-nobar]{margin-top:0!important;--wp-admin--admin-bar--height:0px!important}' +
      'html.wp-toolbar[data-nimblu-nobar]{padding-top:0!important}';
    root.setAttribute('data-nimblu-nobar', '');
    wp.hadClass = !!document.body && document.body.classList.contains('admin-bar');
    if (wp.hadClass) document.body.classList.remove('admin-bar');
    wp.gone = true; wp.crack = 0; ux.list = null; needRefresh = true;
    wpFixGaps();
  }
  // Spazi lasciati dalla barra che alcuni temi aggiungono per conto loro: margine o padding in cima a html/body,
  // header fissi o "sticky" con top uguale all'altezza della barra, e un'eventuale fascia vuota in cima alla pagina.
  function wpFixGaps() {
    if (!wp.gone || !document.body) return;
    var bh = wp.bh || 32;
    function near(v) { v = parseFloat(v) || 0; return v > 1 && Math.abs(v - bh) <= 2; }
    function fix(el, prop) {
      for (var i = 0; i < wp.fixes.length; i++) if (wp.fixes[i][0] === el && wp.fixes[i][1] === prop) { el.style.setProperty(prop, '0px', 'important'); return; }
      wp.fixes.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
      el.style.setProperty(prop, '0px', 'important');
    }
    [root, document.body].forEach(function (el) {
      var cs = getComputedStyle(el);
      if (near(cs.marginTop)) fix(el, 'margin-top');
      if (near(cs.paddingTop)) fix(el, 'padding-top');
      if (cs.position !== 'static' && near(cs.top)) fix(el, 'top');
    });
    function ours(e) { return e.closest('[data-mascot]'); }
    function stack(x, y) { return (document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)]).filter(function (e) { return e && !ours(e); }); }
    var seen = [];
    [8, W * 0.25, W * 0.5, W * 0.75, W - 8].forEach(function (x) {
      stack(x, bh + 1).forEach(function (el) {
        for (var e = el; e && e !== document.body && e !== root; e = e.parentElement) {
          if (seen.indexOf(e) >= 0) break;
          seen.push(e);
          var cs = getComputedStyle(e);
          if ((cs.position === 'fixed' || cs.position === 'sticky') && near(cs.top)) fix(e, 'top');
        }
      });
    });
    if (scrollY < 2) {
      var top = stack(W / 2, 2)[0];
      if (!top || top === document.body || top === root) {
        for (var e2 = stack(W / 2, bh + 2)[0]; e2 && e2 !== document.body && e2 !== root; e2 = e2.parentElement) {
          var c2 = getComputedStyle(e2);
          if (near(c2.marginTop)) { fix(e2, 'margin-top'); break; }
          if (near(c2.paddingTop)) { fix(e2, 'padding-top'); break; }
          if (c2.position === 'relative' && near(c2.top)) { fix(e2, 'top'); break; }
        }
      }
    }
  }
  function wpRestore() {
    if (!wp.gone) return false;
    root.removeAttribute('data-nimblu-nobar');
    if (wp.style) wp.style.textContent = '';
    if (wp.hadClass && document.body) document.body.classList.add('admin-bar');
    wp.fixes.forEach(function (f) { if (f[2]) f[0].style.setProperty(f[1], f[2], f[3]); else f[0].style.removeProperty(f[1]); });
    wp.fixes = [];
    wp.gone = false; ux.list = null; needRefresh = true;
    var b = wpEl();
    if (b && b.animate) b.animate([{ transform: 'translateY(-100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    return true;
  }
  // salto: le zampine devono arrivare al bordo basso della barra
  function wpSmash(auto, kind) {
    if (workArea()) { if (!auto) say('Qui stai lavorando: la barra la lascio stare 😇'); return false; }
    var b = wpBar();
    if (!b) { if (!auto) say(wp.gone ? 'L\'ho già spaccata! 💥 Se la rivuoi dimmi "rimetti la barra".' : 'Qui non vedo la barra di WordPress.'); return false; }
    var r = b.getBoundingClientRect();
    if (r.bottom < 12 || r.top > H * 0.5) { if (!auto) say('Torna in cima alla pagina, così ci arrivo!'); return false; }
    if (/^(drag|cling|smash|barEat|barLaser|bye|fight)$/.test(M.mode)) return false;
    kind = WP_KINDS.indexOf(kind) >= 0 ? kind : pick(WP_KINDS);
    if (kind === 'laser' && (!M.att || M.mode === 'fall')) kind = 'rip'; // il raggio si spara stando appoggiati
    wp.kind = kind; wp.bh = r.height;
    wake();
    M.plan = []; M.hunt = null; M.pounce = null; M.eat = null; M.watchLand = false; M.jumpBottom = false; M.jumpTarget = null; M.diving = false;
    if (M.toy) giveUpToy();
    if (M.mode === 'sleep') idle(1);
    var left = Math.max(r.left, 0), right = Math.min(r.right, W);
    wp.dir = M.x - scrollX < (left + right) / 2 ? 1 : -1; // parte dal capo più vicino
    if (kind === 'laser') {
      M.mode = 'barLaser'; M.t = 0; M.face = wp.dir; wp.edge = wp.dir > 0 ? left - r.left : right - r.left; wp.beam = null;
      say(pick(['Occhi chiusi, carico il raggio...', 'Modalità laser! 😎', 'Tre, due, uno...']));
      return true;
    }
    var tx = kind === 'eat' ? (wp.dir > 0 ? left + 40 : right - 40) : clamp(M.x - scrollX, left + 70, right - 70);
    var apex = scrollY + r.bottom + R * scale() * 1.7;
    if (isVert()) M.x += norm() * R;
    var vy0 = -Math.sqrt(2 * G * Math.max(30, M.y - apex)), T = -vy0 / G;
    M.att = null; M.mode = 'fall'; M.vy = vy0; M.vx = clamp((scrollX + tx - M.x) / T, -18, 18); M.face = M.vx >= 0 ? 1 : -1;
    M.smashJump = { x: tx }; M.squash = 0.8;
    if (!auto || Math.random() < 0.5) say(kind === 'eat' ? pick(['Che fame... quella barra sembra liquirizia!', 'Gnam, la barra nera!']) : pick(['Ci penso io! 💪', 'Quella barra nera? Arrivo!', 'Tenetevi forte...']));
    return true;
  }
  function wpStartSmash() {
    var b = wpBar();
    M.smashX = M.smashJump ? M.smashJump.x : M.x - scrollX; M.smashJump = null;
    if (!b) { M.vy = Math.max(M.vy, 0); return; }
    var r = b.getBoundingClientRect(), hx = clamp(M.smashX, r.left + 30, r.right - 30) - r.left;
    if (wp.kind === 'eat') {
      M.mode = 'barEat'; M.att = null; M.t = 0; M.swing = 0; M.swingV = 0; M.squash = 0.5; M.vx = 0; M.vy = 0; M.face = wp.dir;
      wp.edge = wp.dir > 0 ? Math.max(0, -r.left) : Math.min(r.width, W - r.left);
      wp.bites = [0, 1, 2].map(function () { return 0.75 + Math.random() * 0.3; });
      return;
    }
    M.mode = 'smash'; M.att = null; M.t = 0; M.swing = 0; M.swingV = 0; M.dragVx = 0; M.squash = 0.5; M.vx = 0; M.vy = 0;
    // crepe che partono dal punto dove si aggrappa (in coordinate della barra), rivelate poco alla volta
    wp.crack = 0; wp.cracks = [];
    for (var i = 0; i < 8; i++) {
      var a = -Math.PI / 2 + (i % 2 ? 1 : -1) * (0.25 + Math.random() * 1.2), x = hx, y = r.height, pts = [[x, y]], n = 4 + (Math.random() * 3 | 0), len = 10 + Math.random() * 18 + i * 6;
      for (var k = 0; k < n; k++) { a += (Math.random() - 0.5) * 0.9; x += Math.cos(a) * len; y += Math.sin(a) * len * 0.45; y = clamp(y, 1, r.height - 1); pts.push([x, y]); }
      wp.cracks.push(pts);
    }
  }
  function wpAbort() {
    var b = wpEl();
    if (b) { b.style.transform = ''; b.style.clipPath = ''; }
    wp.crack = 0; wp.shake = 0; wp.beam = null; M.smashJump = null;
  }
  // parte della barra che resta: dal bordo 'edge' (coordinate della barra) verso il capo non ancora tolto.
  // Mangiandola il bordo ha tre morsi tondi; col raggio è un taglio dritto.
  function wpClip(b, r, bitten) {
    var w = r.width, h = r.height, e = wp.edge, d = wp.dir, pts = [], j, k;
    function edgePts(down) {
      var out = [];
      if (!bitten) return down ? [[e, 0], [e, h]] : [[e, h], [e, 0]];
      for (j = 0; j < 3; j++) {
        var cy = h - (j + 0.5) * h / 3, rb = h / 6 * wp.bites[j];
        for (k = 0; k <= 6; k++) { var f = Math.PI * k / 6; out.push([e + d * rb * Math.sin(f), cy + rb * Math.cos(f)]); }
      }
      return down ? out.reverse() : out;
    }
    if (d > 0) pts = [[w, 0], [w, h]].concat(edgePts(false));
    else pts = [[0, 0]].concat(edgePts(true), [[0, h]]);
    b.style.clipPath = 'polygon(' + pts.map(function (p) { return p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px'; }).join(',') + ')';
  }
  function wpDone(msgs) {
    var b = wpEl();
    if (b) b.style.clipPath = '';
    wpHide();
    say(pick(msgs));
  }
  // se la mangia a morsi, appeso sotto, spostandosi lungo il bordo
  function barEatStep(dt) {
    var b = wpBar();
    if (!b) { M.mode = 'fall'; M.vy = 0; M.vx = 0; return; }
    var r = b.getBoundingClientRect(), left = Math.max(0, -r.left), right = Math.min(r.width, W - r.left);
    M.t += dt;
    var chew = Math.max(0, Math.sin(M.t * 0.45)); // avanza a scatti, un morso alla volta
    wp.edge += wp.dir * (2 + 9 * chew) * dt;
    wpClip(b, r, true);
    M.face = wp.dir;
    M.x = scrollX + r.left + clamp(wp.edge - wp.dir * R * scale() * 0.35, 0, r.width); M.y = scrollY + r.bottom;
    M.swingV += (-M.swing * 0.09 + Math.sin(M.t * 0.45) * 0.006) * dt; M.swingV *= Math.pow(0.92, dt); M.swing = clamp(M.swing + M.swingV * dt, -0.4, 0.4);
    if (frame % 3 === 0) parts.push({ k: 'crumb', col: Math.random() < 0.7 ? '#1d2327' : '#a7aaad', x: scrollX + r.left + wp.edge + (Math.random() - 0.5) * 8, y: scrollY + r.top + Math.random() * r.height, vx: (Math.random() - 0.5) * 2, vy: Math.random(), life: 1 });
    if (Math.floor(M.t / 50) !== Math.floor((M.t - dt) / 50)) parts.push({ k: 'txt', ch: pick(['gnam', 'crunch', 'gnam!']), col: '#5b6f96', x: M.x, y: M.y + R * 2.6, vx: 0, vy: -0.4, life: 0.8 });
    if ((wp.dir > 0 && wp.edge >= right) || (wp.dir < 0 && wp.edge <= left)) {
      M.mode = 'fall'; M.vx = 0; M.vy = 1; M.swing = 0; M.y += R * scale() * 2.3; M.full = Math.min(14, M.full + 3);
      wpDone(['Burp! 😋 Sapeva di liquirizia.', 'Gnam! Buonissima, tutta mangiata.', 'Spazzolata! 😋']);
    }
  }
  // carica il raggio (le scintille vanno verso la bocca), poi spara e lo fa scorrere da un capo all'altro
  function barLaserStep(dt) {
    var b = wpBar();
    if (!b) { idle(20); return; }
    var r = b.getBoundingClientRect(), left = Math.max(0, -r.left), right = Math.min(r.width, W - r.left);
    M.t += dt;
    var nz = M.drawn && M.drawn.nose ? toWorld(M.drawn.nose[0], M.drawn.nose[1]) : [M.x + M.face * R * 1.5, M.y - R * 2.4];
    if (M.t < 55) { // carica
      if (frame % 2 === 0) {
        var a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 40;
        parts.push({ k: 'spark', col: Math.random() < 0.5 ? '#9ee7ff' : '#ffffff', x: nz[0] + Math.cos(a) * d, y: nz[1] + Math.sin(a) * d, vx: -Math.cos(a) * d / 14, vy: -Math.sin(a) * d / 14, life: 0.5, nog: true });
      }
      wp.beam = { x0: nz[0], y0: nz[1], charge: M.t / 55 };
      return;
    }
    wp.edge += wp.dir * 11 * dt;
    wpClip(b, r, false);
    var hx = scrollX + r.left + clamp(wp.edge, left, right), hy = scrollY + r.top + r.height * 0.5;
    M.face = hx >= M.x ? 1 : -1;
    wp.beam = { x0: nz[0], y0: nz[1], x1: hx, y1: hy, edgeX: hx, top: scrollY + r.top, h: r.height };
    for (var i = 0; i < 2; i++) parts.push({ k: 'spark', col: pick(['#ffd166', '#ff9f43', '#ffffff']), x: hx, y: scrollY + r.bottom - 2, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 2 + 1, life: 0.7 });
    if (frame % 4 === 0) parts.push({ k: 'smoke', x: hx, y: hy, vx: (Math.random() - 0.5) * 0.6, vy: 0.4 + Math.random() * 0.5, life: 1, r: 5 });
    if ((wp.dir > 0 && wp.edge >= right) || (wp.dir < 0 && wp.edge <= left)) {
      wp.beam = null; idle(40);
      wpDone(['Pew pew! ✨ Barra disintegrata.', 'Laser! 😎 Sparita.', 'Zzzap! ⚡ Fatto.']);
    }
  }
  function drawWpFx() {
    var bm = wp.beam;
    if (!bm) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (bm.x1 == null) { // bagliore che cresce in bocca
      var g = ctx.createRadialGradient(bm.x0, bm.y0, 0, bm.x0, bm.y0, 6 + 18 * bm.charge);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.4, 'rgba(140,225,255,.7)'); g.addColorStop(1, 'rgba(140,225,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bm.x0, bm.y0, 6 + 18 * bm.charge, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return;
    }
    var flick = 0.85 + Math.random() * 0.15;
    ctx.lineCap = 'round';
    [[26, 'rgba(90,200,255,.22)'], [14, 'rgba(130,225,255,.55)'], [6, 'rgba(225,250,255,.95)'], [2.5, '#ffffff']].forEach(function (l) {
      ctx.beginPath(); ctx.moveTo(bm.x0, bm.y0); ctx.lineTo(bm.x1, bm.y1); ctx.lineWidth = l[0] * flick; ctx.strokeStyle = l[1]; ctx.stroke();
    });
    [[bm.x0, bm.y0, 14], [bm.x1, bm.y1, 26]].forEach(function (c) {
      var g2 = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], c[2]);
      g2.addColorStop(0, 'rgba(255,255,255,1)'); g2.addColorStop(0.35, 'rgba(255,210,120,.8)'); g2.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(c[0], c[1], c[2] * flick, 0, Math.PI * 2); ctx.fill();
    });
    // bordo della barra che brucia
    var ge = ctx.createLinearGradient(bm.edgeX - 10, 0, bm.edgeX + 10, 0);
    ge.addColorStop(0, 'rgba(255,140,40,0)'); ge.addColorStop(0.5, 'rgba(255,190,90,.9)'); ge.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = ge; ctx.fillRect(bm.edgeX - 10, bm.top, 20, bm.h);
    ctx.restore();
  }
  function smashStep(dt) {
    var b = wpBar();
    if (!b) { M.mode = 'fall'; M.vy = 0; M.vx = 0; return; }
    var r = b.getBoundingClientRect(), rs = R * scale();
    M.t += dt;
    M.x = scrollX + clamp(M.smashX, r.left + 30, r.right - 30); M.y = scrollY + r.bottom;
    // tre strattoni: la barra trema, le crepe crescono, volano schegge
    var k = Math.floor(M.t / 26);
    if (k > wp.crack && k <= 3) {
      wp.crack = k; wp.shake = 12; M.swingV += k % 2 ? 0.28 : -0.28; M.squash = 0.6;
      for (var i = 0; i < 6; i++) parts.push({ k: 'crumb', col: i % 2 ? '#1d2327' : '#3c434a', x: M.x + (Math.random() - 0.5) * 30, y: M.y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 2, life: 1 });
      if (k === 1) say(pick(['Grrr!', 'Hnnngh!', 'Uno...']));
      if (k === 3) say(pick(['E... VIA!', 'Ancora uno...']));
    }
    M.swingV += -M.swing * 0.09 * dt; M.swingV *= Math.pow(0.92, dt); M.swing = clamp(M.swing + M.swingV * dt, -0.7, 0.7);
    if (wp.shake > 0) { wp.shake -= dt; b.style.transform = 'translate(' + ((Math.random() - 0.5) * 6).toFixed(1) + 'px,' + ((Math.random() - 0.5) * 3).toFixed(1) + 'px)'; }
    else b.style.transform = '';
    if (M.t > 96) {
      b.style.transform = '';
      wpBreak(b, M.x - scrollX);
      M.mode = 'fall'; M.vx = 0; M.vy = 1; M.swing = 0; M.y += rs * 2.3; M.squash = 0.8;
      say(pick(['Crash! 💥', 'Tolta! 💪', 'Ecco fatto, niente più barra!']));
    }
  }
  // la barra va in pezzi: copie della barra ritagliate a schegge che cadono girando
  function wpBreak(b, hx) {
    var r = b.getBoundingClientRect(), w = r.width, h = r.height, lx = hx - r.left, tops = [0], bots = [0], x = 0;
    while (x < w - 40) {
      x += 45 + Math.random() * 90 * (0.5 + Math.abs(x - lx) / w * 2.5);
      if (x >= w - 30) break;
      tops.push(x + (Math.random() - 0.5) * 26); bots.push(x + (Math.random() - 0.5) * 26);
    }
    tops.push(w); bots.push(w);
    for (var i = 0; i < tops.length - 1; i++) {
      var polys, mid = h * (0.35 + Math.random() * 0.3);
      var full = [[tops[i], 0], [tops[i + 1], 0], [bots[i + 1], h], [bots[i], h]];
      if (Math.abs((tops[i] + tops[i + 1]) / 2 - lx) < w * 0.25 && Math.random() < 0.7) {
        var ma = (tops[i] + bots[i]) / 2, mb = (tops[i + 1] + bots[i + 1]) / 2, mj = (ma + mb) / 2;
        polys = [[[tops[i], 0], [tops[i + 1], 0], [mb, mid + 3], [mj, mid - 2], [ma, mid]], [[ma, mid], [mj, mid - 2], [mb, mid + 3], [bots[i + 1], h], [bots[i], h]]];
      } else polys = [full];
      polys.forEach(function (pg) {
        var cx = 0, cy = 0;
        pg.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pg.length; cy /= pg.length;
        var c = b.cloneNode(true);
        c.setAttribute('data-mascot', '1'); c.setAttribute('aria-hidden', 'true');
        c.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + w + 'px;height:' + h + 'px;min-width:0;margin:0;z-index:' + Z +
          ';pointer-events:none;transition:none;transform-origin:' + cx.toFixed(1) + 'px ' + cy.toFixed(1) + 'px;clip-path:polygon(' + pg.map(function (p) { return p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px'; }).join(',') + ')';
        root.insertBefore(c, cv);
        var dx = cx - lx;
        wp.shards.push({ el: c, x: 0, y: 0, vx: clamp(dx * 0.012, -6, 6) + (Math.random() - 0.5) * 2, vy: -1.5 - Math.random() * 3.5 + Math.min(2, Math.abs(dx) / w * 3), a: 0, va: (Math.random() - 0.5) * 0.14, t: 0 });
      });
    }
    for (var j = 0; j < 14; j++) parts.push({ k: 'dust', x: scrollX + r.left + Math.random() * w, y: scrollY + r.bottom, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 1.5, life: 0.9 });
    wpHide();
  }
  function shardStep(dt) {
    for (var i = wp.shards.length - 1; i >= 0; i--) {
      var s = wp.shards[i];
      s.t += dt; s.vy += 0.42 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.a += s.va * dt;
      s.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) rotate(' + s.a.toFixed(3) + 'rad)';
      s.el.style.opacity = clamp(1 - (s.t - 45) / 35, 0, 1);
      if (s.t > 80 || s.y > H + 60) { s.el.remove(); wp.shards.splice(i, 1); }
    }
  }
  function drawWpCracks() {
    if (!wp.crack) return;
    var b = wpBar();
    if (!b) return;
    var r = b.getBoundingClientRect(), ox = scrollX + r.left, oy = scrollY + r.top, show = Math.min(wp.cracks.length, wp.crack * 3 - 1);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, r.width, r.height); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < show; i++) {
      var pts = wp.cracks[i];
      [[3.2, 'rgba(0,0,0,.55)'], [1.3, 'rgba(235,240,245,.9)']].forEach(function (st) {
        ctx.beginPath(); ctx.moveTo(ox + pts[0][0], oy + pts[0][1]);
        for (var k = 1; k < pts.length; k++) ctx.lineTo(ox + pts[k][0], oy + pts[k][1]);
        ctx.lineWidth = st[0]; ctx.strokeStyle = st[1]; ctx.stroke();
      });
    }
    ctx.restore();
  }

  // ---------- nascondino: dietro, sopra e davanti agli elementi ----------
  // 'hide' si infila dietro un elemento (immagine o riquadro colorato) e ci cammina dietro curiosando;
  // 'peekSide' sbircia sporgendosi dal lato tenendosi al bordo; 'peekTop' si aggrappa da dietro al bordo alto e
  // sbuca con la testa; 'climb' si arrampica sulla facciata, visto di spalle, e ogni tanto si volta a guardarti.
  // La parte coperta dall'elemento non si disegna (così sembra davvero dietro). Quando non si vede, un pallino
  // segna dov'è: cliccandolo esce fuori.
  function opaqueEl(el) {
    if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|SVG)$/i.test(el.tagName)) return true;
    var cs = getComputedStyle(el), bg = parseColor(cs.backgroundColor);
    return !!(bg && bg.a >= 0.85) || (!!cs.backgroundImage && cs.backgroundImage !== 'none');
  }
  // nascondigli: elementi visibili, interi nello schermo, abbastanza grandi; dietro solo se sono "pieni" (immagini,
  // video, riquadri con sfondo); per arrampicarsi vanno bene anche blocchi di testo
  var COVER_SEL = 'img,video,picture,canvas,iframe,svg,figure,article,section,aside,div,a,button,li,p,blockquote,[role=img]';
  function coverSpots(kind) {
    var s = R * scale(), low = scrollY + (prefs.water ? waterTop() : H) - 6, out = [], els = document.querySelectorAll(COVER_SEL), checked = 0;
    for (var i = 0; i < els.length && checked < 400 && out.length < 40; i++) {
      var el = els[i], b = el.getBoundingClientRect();
      if (b.width < 3 * s || b.height < 3 * s || b.width * b.height > W * H * 0.45) continue;
      var o = { el: el, l: b.left + scrollX, r: b.right + scrollX, t: b.top + scrollY, b: b.bottom + scrollY };
      if (o.t < scrollY + 50 || o.b > low || o.l < scrollX + 4 || o.r > scrollX + W - 4) continue;
      if (el === curEl() || el.closest('#wpadminbar,[data-mascot],[data-sm-dead]')) continue;
      checked++;
      if (kind === 'climb') { if (b.height > 3.6 * s && (opaqueEl(el) || /^(P|LI|ARTICLE|FIGURE|BLOCKQUOTE|IMG)$/.test(el.tagName))) out.push(o); continue; }
      if (b.width >= 4.2 * s && opaqueEl(el)) out.push(o);
    }
    return out;
  }
  // salto verso un punto preciso (senza fermarsi su altre superfici lungo la strada)
  function flyTo(tx, ty, fn) {
    if (isVert()) M.x += norm() * R;
    var peak = Math.min(M.y, ty) - 40 - Math.random() * 20;
    var vy0 = -Math.sqrt(2 * G * Math.max(10, M.y - peak)), T = -vy0 / G + Math.sqrt(2 * Math.max(0, ty - peak) / G);
    M.att = null; M.mode = 'fall'; M.vy = vy0; M.vx = clamp((tx - M.x) / Math.max(8, T), -14, 14); M.face = M.vx >= 0 ? 1 : -1;
    M.flyTo = { x: tx, y: ty, fn: fn }; M.squash = 0.7; M.jumpTarget = null;
  }
  function goCover(kind) {
    if (!M.att || /^(drag|fall|cling|smash|barEat|barLaser|bye|watch)$/.test(M.mode) || level === 'angolo') return false;
    var c = coverSpots(kind);
    if (!c.length) return false;
    c.sort(function (a, b) { return Math.abs((a.l + a.r) / 2 - M.x) + Math.abs(a.t - M.y) - (Math.abs((b.l + b.r) / 2 - M.x) + Math.abs(b.t - M.y)); });
    var o = c[Math.random() * Math.min(4, c.length) | 0], s = R * scale(), side = M.x < (o.l + o.r) / 2 ? -1 : 1, tx, ty;
    if (kind === 'top') { tx = clamp(M.x, o.l + 1.6 * s, o.r - 1.6 * s); ty = o.t + 2.4 * s; }
    else if (kind === 'climb') { tx = clamp(M.x, o.l + 1.4 * s, o.r - 1.4 * s); ty = o.t + (o.b - o.t) * 0.55 + 1.2 * s; }
    else { tx = side < 0 ? o.l + 1.8 * s : o.r - 1.8 * s; ty = o.b - 1; }
    wake();
    M.plan = []; M.hunt = null; M.pounce = null;
    if (M.toy) giveUpToy();
    flyTo(tx, ty, function () { enterCover(kind, o.el, side); });
    return true;
  }
  function enterCover(kind, el, side) {
    var r = rectOf(el), s = R * scale();
    if (!r) { fall(); return; }
    var how = kind === 'climb' || kind === 'top' || kind === 'side' ? kind : 'hide';
    M.att = { k: 'cover', el: el, how: how, side: side, r: r, dx: M.x - r.l, dy: 0, tx: M.x - r.l, tt: 30, ph: 0, vdir: -1,
      rad: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
    M.vx = 0; M.vy = 0; M.rot = 0; M.squash = 0.5; M.swing = 0; M.swingV = 0; M.peek = 0; M.t = 0;
    if (how === 'top') { M.mode = 'peekTop'; M.peekDy = 2.4 * s; }
    else if (how === 'climb') { M.att.dy = M.y - 2.2 * s - r.t; M.mode = 'climb'; M.t = 300 + Math.random() * 300; M.climbYaw = 0; }
    else if (how === 'side') { M.mode = 'peekSide'; M.face = side; }
    else { M.mode = 'hide'; M.t = 300 + Math.random() * 400; }
    if (Math.random() < 0.6) chat2(pick(how === 'hide' ? ['Nascondino! 🙈', 'Non mi trovi...', 'Shhh!'] : how === 'climb' ? ['Arrampicata!', 'Su, su, su!'] : ['Cucù! 👀', 'Chi c\'è là fuori?']));
  }
  // esce dal nascondiglio: 'top' sale sopra l'elemento, 'pop' salta fuori, altrimenti esce dal lato o si lascia cadere
  function exitCover(how) {
    var a = M.att;
    M.dot = null;
    if (!a || a.k !== 'cover') return;
    var r = rectOf(a.el);
    if (how === 'top' && r) { M.att = { k: 'top', el: a.el }; M.y = r.t; M.x = clamp(M.x, r.l + R, r.r - R); M.squash = 0.6; idle(30); return; }
    M.att = null; M.mode = 'fall'; M.rot = 0;
    if (how === 'pop') { M.vy = -9; M.vx = (Math.random() < 0.5 ? -1 : 1) * 2; M.rot = 0.001; }
    else if (a.how === 'hide' || a.how === 'side') { M.vy = -7; M.vx = (a.side || 1) * 3.5; M.face = a.side || 1; }
    else { M.vy = 0; M.vx = 0; }
  }
  function hideStep(dt) {
    var a = M.att, r = a.r, s = R * scale(), w = r.r - r.l;
    M.t -= dt; a.tt -= dt;
    var d = a.tx - a.dx;
    if (Math.abs(d) > 2) { var st = Math.sign(d) * Math.min(Math.abs(d), 0.7 * spd() * dt); a.dx += st; M.face = st > 0 ? 1 : -1; M.walkPh += 0.16 * dt; M.covWalk = true; }
    else {
      M.covWalk = false;
      if (a.tt <= 0) { a.tx = 1.7 * s + Math.random() * Math.max(1, w - 3.4 * s); a.tt = 50 + Math.random() * 140; }
    }
    if (Math.random() < 0.006 * dt) parts.push({ k: 'txt', ch: pick(['?', '…', '·']), col: '#5b6f96', x: clamp(M.x, r.l + 12, r.r - 12), y: M.y - 2.6 * s, vx: 0, vy: -0.4, life: 0.7 });
    if (M.t > 0) return;
    var k = Math.random();
    if (k < 0.4) { a.how = 'side'; a.side = a.dx < w / 2 ? -1 : 1; M.mode = 'peekSide'; M.t = 0; M.peek = 0; M.face = a.side; }
    else if (k < 0.65) { a.how = 'top'; M.mode = 'peekTop'; M.t = 0; M.peek = 0; M.peekDy = 2.4 * s; a.dx = clamp(a.dx, 1.6 * s, w - 1.6 * s); }
    else exitCover();
  }
  function peekSideStep(dt) {
    var a = M.att, r = a.r, s = R * scale(), w = r.r - r.l;
    M.t += dt;
    // si sporge, resta a guardare, rientra, sta nascosto; due volte, poi cambia
    var c = M.t % 240, out = c < 30 ? c / 30 : c < 150 ? 1 : c < 180 ? 1 - (c - 150) / 30 : 0;
    M.peek = out * out * (3 - 2 * out);
    a.dx = (a.side < 0 ? 0 : w) - a.side * mix(1.9 * s, 0.4 * s, M.peek);
    M.face = a.side;
    if (M.t >= 480) {
      if (Math.random() < 0.5) exitCover();
      else { a.how = 'hide'; M.mode = 'hide'; M.t = 200 + Math.random() * 200; a.tx = w / 2; }
    }
  }
  function peekTopStep(dt) {
    var s = R * scale();
    M.t += dt;
    var c = M.t % 260, up = c < 35 ? c / 35 : c < 190 ? 1 : c < 220 ? 1 - (c - 190) / 30 : 0;
    M.peek = up * up * (3 - 2 * up);
    M.peekDy = mix(2.4 * s, -0.14 * s, M.peek);
    if (M.t >= 520) { M.peekDy = 0; exitCover(Math.random() < 0.6 ? 'top' : 'pop'); }
  }
  function climbStep(dt) {
    var a = M.att, r = a.r, s = R * scale(), h = r.b - r.t;
    M.t -= dt; a.ph += dt;
    var look = Math.sin(a.ph * 0.012) > 0.72; // ogni tanto si ferma e si volta a guardarti
    M.climbYaw += ((look ? 1.5 : 0) - M.climbYaw) * Math.min(1, 0.08 * dt); // la testa si volta verso di te
    if (!look) { a.dy += a.vdir * 0.42 * spd() * dt; M.walkPh += 0.12 * dt; a.dx += Math.sin(a.ph * 0.02) * 0.15 * dt; }
    a.dx = clamp(a.dx, 1.2 * s, r.r - r.l - 1.2 * s);
    if (a.dy <= 0.3 * s) { exitCover('top'); return; } // in cima: ci sale sopra
    if (a.dy >= h - 2.4 * s) a.vdir = -1;
    if (M.t <= 0) { if (Math.random() < 0.5) { a.vdir = -a.vdir; M.t = 200; } else exitCover(); }
  }
  // quanto si vede: se è quasi tutto coperto restituisce il punto dove mettere il pallino
  function coverDot() {
    var a = M.att;
    if (!a || a.k !== 'cover' || !a.r || a.how === 'climb') return null;
    var r = a.r, s = R * scale(), x0, x1, y0, y1;
    if (a.how === 'top') { x0 = M.x - 1.1 * s; x1 = M.x + 1.1 * s; y0 = M.y - 1.5 * s; y1 = M.y + 2.4 * s; }
    else { x0 = M.x - 1.6 * s; x1 = M.x + 1.6 * s; y0 = M.y - 2.6 * s; y1 = M.y; }
    var ix = Math.max(0, Math.min(x1, r.r) - Math.max(x0, r.l)), iy = Math.max(0, Math.min(y1, r.b) - Math.max(y0, r.t));
    if (ix * iy / ((x1 - x0) * (y1 - y0)) < 0.88) return null;
    return [clamp(M.x, r.l + 14, r.r - 14), clamp(a.how === 'top' ? r.t + 16 : M.y - 1.6 * s, r.t + 14, r.b - 14)];
  }
  function coverClip() {
    var a = M.att;
    if (!a || a.k !== 'cover' || !a.r || a.how === 'climb') return null;
    return { l: a.r.l, t: a.r.t, w: a.r.r - a.r.l, h: a.r.b - a.r.t, rad: Math.min(a.rad, (a.r.b - a.r.t) / 2) };
  }
  function drawCoverExtras() {
    var a = M.att, s = R * scale();
    // zampina che si tiene al bordo quando sbircia dal lato
    if (a && a.k === 'cover' && a.how === 'side' && M.peek > 0.4 && a.r) {
      var ex = (a.side < 0 ? a.r.l : a.r.r) + a.side * 0.05 * s, ey = M.y - 1.45 * s;
      ctx.save(); ctx.globalAlpha = Math.min(1, (M.peek - 0.4) * 3);
      ctx.beginPath(); ctx.ellipse(ex, ey, 0.15 * s, 0.12 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = BLUE; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
      line([ex + a.side * 0.04 * s, ey - 0.07 * s, ex + a.side * 0.1 * s, ey - 0.02 * s], 1, 'rgba(43,59,97,.6)');
      line([ex + a.side * 0.04 * s, ey + 0.05 * s, ex + a.side * 0.1 * s, ey + 0.02 * s], 1, 'rgba(43,59,97,.6)');
      ctx.restore();
    }
    var d = M.dot;
    if (!d) return;
    var p = Math.sin(frame * 0.1);
    ctx.save();
    ctx.beginPath(); ctx.arc(d[0], d[1], 13 + p * 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(79,116,179,.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(d[0], d[1], 6.5, 0, Math.PI * 2); ctx.fillStyle = '#4f74b3'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.restore();
  }

  // ---------- corsa pazza ----------
  // Come i gatti: di colpo si acquatta e parte di corsa avanti e indietro. Al bordo dello schermo a volte corre su per il
  // muro e fa una capriola all'indietro (o salta sopra un elemento lì vicino), a volte salta e sbatte contro il muro,
  // a volte frena e torna indietro; ogni tanto inciampa e rotola, e ogni tanto prova a saltare fuori dallo schermo verso
  // di te e si spiaccica sul vetro, poi ci scivola giù. Dopo qualche giro si siede col fiatone.
  // M.zs (grandezza), M.zsx/M.zsy (schiacciato), M.zang (corpo in verticale sul muro), M.zrot (capriola) servono al disegno.
  var ZOOM_FREE = /^(glass|wallrun|leapwall|bonk)$/; // fasi in cui non poggia su niente: la posizione la decide la corsa
  function zr() { return R * scale(); }
  // dove può correre: il fondo dello schermo o la cima dell'elemento, ma sempre dentro lo schermo. Se l'elemento continua
  // oltre il bordo (slider, fasce larghe), il bordo dello schermo fa da muro (wallL/wallR) invece di farlo uscire di vista.
  function zoomBounds() {
    var a = M.att, rs = zr(), vl = scrollX + rs * 1.1, vr = scrollX + W - rs * 1.1;
    if (!a || isVert()) return null;
    if (a.k === 'top') {
      var r = rectOf(a.el);
      if (!r) return null;
      var l = r.l + rs * 0.6, rr = r.r - rs * 0.6;
      return { l: Math.max(l, vl), r: Math.min(rr, vr), floor: false, wallL: l <= vl, wallR: rr >= vr };
    }
    if (a.k === 'floor') return { l: vl, r: vr, floor: true, wallL: true, wallR: true };
    return null;
  }
  function startZoom() {
    if (F || /^(drag|bye|cling|smash|barEat|barLaser)$/.test(M.mode)) return false;
    if (level === 'angolo') { say('Dall\'angolo non mi muovo! 😴'); return false; }
    wake();
    if (M.toy) giveUpToy();
    dropBall();
    M.hunt = null; M.pounce = null; M.plan = []; M.eat = null; M.follow = 0; M.flyTo = null;
    M.zoom = { sub: 'start', t: 0, laps: 0, max: 4 + (Math.random() * 4 | 0), dir: M.face, sp: 0, after: null };
    var a = M.att, rs = zr(), ra = a && a.k === 'top' ? rectOf(a.el) : null;
    if (a && !isVert() && ((a.k === 'floor' && !prefs.water) || (ra && ra.r - ra.l > 320))) { M.mode = 'zoom'; return true; }
    // prima va dove c'è spazio: il fondo dello schermo (con l'acqua, l'elemento più largo in vista)
    if (prefs.water) {
      var c = visibleTargets().filter(function (s) { return s.r - s.l > 320; }).sort(function (p, q) { return (q.r - q.l) - (p.r - p.l); });
      if (!c.length || inWater() || !M.att) { M.zoom = null; say('Qui non ho spazio per correre! 🏃'); return false; }
      jumpTo(c[0].el); return true;
    }
    flyTo(clamp(M.x, scrollX + rs * 2, scrollX + W - rs * 2), scrollY + H - 2, function () { M.att = { k: 'floor' }; M.y = scrollY + H - 2; settle(); });
    return true;
  }
  function endZoom(quiet) {
    M.zoom = null; M.zs = 1; M.zsx = 1; M.zsy = 1; M.zang = 0; M.zrot = 0;
    if (M.mode === 'zoom') { idle(quiet ? 20 : 70); if (!quiet) chat2(pick(['Hhh... che corsa! 😅', 'Fiuuu! Ok, ora mi calmo.', 'Che bello correre! 💨'])); }
  }
  // dopo un salto o una caduta riprende la corsa (o resta stordito)
  function zoomLanded() {
    var z = M.zoom;
    if (!M.att || isVert() || M.att.k === 'water' || M.att.k === 'cover') { endZoom(true); return; }
    M.mode = 'zoom'; M.zang = 0; M.zrot = 0;
    z.sub = z.after || (z.laps >= z.max ? 'pant' : 'run'); z.after = null; z.t = 0; z.sp = z.sub === 'run' ? 2.5 : 0;
  }
  // un elemento più in alto davanti a lui, su cui saltare correndo
  function ledgeAhead(dir) {
    var c = surfList.filter(function (s) {
      var ax = M.x + dir * 60, bx = M.x + dir * 230;
      return s.t < M.y - 50 && s.t > M.y - 200 && s.t > scrollY + 50 && s.r - s.l > 100 && Math.min(s.r, Math.max(ax, bx)) > Math.max(s.l, Math.min(ax, bx)) && !s.el.closest('[data-sm-dead]');
    });
    return c.length ? pick(c).el : null;
  }
  function zoomStep(dt) {
    var z = M.zoom, rs = zr(), b, i;
    if (!z) { idle(20); return; }
    z.t += dt;
    z.age = (z.age || 0) + dt;
    if (z.age > 3000 && z.sub !== 'glass') { endZoom(); return; } // nessuna corsa dura più di 50 secondi
    if (z.sub === 'glass') { glassStep(dt); return; }
    if (!ZOOM_FREE.test(z.sub)) {
      if (!stand()) { z.after = 'run'; return; } // l'elemento è finito: cade e poi riprende
      b = zoomBounds();
      if (!b) { endZoom(true); return; }
    }
    switch (z.sub) {
      case 'start': // si acquatta muovendo il sedere, poi parte
        M.face = z.dir;
        if (z.laps >= z.max) { z.sub = 'pant'; z.t = 0; break; }
        if (z.t > 26) { z.sub = 'run'; z.t = 0; z.sp = 0; if (z.laps === 0 && Math.random() < 0.6) chat2(pick(['Wheee! 🏃', 'Corsa pazza!', 'Non mi prendi! 💨'])); }
        break;
      case 'run': {
        var max = 5.8 * rs / 16 * (0.85 + 0.15 * spd());
        z.sp = Math.min(max, z.sp + 0.4 * dt);
        // sicurezza: se corre ma non avanza (qualcosa lo trattiene), frena e torna indietro
        z.stuck = z.px != null && Math.abs(M.x - z.px) < 0.05 ? (z.stuck || 0) + dt : 0;
        if (z.stuck > 40) { z.stuck = 0; z.px = null; z.plan = null; z.sub = 'skid'; z.t = 0; break; }
        M.x = clamp(M.x + z.dir * z.sp * dt, Math.min(b.l, M.x), Math.max(b.r, M.x)); z.px = M.x; M.face = z.dir; M.walkPh += 0.13 * z.sp * dt;
        if (frame % 4 === 0) parts.push({ k: 'dust', x: M.x - z.dir * rs, y: M.y, vx: -z.dir * (1 + Math.random()), vy: -Math.random(), life: 0.6 });
        // a metà corsa: inciampa, prova il vetro, salta su un elemento
        if (z.sp > max * 0.8 && z.t > 18) {
          if (Math.random() < 0.0035 * dt) { z.sub = 'trip'; z.t = 0; break; }
          if (z.laps > 0 && !z.glassDone && !prefs.noGlass && Math.random() < 0.004 * dt) { startGlass(); break; }
          if (b.floor && frame % 12 === 0 && Math.random() < 0.3) {
            var lg = ledgeAhead(z.dir);
            if (lg) { z.after = 'run'; jumpTo(lg); M.squash = 0.6; if (Math.random() < 0.4) chat2('Hop! 😼'); break; }
          }
        }
        var edge = z.dir > 0 ? b.r : b.l, dist = (edge - M.x) * z.dir, wallHere = z.dir > 0 ? b.wallR : b.wallL;
        // vicino al muro dello schermo decide: corsa sul muro, salto contro il muro o frenata
        if (wallHere && dist < rs * 3.5 && !z.plan) {
          var k = Math.random();
          z.plan = k < 0.42 ? 'wallrun' : k < 0.7 ? 'bonk' : 'skid';
          if (z.plan === 'bonk') { z.sub = 'leapwall'; z.t = 0; z.vx = z.dir * Math.max(4, z.sp); z.vy = -6; z.plan = null; z.base = M.y; break; }
        }
        if (dist <= 0) {
          M.x = edge; z.px = null;
          if (!wallHere) { // fine dell'elemento: salta giù e continua di sotto
            z.laps++; z.after = 'run'; z.plan = null;
            M.att = null; M.mode = 'fall'; M.vx = z.dir * 3.5; M.vy = -5; M.rot = 0;
            break;
          }
          z.sub = z.plan === 'wallrun' ? 'wallrun' : 'skid'; z.t = 0; z.wy = 0; z.plan = null; z.base = M.y;
          z.wh = clamp(110 + Math.random() * 100, 60, M.y - scrollY - 90);
        }
        break;
      }
      case 'skid': // frena scivolando, si gira e riparte dall'altra parte
        M.x = clamp(M.x + z.dir * z.sp * Math.max(0, 1 - z.t / 16) * 0.5 * dt, b.l, b.r);
        if (frame % 2 === 0) parts.push({ k: 'dust', x: M.x + z.dir * rs * 0.6, y: M.y, vx: z.dir * Math.random() * 2, vy: -Math.random() * 1.5, life: 0.6 });
        if (z.t > 18) { z.dir = -z.dir; z.laps++; z.sp = 0; z.sub = z.laps >= z.max ? 'pant' : 'run'; z.t = 0; }
        break;
      case 'wallrun': { // corre su per il muro dello schermo, poi capriola all'indietro (o salta su un elemento vicino)
        var side = z.dir;
        M.x = side > 0 ? scrollX + W : scrollX; M.face = side;
        M.zang = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        z.wy += 6.5 * dt; M.y = z.base - z.wy; M.walkPh += 0.8 * dt;
        if (z.wy >= z.wh) {
          M.zang = 0; M.att = null; z.dir = -side; z.laps++; z.after = 'run';
          var near = surfList.filter(function (s) {
            return s.t > M.y - 70 && s.t < M.y + 90 && s.t > scrollY + 50 && s.r - s.l > 80 && (side > 0 ? s.r > scrollX + W - 320 : s.l < scrollX + 320) && !s.el.closest('[data-sm-dead]');
          });
          if (near.length && Math.random() < 0.6) { M.x += -side * rs; jumpTo(pick(near).el); M.rot = 0.001; chat2(pick(['Parkour! 😎', 'Hop! 😼'])); }
          else { M.mode = 'fall'; M.x += -side * rs; M.vx = -side * 4.5; M.vy = -6.5; M.rot = 0.001; M.face = -side; if (Math.random() < 0.4) chat2('Parkour! 😎'); }
        }
        break;
      }
      case 'leapwall': // salta verso il muro...
        z.vy += G * dt; M.x += z.vx * dt; M.y += z.vy * dt; M.face = z.dir;
        var wall = z.dir > 0 ? scrollX + W - rs * 1.7 : scrollX + rs * 1.7; // si ferma quando il muso tocca il bordo
        if ((M.x - wall) * z.dir >= 0) { // ...e ci sbatte contro
          M.x = wall; z.sub = 'bonk'; z.t = 0; M.gshake = 8;
          parts.push({ k: 'txt', ch: 'BONK!', col: '#e0566b', x: M.x - z.dir * rs, y: M.y - rs * 2.6, vx: -z.dir * 0.4, vy: -0.7, life: 1, big: true });
          for (i = 0; i < 6; i++) parts.push({ k: 'spark', col: '#ffd166', x: M.x + z.dir * rs * 0.4, y: M.y - rs * 1.2, vx: -z.dir * Math.random() * 3, vy: (Math.random() - 0.5) * 4, life: 0.6 });
        } else if (M.y >= z.base) { M.y = z.base; z.sub = 'skid'; z.t = 0; }
        break;
      case 'bonk': // spiaccicato contro il muro, poi cade all'indietro
        M.zsx = mix(0.68, 1, Math.min(1, z.t / 26)); M.zsy = mix(1.14, 1, Math.min(1, z.t / 26));
        if (z.t > 26) {
          M.zsx = 1; M.zsy = 1; M.att = null; M.mode = 'fall'; M.vx = -z.dir * 1.6; M.vy = 0.5; M.rot = 0.001;
          z.after = 'dizzy'; z.dir = -z.dir; z.laps++;
          if (Math.random() < 0.5) say(pick(['Ahia! 😵', 'Il muro! 😵‍💫', 'Ouch...']));
        }
        break;
      case 'trip': // inciampa: rotola in avanti
        M.x = clamp(M.x + z.dir * z.sp * Math.max(0, 1 - z.t / 30) * dt, b.l, b.r);
        M.zrot = z.dir * Math.min(1, z.t / 26) * Math.PI * 2;
        if (frame % 3 === 0) parts.push({ k: 'dust', x: M.x, y: M.y, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 1.5, life: 0.6 });
        if (z.t >= 28) { M.zrot = 0; z.sub = 'sprawl'; z.t = 0; M.squash = 0.9; }
        break;
      case 'sprawl': // lungo disteso
        if (z.t > 12 && z.t < 14 && Math.random() < 0.7) chat2(pick(['Ops! 😅', 'Non ho visto niente.', 'Tutto calcolato!']));
        if (z.t > 55) { z.sub = 'start'; z.t = 8; }
        break;
      case 'dizzy': // stordito, con le stelline
        if (z.t > 80) { z.sub = z.laps >= z.max ? 'pant' : 'start'; z.t = 0; }
        break;
      case 'pant': // fiatone, seduto
        if (z.t > 120) endZoom();
        break;
      default: endZoom(true);
    }
  }
  // salto verso chi guarda: si ingrandisce, si spiaccica sul vetro dello schermo e ci scivola giù
  function startGlass() {
    var z = M.zoom;
    z.sub = 'glass'; z.t = 0; z.glassDone = true;
    z.g = { x0: M.x - scrollX, y0: M.y - scrollY, att: M.att, sl: 0 };
  }
  function glassStep(dt) {
    var z = M.zoom, g = z.g, t = z.t, rs = R * scale(), big = 3.3;
    var cx = mix(g.x0, W / 2, 0.35), cy = H * 0.5 + rs * big * 1.25; // dove si spiaccica (piedi, coordinate dello schermo)
    if (t < 22) { M.zs = 1; M.x = scrollX + g.x0; M.y = scrollY + g.y0; }
    else if (t < 52) { // il salto verso di te
      var k = (t - 22) / 30, e = k * k;
      M.zs = 1 + (big - 1) * e;
      M.x = scrollX + mix(g.x0, cx, k); M.y = scrollY + mix(g.y0, cy, e) - Math.sin(k * Math.PI) * 50;
    } else if (t < 196) { // spiaccicato, poi scivola giù lasciando la scia
      if (!g.hit) {
        g.hit = true; M.gshake = 12;
        g.sx = cx; g.sy = cy;
        if (Math.random() < 0.7) say(pick(['Ahi! Il vetro! 😵', 'C\'è un vetro?! 😳', 'Toc toc... fammi uscire!']));
      }
      M.zs = big + Math.sin(t * 0.4) * 0.03 * Math.max(0, 1 - (t - 52) / 20);
      if (t > 120) { g.sl += (0.4 + (t - 120) * 0.035) * dt; if (frame % 14 === 0) parts.push({ k: 'txt', ch: pick(['iiih', 'squiik']), col: '#5b6f96', x: scrollX + cx + rs * big * 1.3, y: scrollY + cy - rs * big * 1.8 + g.sl, vx: 0.3, vy: -0.3, life: 0.7 }); }
      M.x = scrollX + g.sx; M.y = scrollY + g.sy + g.sl;
    } else if (t < 222) { // torna nella pagina, piccolo come prima
      var k2 = (t - 196) / 26, e2 = 1 - (1 - k2) * (1 - k2);
      M.zs = mix(big, 1, e2);
      M.x = scrollX + mix(g.sx, g.x0, e2); M.y = scrollY + mix(g.sy + g.sl, g.y0, e2);
    } else {
      M.zs = 1; M.att = g.att && (g.att.k === 'floor' || rectOf(g.att.el)) ? g.att : { k: 'floor' };
      M.x = scrollX + g.x0; M.y = scrollY + g.y0; M.squash = 0.9;
      z.sub = 'dizzy'; z.t = 0; z.laps++;
      if (!stand()) z.after = 'dizzy';
    }
  }
  // stelline, linee di velocità e il vetro (alone del fiato, riflessi, scia)
  function drawZoomExtras() {
    var z = M.zoom, rs = R * scale(), i;
    if (!z) return;
    if (z.sub === 'run' && z.sp > 3) {
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(90,110,160,.35)'; ctx.lineWidth = 2;
      [0.6, 1.1, 1.5].forEach(function (h, j) {
        var x0 = M.x - z.dir * rs * (1.9 + j * 0.25), len = rs * (1 + Math.sin(frame * 0.5 + j) * 0.3);
        ctx.beginPath(); ctx.moveTo(x0, M.y - rs * h); ctx.lineTo(x0 - z.dir * len, M.y - rs * h); ctx.stroke();
      });
      ctx.restore();
    }
    if (z.sub === 'dizzy') {
      var hp = M.drawn && M.drawn.top ? toWorld(M.drawn.top[0], M.drawn.top[1]) : [M.x, M.y - rs * 2.5];
      for (i = 0; i < 3; i++) {
        var an = frame * 0.09 + i * Math.PI * 2 / 3, px = hp[0] + Math.cos(an) * rs * 0.9, py = hp[1] - rs * 0.25 + Math.sin(an) * rs * 0.25;
        ctx.save(); ctx.translate(px, py); ctx.rotate(frame * 0.1); ctx.fillStyle = '#ffd400'; ctx.strokeStyle = '#8a6a00'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (var j = 0; j < 10; j++) { var a3 = j * Math.PI / 5, r3 = j % 2 ? 2 : 5; ctx.lineTo(Math.cos(a3) * r3, Math.sin(a3) * r3); }
        ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
    if (z.sub === 'glass' && z.g && z.g.hit && z.t < 200) {
      var g = z.g, big = rs * M.zs, gx = scrollX + g.sx, gy = scrollY + g.sy;
      ctx.save();
      // scia sul vetro mentre scivola
      if (g.sl > 2) {
        var gr = ctx.createLinearGradient(0, gy - big * 2.2, 0, gy - big * 2.2 + g.sl);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.35)');
        ctx.fillStyle = gr; fRound(gx - big * 0.9, gy - big * 2.2, big * 1.8, g.sl, big * 0.4); ctx.fill();
      }
      // alone del fiato sul vetro
      var nz = M.drawn && M.drawn.nose ? toWorld(M.drawn.nose[0], M.drawn.nose[1]) : [M.x, M.y - big * 1.6];
      var fog = ctx.createRadialGradient(nz[0], nz[1] + big * 0.2, 0, nz[0], nz[1] + big * 0.2, big * (0.9 + Math.sin(frame * 0.08) * 0.1));
      fog.addColorStop(0, 'rgba(255,255,255,.45)'); fog.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fog; ctx.beginPath(); ctx.arc(nz[0], nz[1] + big * 0.2, big * 1.1, 0, Math.PI * 2); ctx.fill();
      // riflessi del vetro
      ctx.lineCap = 'round';
      [[10, 'rgba(255,255,255,.22)', 0], [3, 'rgba(255,255,255,.5)', big * 0.35]].forEach(function (l) {
        ctx.beginPath(); ctx.moveTo(gx - big * 2.6 + l[2], gy - big * 3.2); ctx.lineTo(gx - big * 1.2 + l[2], gy - big * 1.2);
        ctx.lineWidth = l[0]; ctx.strokeStyle = l[1]; ctx.stroke();
      });
      // SPLAT!
      if (z.t < 100) {
        var p = (z.t - 52) / 48, sc = Math.min(1, p * 6);
        ctx.translate(gx + big * 1.6, gy - big * 2.8); ctx.rotate(0.15); ctx.scale(sc, sc); ctx.globalAlpha = clamp((1 - p) * 3, 0, 1);
        ctx.font = '900 34px Impact,"Arial Black",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1b2a4a'; ctx.strokeText('SPLAT!', 0, 0);
        ctx.fillStyle = '#9ee7ff'; ctx.fillText('SPLAT!', 0, 0);
      }
      ctx.restore();
    }
  }

  // ---------- pallina ----------
  // Dal menu (🎾) o in chat compare una pallina: la prendi col mouse (o col dito) e gliela lanci. Lui la insegue e la
  // prende in bocca; se è in aria alla sua portata salta e la prende al volo, se finisce sopra un elemento ci salta sopra.
  // Poi ci gioca: la lancia in aria e la riprende, le dà una zampata e la rincorre, te la rilancia e aspetta che tu la
  // tiri di nuovo, o si accoccola con lei. Se gliela togli di bocca protesta.
  var B = null;
  function ballFloor() { return scrollY + (prefs.water ? waterTop() : H - 2); }
  function ballVisible() { return !!B && B.y > scrollY - 80 && B.y < scrollY + H + 60; }
  function spawnBall() {
    var x = mouseFresh() ? mousePage()[0] : M.x + M.face * 140;
    B = { x: clamp(x, scrollX + 30, scrollX + W - 30), y: scrollY + H * 0.25, vx: (Math.random() - 0.5) * 3, vy: 0, r: 7.5 * R / 16, held: null, spin: 0, on: null, sq: 0 };
    later(function () { if (B && !B.held) startBallChase(); }, 500);
    return B;
  }
  function removeBall() {
    if (M.ball) { M.ball = null; if (M.mode === 'ball') idle(40); }
    B = null; ballGrab.style.display = 'none';
  }
  // la lascia cadere dov'è (quando smette di giocare o fa altro)
  function dropBall() {
    if (B && B.held === 'nimblu') { B.held = null; B.vx = M.face * 1.5; B.vy = -2; B.on = null; }
    M.ball = null;
  }
  function ballHoldPos() {
    var rs = zr(), g = M.ball;
    if (g && g.inHands) { var hw = handsWorld(); return [hw[0], hw[1] - B.r * 0.6]; }
    var nz = M.drawn && M.drawn.nose && !M.drawn.hang ? toWorld(M.drawn.nose[0], M.drawn.nose[1]) : [M.x + M.face * rs * 1.5, M.y - rs * 1.4];
    return [nz[0] + M.face * B.r * 0.55, nz[1] + B.r * 0.35];
  }
  function ballStep(dt) {
    if (!B) return;
    if (B.held === 'nimblu') { var hp = ballHoldPos(); B.x = hp[0]; B.y = hp[1]; B.vx = 0; B.vy = 0; return; }
    if (B.held === 'user') return; // la muovi tu col puntatore
    if (B.sq > 0) B.sq = Math.max(0, B.sq - 0.12 * dt);
    var py = B.y, fl = ballFloor();
    if (B.on) { // appoggiata: segue il suo elemento (o il fondo dello schermo); se finisce oltre il bordo cade
      if (B.on === 'floor') B.y = fl - B.r + (prefs.water ? Math.sin(frame * 0.05) * 1.5 + B.r * 0.5 : 0);
      else { var r = rectOf(B.on); if (!r || B.x < r.l - 2 || B.x > r.r + 2) B.on = null; else B.y = r.t - B.r; }
      B.vx *= Math.pow(prefs.water && B.on === 'floor' ? 0.98 : 0.975, dt);
      if (Math.abs(B.vx) < 0.04) B.vx = 0;
      B.x += B.vx * dt; B.spin += B.vx / B.r * dt;
    }
    if (!B.on) {
      B.vy = Math.min(22, B.vy + 0.5 * dt);
      B.x += B.vx * dt; B.y += B.vy * dt; B.spin += B.vx * 0.06 * dt;
      if (B.y < scrollY + B.r + 2 && B.vy < 0) { B.y = scrollY + B.r + 2; B.vy = -B.vy * 0.5; }
      if (B.vy > 0) {
        var landY = null, el = null;
        for (var i = 0; i < surfList.length; i++) {
          var s = surfList[i];
          if (B.x >= s.l && B.x <= s.r && py + B.r <= s.t + 2 && B.y + B.r >= s.t && s.t > scrollY + 20 && !s.el.closest('[data-sm-dead]')) { landY = s.t; el = s.el; break; }
        }
        if (landY == null && B.y + B.r >= fl) { landY = fl; el = 'floor'; }
        if (landY != null) {
          B.y = landY - B.r;
          if (B.vy > 2.2) { B.sq = Math.min(1, B.vy / 12); B.vy = -B.vy * (prefs.water && el === 'floor' ? 0.25 : 0.58); B.vx *= 0.9; if (el === 'floor' && prefs.water) splash(B.x, 4); }
          else { B.vy = 0; B.on = el; }
        }
      }
    }
    if (B.x < scrollX + B.r) { B.x = scrollX + B.r; B.vx = Math.abs(B.vx) * 0.7; }
    if (B.x > scrollX + W - B.r) { B.x = scrollX + W - B.r; B.vx = -Math.abs(B.vx) * 0.7; }
  }
  function drawBall() {
    var r = B.r;
    if (B.on && !B.held) { ctx.fillStyle = 'rgba(40,60,100,.16)'; ctx.beginPath(); ctx.ellipse(B.x, B.y + r - 1, r * 0.9, r * 0.22, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.save();
    ctx.translate(B.x, B.y);
    if (B.sq) ctx.scale(1 + B.sq * 0.25, 1 - B.sq * 0.25);
    ctx.rotate(B.spin);
    var gr = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    gr.addColorStop(0, '#f2fb8a'); gr.addColorStop(1, '#bccf2e');
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 1.3; ctx.strokeStyle = '#6f7b18'; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.lineWidth = Math.max(1.2, r * 0.2); ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath(); ctx.arc(-r * 1.2, 0, r * 0.88, -0.95, 0.95); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 1.2, 0, r * 0.88, Math.PI - 0.95, Math.PI + 0.95); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  // tu e la pallina: la prendi (anche di bocca a lui), la trascini e la lanci; un clic la fa saltare
  function ballDown(e) {
    if (!B) return;
    e.preventDefault(); e.stopPropagation();
    try { ballGrab.setPointerCapture(e.pointerId); } catch (x) {}
    var took = B.held === 'nimblu';
    if (took) { dropBall(); say(pick(['Ehi! Ridammela! 😾', 'La mia pallina!', 'Nooo, era mia!'])); }
    B.held = 'user'; B.on = null; B.sq = 0;
    B.drag = { sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, vx: 0, vy: 0, moved: false };
    ballGrab.style.cursor = 'grabbing';
    if (ballCan() && M.att && !isVert() && !/^(water|cover|vbot)$/.test(M.att.k)) { M.mode = 'ball'; M.ball = { sub: 'watch', t: 0, plays: 0, max: 6 + (Math.random() * 5 | 0) }; }
  }
  function ballMove(e) {
    var d = B && B.held === 'user' && B.drag;
    if (!d) return;
    var dx = e.clientX - d.px, dy = e.clientY - d.py;
    d.vx = d.vx * 0.4 + dx * 0.6; d.vy = d.vy * 0.4 + dy * 0.6; d.px = e.clientX; d.py = e.clientY;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
    B.x = e.clientX + scrollX; B.y = e.clientY + scrollY;
  }
  function ballUp() {
    var d = B && B.held === 'user' && B.drag;
    ballGrab.style.cursor = 'grab';
    if (!d) return;
    B.held = null; B.drag = null; B.on = null;
    if (d.moved) { B.vx = clamp(d.vx * 1.2, -26, 26); B.vy = clamp(d.vy * 1.2, -28, 24); }
    else { B.vy = -9; B.vx = (Math.random() - 0.5) * 2; } // un clic: la fa saltare
    if (M.ball && M.mode === 'ball') { M.ball.sub = 'chase'; M.ball.t = 0; if (Math.random() < 0.4) chat2(pick(['La prendo! 🎾', 'Vai! 💨', 'Mia mia mia!'])); }
    else startBallChase();
  }
  function ballCan() { return !!B && !F && !M.zoom && level !== 'angolo' && !/^(drag|bye|fall|cling|smash|barEat|barLaser|eat|swim)$/.test(M.mode) && !inWater(); }
  function startBallChase() {
    if (!ballCan() || !ballVisible()) return false;
    wake(); M.plan = []; M.hunt = null; M.pounce = null; M.follow = 0;
    if (M.toy) giveUpToy();
    var g = M.ball || { plays: 0, max: 6 + (Math.random() * 5 | 0) };
    g.sub = B.held === 'nimblu' ? 'hold' : 'chase'; g.t = 0; g.jcd = 0; g.stand = false; g.inHands = false;
    M.ball = g;
    if (!M.att || isVert() || M.att.k === 'cover' || M.att.k === 'vbot') { // prima scende da dov'è
      var rs = zr();
      flyTo(clamp(B.x - rs * 2, scrollX + rs * 2, scrollX + W - rs * 2), scrollY + H - 2, function () { M.att = { k: 'floor' }; M.y = scrollY + H - 2; settle(); });
      return true;
    }
    M.mode = 'ball';
    return true;
  }
  function endBall(msg) {
    dropBall();
    if (M.mode === 'ball') idle(60);
    if (msg) chat2(msg);
  }
  function grabBall(air) {
    var g = M.ball;
    B.held = 'nimblu'; B.on = null; B.vx = 0; B.vy = 0;
    if (g) { g.plays++; g.sub = 'hold'; g.t = 0; g.inHands = false; g.stand = false; }
    parts.push({ k: 'txt', ch: '✦', col: '#c3d63a', x: B.x, y: B.y - 10, vx: 0, vy: -0.6, life: 0.8 });
    if (air) say(pick(['Presa al volo! 😼', 'Al volo! 🎾', 'Che riflessi!']));
    else if (Math.random() < 0.35) chat2(pick(['Presa! 😸', 'Mia!', 'Ce l\'ho!']));
  }
  // salto per prenderla in aria: mira dove sarà la pallina quando lui arriva in cima al salto
  function ballLeap() {
    var rs = zr(), up = M.y - rs * 1.6 - B.y, vy0 = -Math.min(17, Math.sqrt(2 * G * Math.max(20, up + 25))), T = -vy0 / G;
    var bx = B.x + B.vx * T;
    M.att = null; M.mode = 'fall'; M.vy = vy0; M.vx = clamp((bx - M.x) / T, -9, 9); M.face = M.vx >= 0 ? 1 : -1;
    M.ballJump = true; M.squash = 0.7; M.rot = 0;
  }
  // salto verso l'elemento dove è finita la pallina (vicino a lei)
  function ballJumpTo(el) {
    var r = rectOf(el), rs = zr();
    if (!r) return;
    var tx = clamp(B.x - (B.x >= M.x ? 1 : -1) * rs * 1.5, r.l + rs * 0.6, r.r - rs * 0.6);
    var peak = Math.min(M.y, r.t) - 45, vy0 = -Math.sqrt(2 * G * (M.y - peak)), T = -vy0 / G + Math.sqrt(2 * (r.t - peak) / G);
    M.att = null; M.vx = (tx - M.x) / T; M.vy = vy0; M.face = M.vx >= 0 ? 1 : -1;
    M.jumpTarget = el; M.mode = 'fall'; M.squash = 0.8;
  }
  function ballAI(dt) {
    var g = M.ball, rs = zr(), i;
    if (!g || !B) { M.ball = null; idle(30); return; }
    g.t += dt;
    if (g.jcd > 0) g.jcd -= dt;
    if (!stand()) return; // è caduto: riprende quando atterra
    if (isVert() || !M.att || /^(water|cover|vbot)$/.test(M.att.k)) { endBall(); return; }
    var ra = M.att.k === 'top' ? rectOf(M.att.el) : null, lo = Math.max(ra ? ra.l + rs * 0.4 : scrollX + rs, scrollX + rs), hi = Math.min(ra ? ra.r - rs * 0.4 : scrollX + W - rs, scrollX + W - rs);
    if (hi < lo) hi = lo;
    var dx = B.x - M.x, dir = dx >= 0 ? 1 : -1;
    g.run = false; g.stand = false;
    switch (g.sub) {
      case 'watch': // la tieni tu: la segue con gli occhi, acquattato e pronto
        M.face = dir;
        if (B.held !== 'user') { g.sub = 'chase'; g.t = 0; }
        break;
      case 'chase': {
        if (B.held === 'user') { g.sub = 'watch'; break; }
        if (B.held === 'nimblu') { g.sub = 'hold'; g.t = 0; break; }
        if (!ballVisible() || g.t > 1100) { endBall('Dov\'è finita? 🤔'); break; }
        var above = M.y - (B.y + B.r);
        var mouth = [M.x + M.face * rs * 1.6, M.y - rs * 0.6];
        // presa: la pallina è davanti al muso
        if (Math.hypot(B.x - mouth[0], B.y - mouth[1]) < B.r + rs * 0.75) { grabBall(false); break; }
        // in aria sopra di lui, alla sua portata: salta e la prende al volo
        if (!B.on && B.vy > -4 && above > rs * 1.8 && above < 280 && Math.abs(dx) < 170 && g.jcd <= 0) { g.jcd = 45; ballLeap(); break; }
        // ferma sopra un altro elemento: ci salta sopra
        if (B.on && B.on !== 'floor' && B.on !== M.att.el && rectOf(B.on)) { ballJumpTo(B.on); break; }
        // giù in fondo allo schermo mentre lui è sopra un elemento: salta giù
        if (B.on === 'floor' && M.att.k === 'top') {
          flyTo(clamp(B.x - dir * rs * 2, scrollX + rs * 2, scrollX + W - rs * 2), scrollY + H - 2, function () { M.att = { k: 'floor' }; M.y = scrollY + H - 2; settle(); });
          break;
        }
        // corre verso la pallina (o sotto di lei se è in aria)
        var tx = clamp(B.x - dir * rs * 1.3, lo, hi), d2 = tx - M.x;
        g.stuck = g.px != null && Math.abs(M.x - g.px) < 0.05 && Math.abs(d2) > 3 ? (g.stuck || 0) + dt : 0;
        if (g.stuck > 90) { endBall('Non ci arrivo! 😿'); break; }
        if (Math.abs(d2) > 3) { var sp = Math.min(Math.abs(d2), 3.8 * rs / 16 * dt); M.x += Math.sign(d2) * sp; g.px = M.x; M.face = d2 > 0 ? 1 : -1; M.walkPh += 0.6 * dt; g.run = true; if (frame % 6 === 0) parts.push({ k: 'dust', x: M.x - M.face * rs, y: M.y, vx: -M.face, vy: -Math.random(), life: 0.5 }); }
        else M.face = dir;
        break;
      }
      case 'hold': { // ce l'ha in bocca: trotterella un po', poi decide come giocare
        if (B.held !== 'nimblu') { g.sub = 'chase'; g.t = 0; break; }
        if (g.t < 50 && !g.walkTo) g.walkTo = clamp(M.x + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 90), lo, hi);
        if (g.walkTo != null && g.t < 50) {
          var dw = g.walkTo - M.x;
          if (Math.abs(dw) > 3) { M.x += Math.sign(dw) * Math.min(Math.abs(dw), 1.8 * dt); M.face = dw > 0 ? 1 : -1; M.walkPh += 0.35 * dt; g.run = true; }
          break;
        }
        if (g.t < 70) break;
        g.walkTo = null;
        if (g.plays > g.max) { g.sub = 'rest'; g.t = 0; break; }
        var k = Math.random();
        g.sub = k < 0.38 ? 'toss' : k < 0.62 ? 'bat' : k < 0.88 ? 'throw' : 'rest'; g.t = 0; g.n = 1 + (Math.random() * 3 | 0);
        break;
      }
      case 'toss': // in piedi: la lancia in aria e la riprende con le zampine
        g.stand = true;
        if (B.held === 'nimblu') {
          g.inHands = g.t > 10;
          if (g.t > 26) { B.held = null; B.on = null; B.vy = -(7 + Math.random() * 3.5); B.vx = M.face * (Math.random() * 1.2 - 0.3); g.sub = 'tosswait'; g.t = 0; g.inHands = false; }
        } else { g.sub = 'chase'; g.t = 0; }
        break;
      case 'tosswait': { // guarda in su e si mette sotto
        g.stand = true;
        if (B.held === 'user') { g.sub = 'watch'; break; }
        if (B.on || g.t > 240) { g.sub = 'chase'; g.t = 0; break; } // è finita sopra qualcosa: va a prenderla
        var hw = handsWorld();
        if (Math.abs(dx) > 3) { M.x = clamp(M.x + Math.sign(dx) * Math.min(Math.abs(dx), 1.6 * dt), lo, hi); }
        if (B.vy > 0 && Math.hypot(hw[0] - B.x, hw[1] - B.y) < B.r + rs * 0.9) {
          B.held = 'nimblu'; g.inHands = true; g.n--;
          if (g.n > 0) { g.sub = 'toss'; g.t = 14; } else { g.sub = 'hold'; g.t = 60; g.inHands = false; g.plays++; if (Math.random() < 0.4) chat2(pick(['Presa! 🎾', 'Che bravo che sono!', 'Hop!'])); }
        } else if (B.vy > 0 && B.y > hw[1] + rs * 0.8) { g.sub = 'chase'; g.t = 0; if (Math.random() < 0.6) chat2(pick(['Ops! 😅', 'Scivolosa!', 'Mancata!'])); }
        break;
      }
      case 'bat': // la posa davanti e le dà una zampata, poi la rincorre
        if (g.t < 2 && B.held === 'nimblu') { B.held = null; B.x = M.x + M.face * rs * 1.7; B.y = M.y - B.r; B.on = 'floor' === M.att.k ? 'floor' : M.att.el; B.vx = 0; B.vy = 0; }
        if (g.t > 30 && !g.batted) { g.batted = true; B.on = null; B.vx = M.face * (5 + Math.random() * 4); B.vy = -2 - Math.random() * 3; }
        if (g.t > 44) { g.batted = false; g.sub = 'chase'; g.t = 0; g.plays++; }
        break;
      case 'throw': { // si gira verso di te e te la lancia
        g.stand = true;
        if (B.held !== 'nimblu') { g.sub = 'wait'; g.t = 0; break; }
        g.inHands = g.t > 8;
        var tgt = mouseFresh() ? mousePage() : [scrollX + W * 0.5, scrollY + H * 0.35];
        M.face = tgt[0] >= M.x ? 1 : -1;
        if (g.t > 30) {
          var T = 34;
          B.held = null; B.on = null; g.inHands = false;
          B.vx = clamp((tgt[0] - B.x) / T, -18, 18); B.vy = clamp((tgt[1] - B.y) / T - 0.25 * T, -22, 2);
          g.sub = 'wait'; g.t = 0;
          say(pick(['Tieni! 🎾 Lanciamela!', 'A te! 🎾', 'Prendi! Ora tocca a te!']));
        }
        break;
      }
      case 'wait': // aspetta che tu la rilanci, scodinzolando; se non lo fai va a prenderla
        M.face = dir;
        if (B.held === 'user') { g.sub = 'watch'; break; }
        if (g.t > 380 || (B.on && g.t > 120 && Math.random() < 0.004 * dt)) { g.sub = 'chase'; g.t = 0; if (Math.random() < 0.5) chat2(pick(['Va bene, la prendo io!', 'Non la lanci? Allora vado!'])); }
        break;
      case 'rest': // si accoccola con la pallina, poi la lascia lì
        if (B.held !== 'nimblu') { g.sub = 'chase'; g.t = 0; break; }
        if (g.t > 260) endBall(pick(['Bella partita! 🎾', 'Che bel gioco! Lanciamela ancora quando vuoi.', 'Ufff, stanco ma felice 🎾']));
        break;
      default: endBall();
    }
  }
  function placeBallGrab() {
    if (!B || !ballVisible()) { if (ballGrab.style.display !== 'none') ballGrab.style.display = 'none'; return; }
    var s = Math.max(30, B.r * 2 + 18);
    ballGrab.style.display = 'block';
    ballGrab.style.left = (B.x - scrollX - s / 2) + 'px'; ballGrab.style.top = (B.y - scrollY - s / 2) + 'px';
    ballGrab.style.width = s + 'px'; ballGrab.style.height = s + 'px';
  }

  // ---------- rissa con l'omino ----------
  // Su richiesta (menu 🥊, chat "rissa" o "chiama l'omino", popup dell'estensione) entra l'omino del jetpack e attacca
  // Nimblu: pugni, calci, pistola, granate, razzi e lanciafiamme. Nimblu schiva saltando e contrattacca con morso,
  // colpo di coda, balzo, bolle, spruzzo d'acqua e, quando la carica ⚡ è piena, il raggio laser. Vince chi svuota la
  // barra dell'altro. Si combatte su tutta la pagina: si salta sopra gli elementi, se ne cade (o se si rompono sotto i
  // piedi) e la pagina scorre dietro all'omino. La pistola non rompe niente; il lanciafiamme annerisce gli elementi e,
  // insistendo, li brucia; granate, razzi e il laser li fanno saltare in pezzi. Alla fine si rimette tutto com'era
  // (elementi, testo, scroll). Nelle aree di lavoro (wp-admin, editor, mentre scrivi) la pagina non si rompe.
  // Comanda tu l'omino (bottone 🎮 o ← →): mouse per mirare, clic per usare l'arma, tasto destro calcio, 1-5 armi.
  // Coordinate della pagina (come Nimblu); barre della vita e mirino sono disegnati sullo schermo.
  var F = null, fKeys = {}, SK = R / 16;
  var FOE_IN = ['Eccoti, lucertola blu! 😈', 'Questa pagina è mia!', 'Ti cercavo, mangialettere!', 'Pronto a prenderle?'];
  var NIM_IN = ['Ehi! E tu chi sei?!', 'Vuoi la guerra? Blub!', 'Giù le mani dalla mia pagina!', 'Ah sì? Fatti sotto! 😤'];
  var FOE_TAUNT = ['Tutto qui?', 'Ah ah ah!', 'Troppo lento!', 'Sei solo una salamandra!'];
  var FOE_HURT = ['Ahi!', 'Ouch!', 'Ehi!', 'Uff!'];
  var NIM_HURT = ['Ahia!', 'Blub!', 'Ouch!', 'Ehi!'];
  var F_WEAP = [{ id: 'fists', ic: '👊', n: 'Pugni' }, { id: 'gun', ic: '🔫', n: 'Pistola' }, { id: 'flame', ic: '🔥', n: 'Lanciafiamme' }, { id: 'gren', ic: '💣', n: 'Granate' }, { id: 'rocket', ic: '🚀', n: 'Razzi' }];
  var F_KEYS = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'J', ArrowDown: 'D', ' ': 'J', a: 'L', A: 'L', d: 'R', D: 'R', w: 'J', W: 'J', s: 'D', S: 'D',
    z: 'P', Z: 'P', f: 'P', F: 'P', x: 'K', X: 'K', q: 'Q', Q: 'Q', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5' };
  var FIGHT_Q = /omino|stick ?man|rissa|duello|rivincita|combattiamo|combatti\b|botte\b|picchiatevi|lottate/i;
  // pavimento: il fondo della pagina, o il bordo alto di opts.floorEl (barra della chat dell'app)
  function calcFloor() {
    var b = opts.floorEl && opts.floorEl.isConnected ? opts.floorEl.getBoundingClientRect() : null;
    if (b && b.height && b.top > H * 0.5) return scrollY + b.top - 2;
    return Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0, scrollY + H) - 2;
  }
  function fFloor() { return F && F.fl != null ? F.fl : calcFloor(); }
  function fightOn() { return !!F && F.phase !== 'over'; }
  function fSay(t) { if (F) { F.sSay = t; F.sSayT = 80 + t.length * 3; } }
  function fScore() { try { return JSON.parse(localStorage.getItem('__nimblu_risse') || '{}'); } catch (e) { return {}; } }
  function fWord(x, y, s, who) { F.fx.push({ k: 'word', x: clamp(x, scrollX + 50, scrollX + W - 50), y: y, s: s, who: who, life: 1, rot: (Math.random() - 0.5) * 0.4 }); }
  function fSparks(x, y, n, col) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      F.fx.push({ k: 'spark', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: 0.8, col: col || '#ffb000' });
    }
  }
  function fDust(x, y, n) { for (var i = 0; i < n; i++) F.fx.push({ k: 'dust', x: x, y: y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 1.8, life: 0.7 }); }
  function noseP() {
    return M.drawn && M.drawn.nose && !M.drawn.hang ? toWorld(M.drawn.nose[0], M.drawn.nose[1]) : [M.x + M.face * R * 1.5, M.y - R * 2];
  }
  // area colpibile: Nimblu (piedi in n.x, n.y) e l'omino (piedi in s.x, s.y; sdraiato se è stato atterrato)
  function overN(x, y, pad) {
    var n = F.n, rs = R * scale();
    return Math.abs(x - n.x) < 1.6 * rs + pad && y > n.y - 2.4 * rs - pad && y < n.y + pad;
  }
  function overS(x, y, pad) {
    var s = F.s;
    if (s.gone) return false;
    if (s.down > 0) return Math.abs(x - s.x) < 40 * SK + pad && y > s.y - 16 * SK - pad && y < s.y + pad;
    return Math.abs(x - s.x) < 11 * SK + pad && y > s.y - 72 * SK - pad && y < s.y + pad;
  }
  // appoggi: le cime degli elementi (da sotto si attraversano saltando) e il pavimento
  function fLand(b, py) {
    if (b.drop <= 0) {
      for (var i = 0; i < surfList.length; i++) {
        var sf = surfList[i];
        if (b.x >= sf.l - 4 && b.x <= sf.r + 4 && py <= sf.t + 2 && b.y >= sf.t && sf.t < fFloor() - 4 && !sf.el.closest('[data-sm-dead]')) { b.y = sf.t; b.on = sf.el; return true; }
      }
    }
    if (b.y >= fFloor()) { b.y = fFloor(); b.on = null; return true; }
    return false;
  }
  // a terra: segue l'elemento su cui sta; se si rompe, sparisce o ci esce fuori, cade
  function fSupport(b) {
    if (b.on) {
      var r = rectOf(b.on);
      if (!r || b.x < r.l - 6 || b.x > r.r + 6 || b.drop > 0) { b.on = null; b.air = true; b.vy = Math.max(0, b.vy); return false; }
      b.y = r.t; return true;
    }
    b.y = fFloor(); return true;
  }

  // un elemento poco più in alto (tra minUp e maxUp) su cui saltare
  function nearPlat(b, minUp, maxUp) {
    var c = surfList.filter(function (sf) {
      return sf.t < b.y - minUp && sf.t > b.y - maxUp && sf.r - sf.l > 40 && Math.abs((sf.l + sf.r) / 2 - b.x) < 280 && sf.t > scrollY + 60 && sf.t < scrollY + H && !sf.el.closest('[data-sm-dead]');
    });
    if (!c.length) return null;
    var sf = pick(c);
    return { x: clamp(b.x, sf.l + 20, sf.r - 20), t: sf.t };
  }

  // ---------- la pagina che si rompe (e poi torna come prima) ----------
  var wreck = { debris: [], killed: [], words: [], burnt: [], heat: new WeakMap(), hf: new WeakMap(), ox: null };
  var WPROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textAlign', 'letterSpacing', 'textTransform', 'textDecoration', 'boxShadow', 'objectFit', 'whiteSpace', 'opacity', 'filter', 'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'gap', 'gridTemplateColumns', 'listStyleType', 'fill', 'stroke'];
  function wreckOK() { return !workArea(); }
  var NO_WRECK = 'input,textarea,select,option,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=dialog],[role=alertdialog],dialog,' +
    '[aria-modal=true],form,label,[role=alert],[role=status],[aria-live],iframe,#wpadminbar,[data-mascot],[data-sm],[data-sm-dead]';
  function okEl(el) {
    if (!el || el.nodeType !== 1 || el === root || el === document.body) return false;
    if (el.closest(NO_WRECK) || el.querySelector('input,textarea,select,form,[contenteditable]:not([contenteditable=false])')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }
  function mediaEl(el) { return /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|svg|SVG)$/.test(el.tagName) || /url\(/.test(getComputedStyle(el).backgroundImage); }
  // isola la parola sotto il punto in uno <span> (rimesso a posto alla fine), solo nel testo "sicuro"
  function wordSpan(x, y) {
    if (wreck.words.length >= 80) return null;
    var node, off;
    if (document.caretPositionFromPoint) { var pos = document.caretPositionFromPoint(x, y); if (!pos) return null; node = pos.offsetNode; off = pos.offset; }
    else if (document.caretRangeFromPoint) { var cr = document.caretRangeFromPoint(x, y); if (!cr) return null; node = cr.startContainer; off = cr.startOffset; }
    if (!node || node.nodeType !== 3) return null;
    var p = node.parentElement;
    if (!p || !safeText(p) || p.closest('[data-sm],[data-sm-dead]')) return null;
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
    wreck.words.push(span);
    return span;
  }
  // cosa si rompe in un punto (coordinate della pagina): elemento piccolo o immagine → parola → blocco medio
  function pagePick(px, py) {
    var x = px - scrollX, y = py - scrollY;
    if (x < 0 || y < 0 || x > W || y > H || !wreckOK()) return null;
    // al massimo 4 ricerche per fotogramma: sulle pagine pesanti ogni ricerca costa
    if (wreck.pf !== frame) { wreck.pf = frame; wreck.pn = 0; }
    if (++wreck.pn > 4) return null;
    var list = document.elementsFromPoint(x, y), big = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      while (el.ownerSVGElement) el = el.ownerSVGElement;
      if (!okEl(el)) continue;
      var r = el.getBoundingClientRect(), a = r.width * r.height;
      if (a <= W * H * 0.06 || mediaEl(el)) return el;
      if (!big && a <= W * H * 0.25) big = el;
    }
    return wordSpan(x, y) || big;
  }
  // l'elemento resta al suo posto ma invisibile; al suo posto vola via una copia che cade in fondo alla pagina
  function smash(el, dx, dy, pow, burnt) {
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var w = el.offsetWidth || r.width, h = el.offsetHeight || r.height;
    var c = el.cloneNode(true);
    c.removeAttribute('id');
    for (var i = 0; i < WPROPS.length; i++) { try { c.style[WPROPS[i]] = cs[WPROPS[i]]; } catch (e) {} }
    c.setAttribute('data-sm', '1');
    var st = c.style;
    st.position = 'absolute'; st.left = '0'; st.top = '0'; st.margin = '0';
    st.width = w + 'px'; st.height = h + 'px'; st.boxSizing = 'border-box';
    st.maxWidth = 'none'; st.maxHeight = 'none'; st.minWidth = '0'; st.minHeight = '0';
    st.zIndex = Z - 1; st.pointerEvents = 'none'; st.transformOrigin = '50% 50%';
    st.overflow = 'hidden'; st.transition = 'none'; st.animation = 'none'; st.visibility = 'visible';
    root.appendChild(c);
    wreck.killed.push({ el: el, v: el.style.visibility });
    el.style.visibility = 'hidden';
    el.setAttribute('data-sm-dead', '1');
    var mass = Math.max(1, Math.min(4, Math.sqrt(w * h) / 70));
    var d = { el: c, x: r.left + scrollX, y: r.top + scrollY, w: w, h: h, rot: 0, dying: burnt ? 1 : 0,
      vx: dx * pow * (0.7 + Math.random() * 0.5) / mass, vy: (dy * pow - 4 - Math.random() * 5) / Math.sqrt(mass),
      vr: (dx * (4 + Math.random() * 8) + (Math.random() - 0.5) * 4) / mass };
    if (burnt) { c.style.filter = 'sepia(1) brightness(.35) contrast(1.3)'; for (var k = 0; k < 8; k++) F.fx.push({ k: 'smoke', x: d.x + Math.random() * w, y: d.y + Math.random() * h, vx: (Math.random() - 0.5), vy: -1 - Math.random(), life: 1, r: 8 }); }
    wreck.debris.push(d); placeDebris(d);
    if (wreck.debris.length > 45) wreck.debris.shift().el.remove();
    needRefresh = true;
  }
  function placeDebris(d) { d.el.style.transform = 'translate3d(' + d.x + 'px,' + d.y + 'px,0) rotate(' + d.rot + 'deg)'; }
  function debrisStep(dt) {
    var fl = Math.max(root.scrollHeight, scrollY + H);
    for (var j = wreck.debris.length - 1; j >= 0; j--) {
      var d = wreck.debris[j];
      if (d.dying) {
        d.dying -= 0.02 * dt;
        d.el.style.opacity = Math.max(0, d.dying);
        if (d.dying <= 0) { d.el.remove(); wreck.debris.splice(j, 1); continue; }
      }
      if (d.rest) continue;
      d.vy += 0.7 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      if (d.y + d.h > fl) {
        d.y = fl - d.h; d.vy = d.vy > 2 ? d.vy * -0.3 : 0; d.vx *= Math.pow(0.85, dt); d.vr *= 0.6;
        d.rot += (Math.round(d.rot / 180) * 180 - d.rot) * 0.15;
        if (!d.vy && Math.abs(d.vx) < 0.05) d.rest = true;
      }
      if (d.w < W) {
        if (d.x < scrollX) { d.x = scrollX; d.vx = Math.abs(d.vx) * 0.5; }
        if (d.x + d.w > scrollX + W) { d.x = scrollX + W - d.w; d.vx = -Math.abs(d.vx) * 0.5; }
      }
      placeDebris(d);
    }
  }
  // esplosione (granata, razzo): rompe gli elementi intorno
  function blastPage(x, y, rad, pow) {
    if (!wreckOK()) return;
    var seen = [];
    for (var rr = rad / 3; rr <= rad; rr += rad / 3) {
      for (var an = 0; an < Math.PI * 2; an += Math.PI / 6) {
        var px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr, el = pagePick(px, py);
        if (el && seen.indexOf(el) < 0 && seen.length < 10) {
          seen.push(el);
          var b = el.getBoundingClientRect(), ex = b.left + b.width / 2 + scrollX - x, ey = b.top + b.height / 2 + scrollY - y, m = Math.hypot(ex, ey) || 1;
          smash(el, ex / m, ey / m - 0.3, pow);
        }
      }
    }
    wreck.debris.forEach(function (d) {
      var ex = d.x + d.w / 2 - x, ey = d.y + d.h / 2 - y, m = Math.hypot(ex, ey) || 1;
      if (m < rad * 1.3) { d.rest = false; d.vx += ex / m * pow * 0.8; d.vy += ey / m * pow * 0.8 - 5; d.vr += (Math.random() - 0.5) * 18; }
    });
  }
  // fiamme: annerisce l'elemento; se insisti brucia e si sbriciola
  function heatPage(px, py, dx) {
    var el = pagePick(px, py);
    if (!el || wreck.hf.get(el) === frame) return !!el;
    wreck.hf.set(el, frame);
    if (!wreck.heat.has(el)) wreck.burnt.push({ el: el, f: el.style.filter });
    var h = (wreck.heat.get(el) || 0) + 1.3;
    wreck.heat.set(el, h);
    var k = Math.min(1, h / 45);
    el.style.filter = 'sepia(' + k + ') brightness(' + (1 - k * 0.65) + ') contrast(' + (1 + k * 0.3) + ')';
    if (h > 95) smash(el, dx, -0.4, 4, true);
    return true;
  }
  function restorePage(sparkle) {
    var n = 0;
    wreck.debris.forEach(function (d) { d.el.remove(); });
    wreck.killed.forEach(function (k) {
      k.el.style.visibility = k.v; k.el.removeAttribute('data-sm-dead');
      if (sparkle && n < 24 && k.el.isConnected) {
        var r = k.el.getBoundingClientRect();
        if (r.width && r.bottom > 0 && r.top < H) { n++; parts.push({ k: 'txt', ch: '✦', col: pick(['#9ee7ff', '#ffd166', '#a8bfe5']), x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY, vx: 0, vy: -0.5, life: 1 }); }
      }
    });
    // le parole isolate tornano dentro il testo originale
    wreck.words.forEach(function (w) {
      var p = w.parentNode;
      if (!p) return;
      while (w.firstChild) p.insertBefore(w.firstChild, w);
      p.removeChild(w);
      p.normalize();
    });
    wreck.burnt.forEach(function (b) { b.el.style.filter = b.f; });
    var had = wreck.killed.length + wreck.burnt.length;
    if (wreck.ox != null) root.style.overflowX = wreck.ox;
    wreck = { debris: [], killed: [], words: [], burnt: [], heat: new WeakMap(), hf: new WeakMap(), ox: null };
    needRefresh = true;
    return had;
  }

  // ---------- inizio e fine ----------
  function startFight() {
    if (fightOn()) { say('Sto già combattendo! 🥊'); return false; }
    if (M.mode === 'bye') return false;
    if (M.mode === 'drag') { say('Mettimi giù, prima! 😅'); return false; }
    if (F) finishFight();
    wake(); closeMenu();
    var vert = isVert(), nrm = vert ? norm() : 0;
    if (M.mode === 'cling') { M.cling = null; M.y += R * scale() * 2.3; }
    if (M.toy) giveUpToy();
    if (M.zoom) endZoom(true);
    dropBall();
    wpAbort();
    M.hunt = null; M.pounce = null; M.plan = []; M.eat = null; M.flyTo = null; M.jumpTarget = null; M.dot = null; M.diving = false;
    M.watchLand = false; M.jumpBottom = false; M.follow = 0; M.video = null; M.swing = 0; M.rot = 0; M.vb = 0;
    var nx = clamp(M.x + nrm * R, scrollX + 30, scrollX + W - 30), ny = M.y, side = nx - scrollX < W / 2 ? 1 : -1;
    var on = M.att && M.att.k === 'top' ? M.att.el : null;
    if (wreck.ox == null) { wreck.ox = root.style.overflowX; root.style.overflowX = 'hidden'; } // i pezzi non allargano la pagina
    F = {
      phase: 'enter', t: 0, hpN: 100, hpS: 100, hpNd: 100, hpSd: 100, player: false, pw: 'fists', big: null, shake: 0, winner: null,
      fx: [], proj: [], sSay: '', sSayT: 0, clickCD: 0, camPause: 0, sx0: scrollX, sy0: scrollY, mdown: false, tap: false,
      n: { x: nx, y: ny, vx: nrm * 2, vy: on ? 0 : -3, air: !on, on: on, drop: 0, act: null, actT: 0, cd: 40, hurt: 0, inv: 0, pow: 0, rise: 0,
        walk: false, goal: null, goalT: 0, thrown: 0, dodgeCD: 0, hit: false, beam: null, queued: null },
      s: { x: side > 0 ? scrollX + W + 40 * SK : scrollX - 40 * SK, y: Math.max(scrollY + 40, ny - 200), vx: -side * 5, vy: 0, face: -side,
        ground: false, on: null, drop: 0, walk: 0, jetting: false, fuel: 200, hold: 0, act: 'enter', actT: 0, hit: false, w: 'fists', cd: 0,
        hurt: 0, inv: 0, down: 0, rot: 0, shots: 0, flash: 0, throwT: 0, jumps: 0, jetT: 0, gone: false, side: side, fireCD: 0,
        aim: 1.2, av: [-side, 0], mv: 0, goal: null, goalT: 0, seen: false, apart: 0 }
    };
    M.att = null; M.mode = 'fight';
    fSay(pick(FOE_IN));
    return true;
  }
  // l'omino se ne va (rissa fermata): Nimblu resta dov'è
  function stopFight(msg) {
    if (!F) return false;
    if (F.phase === 'over') { finishFight(); return true; }
    var s = F.s, n = F.n;
    F.phase = 'over'; F.t = 0; F.winner = null; F.proj.length = 0; F.big = null;
    n.act = null; n.beam = null; n.goal = null; n.queued = null; n.cg = null;
    if (n.climb) endClimb(true);
    setPlayer(false);
    if (!s.gone) { s.act = 'leave'; s.actT = 0; s.w = 'fists'; s.down = 0; fSay('Va bene, per oggi basta... 😒'); }
    say(msg || 'Pace! 🕊️');
    return true;
  }
  // fine: Nimblu torna libero, la pagina torna com'era (anche lo scroll)
  function finishFight(msg) {
    var f = F;
    F = null; fKeys = {};
    setPlayer(false, f);
    foeGrab.style.display = 'none'; fightBtn.style.display = 'none';
    if (M.mode === 'fight') { M.mode = 'fall'; M.att = null; M.vx = 0; M.vy = 0.5; M.rot = 0; M.squash = 0.5; M.jumpTarget = null; }
    var fixed = restorePage(true);
    if (f && !opts.app && Math.abs(scrollY - f.sy0) > 4) { try { window.scrollTo({ left: f.sx0, top: f.sy0, behavior: 'smooth' }); } catch (e) { window.scrollTo(f.sx0, f.sy0); } }
    if (msg) say(msg);
    else if (fixed) say(pick(['Rimetto tutto a posto! ✨', 'Ecco, la pagina è come nuova ✨']));
    if (f && f.winner === 'n') later(function () { if (!F) happy(true); }, 900);
  }
  function ko(who) {
    var f = F, s = f.s, n = f.n;
    if (f.phase !== 'fight') return;
    f.phase = 'over'; f.t = 0; f.winner = who === 's' ? 'n' : 's'; f.proj.length = 0;
    f.big = { s: 'K.O.!', t: 0, d: 70 }; f.shake = 14;
    n.beam = null; n.goal = null; n.queued = null;
    setPlayer(false);
    var sc = fScore();
    sc[f.winner] = (sc[f.winner] || 0) + 1;
    try { localStorage.setItem('__nimblu_risse', JSON.stringify(sc)); } catch (e) {}
    if (who === 's') {
      s.act = 'ko'; s.actT = 0; s.vy = -13; s.vx = (s.x < n.x ? -1 : 1) * 7; s.ground = false; s.on = null; s.jetting = false; s.down = 0; s.w = 'fists';
      fSay('Mi vendicherò! 😤'); n.act = null;
    } else {
      if (n.climb) endClimb(true);
      n.cg = null; n.act = 'ko'; n.actT = 0; n.hurt = 0; n.vy = -6; n.air = true; n.on = null; n.vx = (n.x < s.x ? -1 : 1) * 3;
      s.act = 'win'; s.actT = 0; s.w = 'fists';
      say('Ahiaaa... 😵');
    }
  }
  function hitN(dmg, kx, ky, word, cont) {
    var f = F, n = f.n, rs = R * scale();
    if (f.phase !== 'fight' || M.mode !== 'fight' || (n.inv > 0 && !cont)) return false;
    f.hpN = Math.max(0, f.hpN - dmg); f.lastHit = f.t;
    n.pow = Math.min(100, n.pow + dmg * 1.15);
    if (cont) { if (n.hurt <= 0 && frame % 8 === 0) fSparks(n.x, n.y - rs, 2, '#ff9f43'); }
    else {
      n.hurt = 18; n.inv = 14; n.act = null; n.beam = null; n.goal = null; n.cg = null;
      if (n.climb) endClimb(true); // colpito mentre si arrampica: cade
      n.vx = kx; if (ky) { n.vy = ky; n.air = true; n.on = null; }
      M.squash = 0.9; f.shake = Math.max(f.shake, 4 + dmg * 0.5);
      fSparks(n.x, n.y - rs, 8);
      if (word) fWord(n.x, n.y - rs * 2.6, word, 's');
      if (Math.random() < 0.3) say(pick(NIM_HURT));
    }
    if (f.hpN <= 0) ko('n');
    return true;
  }
  function hitS(dmg, kx, ky, word, down, cont) {
    var f = F, s = f.s;
    if (f.phase !== 'fight' || s.gone || s.act === 'enter' || (s.inv > 0 && !cont)) return false;
    f.hpS = Math.max(0, f.hpS - dmg); f.lastHit = f.t;
    f.n.pow = Math.min(100, f.n.pow + dmg * 0.55);
    if (cont) { if (frame % 8 === 0) fSparks(s.x, s.y - 40 * SK, 2, '#9ee7ff'); }
    else {
      s.hurt = 16; s.inv = 8; s.act = null; s.goal = null; s.jetting = false;
      s.vx = kx; if (ky) { s.vy = ky; s.ground = false; s.on = null; }
      if (down) s.down = 50;
      f.shake = Math.max(f.shake, 4 + dmg * 0.5);
      fSparks(s.x, s.y - 40 * SK, 8, '#9ee7ff');
      if (word) fWord(s.x, s.y - 86 * SK, word, 'n');
      if (Math.random() < 0.25) fSay(pick(FOE_HURT));
    }
    if (f.hpS <= 0) ko('s');
    return true;
  }
  function explodeF(x, y, rad, dmg, word) {
    var f = F, n = f.n, rs = R * scale();
    f.fx.push({ k: 'ring', x: x, y: y, r: 10, life: 1 });
    for (var i = 0; i < 22; i++) {
      var a = Math.random() * Math.PI * 2, sp = Math.random() * 5;
      f.fx.push({ k: 'fire', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, r: 5 + Math.random() * 7 });
    }
    for (var j = 0; j < 8; j++) f.fx.push({ k: 'smoke', x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 1.5, vy: -Math.random() * 1.5, life: 1, r: 9 });
    fWord(x, y - 34, word, 's');
    f.shake = Math.max(f.shake, 12);
    blastPage(x, y, rad * 1.4, 14);
    var cx = n.x, cy = n.y - rs, dd = Math.hypot(cx - x, cy - y);
    if (dd < rad + rs) hitN(dmg * (1 - 0.6 * dd / (rad + rs)), (cx >= x ? 1 : -1) * 6.5, -7, null);
  }

  // ---------- Nimblu ----------
  function nimDo(a) {
    var n = F.n;
    n.act = a; n.actT = 0; n.hit = false; n.beam = null; n.goal = null; n.beamA = null;
    if (a === 'laser') { n.pow = 0; say(pick(['Raggio laser! ⚡', 'Carica... ⚡', 'Adesso vedi! ✨'])); }
    else if (a === 'water' && Math.random() < 0.35) say(pick(['Spruzzo! 💦', 'Una bella doccia!']));
    else if (a === 'tail' && Math.random() < 0.25) say('Coda-frusta! 🌀');
  }
  function nimJump(vx) { var n = F.n; if (n.air) return; n.vy = -10; n.vx = vx || 0; n.air = true; n.on = null; n.dodgeCD = 30; M.squash = 0.6; }
  // salto verso un punto più in alto (sopra un elemento)
  function nimLeap(tx, ty) {
    var n = F.n, up = Math.max(0, n.y - ty) + 45, vy0 = -Math.min(18.5, Math.sqrt(2 * G * up));
    var peak = vy0 * vy0 / (2 * G), T = -vy0 / G + Math.sqrt(2 * Math.max(5, peak - (n.y - ty)) / G);
    n.vx = clamp((tx - n.x) / T, -9, 9); n.vy = vy0; n.air = true; n.on = null; M.squash = 0.6; M.face = n.vx >= 0 ? 1 : -1;
  }
  // Arrampicata: se l'omino è troppo in alto per un salto, Nimblu sale lungo il lato di un elemento che arriva fin
  // quaggiù (poi ci sale sopra) oppure lungo il bordo dello schermo (poi salta verso l'omino). Fuori vista sale più svelto.
  function climbSpot() {
    var n = F.n, s = F.s, best = null, bs = 1e9, els = document.querySelectorAll(SEL);
    for (var i = 0; i < els.length && i < 700; i++) {
      var el = els[i];
      if (el.ownerSVGElement || el.closest('[data-mascot],[data-sm],[data-sm-dead],#wpadminbar')) continue;
      var b = el.getBoundingClientRect();
      if (b.width < 40 || b.height < 24) continue;
      var t = b.top + scrollY, bt = b.bottom + scrollY, l = b.left + scrollX, rr = b.right + scrollX;
      if (t > n.y - 60 || bt < n.y - 170 || t < s.y - 40) continue; // più in alto di lui, lato raggiungibile, non sopra l'omino
      var side = Math.abs(l - n.x) < Math.abs(rr - n.x) ? -1 : 1, ex = side < 0 ? l : rr;
      if (ex < scrollX + 14 || ex > scrollX + W - 14) { side = -side; ex = side < 0 ? l : rr; if (ex < scrollX + 14 || ex > scrollX + W - 14) continue; }
      var sc = (t - s.y) + Math.abs(ex - n.x) * 0.4;
      if (sc < bs) { bs = sc; best = { el: el, side: side, t: 400 }; }
    }
    best = best || { wall: true, side: s.x - scrollX < W / 2 ? -1 : 1, t: 600 };
    best.y0 = n.y;
    return best;
  }
  function startClimb(c, y) {
    var n = F.n;
    n.climb = { el: c.el, side: c.side, wall: !!c.wall }; n.cg = null; n.grab = null;
    n.air = false; n.on = null; n.vx = 0; n.vy = 0; n.goal = null; n.act = null;
    if (y != null) n.y = y;
    M.att = c.wall ? { k: 'wall', side: c.side } : { k: 'eside', el: c.el, side: c.side };
    M.squash = 0.5;
  }
  function endClimb(fall) {
    var n = F.n;
    n.climb = null; n.grab = null; M.att = null;
    if (fall) { n.air = true; n.on = null; n.vy = 0; }
  }
  function nimClimb(dt, dir) {
    var f = F, n = f.n, s = f.s, c = n.climb, rs = R * scale(), r = null, top, nm = c.wall ? -c.side : c.side;
    if (c.wall) { n.x = c.side < 0 ? scrollX : scrollX + W; top = Math.max(s.y - 30, scrollY + 100); }
    else {
      r = rectOf(c.el);
      if (!r || n.y > r.b + 6) { endClimb(true); n.vx = nm * 1.5; return; } // l'elemento si è rotto: cade
      n.x = c.side < 0 ? r.l : r.r; top = r.t;
    }
    var off = n.y > scrollY + H + 30 || n.y < scrollY - 30;
    n.y -= (off ? 13 : 4.2) * dt; M.walkPh += 0.42 * dt;
    M.face = nm > 0 ? -1 : 1;
    if (f.phase === 'fight' && s.y > n.y + 80 && Math.abs(s.x - n.x) < 300) { endClimb(true); n.vx = nm * 2; return; } // l'omino è sceso: si lascia andare
    if (n.y > top) return;
    if (c.wall) { endClimb(false); n.y = Math.max(top, n.y); n.x += nm * R; nimLeap(s.x - dir * rs * 1.5, s.y); n.cd = 10; }
    else { n.y = r.t; n.x = c.side < 0 ? r.l + rs * 0.9 : r.r - rs * 0.9; endClimb(false); n.on = c.el; n.air = false; M.squash = 0.6; M.face = -c.side; n.cd = 8; }
  }
  // va verso il punto da cui arrampicarsi (cammina; se il lato comincia più in alto, salta e ci si aggrappa)
  // può aggrapparsi adesso? (vicino al lato, all'altezza giusta)
  function canGrab(c) {
    var n = F.n, rs = R * scale();
    if (c.wall) return n.x - scrollX < 22 && c.side < 0 || scrollX + W - n.x < 22 && c.side > 0;
    var r = rectOf(c.el), ex = r && (c.side < 0 ? r.l : r.r);
    return !!r && Math.abs(n.x - ex) < rs * 1.3 && n.y <= r.b + 2 && n.y > r.t + 4;
  }
  function nimToClimb(dt) {
    var n = F.n, cg = n.cg, rs = R * scale(), r = cg.wall ? null : rectOf(cg.el);
    cg.t -= dt;
    // scaduto, sparito, o è caduto più giù: si decide di nuovo
    if (cg.t <= 0 || (!cg.wall && !r) || n.y > cg.y0 + 80) { n.cg = null; n.cd = 0; return false; }
    if (canGrab(cg)) { if (!cg.wall) n.x = cg.side < 0 ? r.l : r.r; startClimb(cg, n.y); return true; }
    var ex = cg.wall ? (cg.side < 0 ? scrollX : scrollX + W) : (cg.side < 0 ? r.l : r.r);
    var gx = cg.wall ? ex - cg.side * 20 : ex + cg.side * rs * 0.7, gd = gx - n.x;
    if (Math.abs(gd) > 5) {
      var off = n.y > scrollY + H + 30 || n.y < scrollY - 30, st = Math.sign(gd) * Math.min(Math.abs(gd), (off ? 8 : 3.6) * dt);
      n.x += st; M.face = st > 0 ? 1 : -1; M.walkPh += 0.5 * dt; n.walk = true; return true;
    }
    if (cg.wall || r.b >= n.y - 4) { n.x = ex; startClimb(cg, cg.wall ? n.y : Math.min(n.y, r.b)); return true; }
    // il lato comincia più in alto: salta per aggrapparsi
    n.grab = cg; n.cg = null;
    n.vy = -Math.min(18.5, Math.sqrt(2 * G * (n.y - r.b + 40))); n.vx = -cg.side * 0.6; n.air = true; n.on = null; M.squash = 0.6;
    return true;
  }
  function nimDodge(dir) {
    var f = F, n = f.n, s = f.s, rs = R * scale();
    if (n.air || n.dodgeCD > 0 || n.act === 'laser' || n.act === 'pounce') return false;
    for (var i = 0; i < f.proj.length; i++) {
      var p = f.proj[i], dx = p.x - n.x;
      if (p.from !== 's' || p.seen || Math.abs(p.y - n.y) > 120) continue;
      if ((p.t === 'bullet' || p.t === 'rocket') && p.vx * dx < 0 && Math.abs(dx) < (p.t === 'rocket' ? 170 : 120)) {
        p.seen = true;
        if (Math.random() < (p.t === 'rocket' ? 0.55 : 0.3)) { n.act = null; nimJump(-Math.sign(dx) * 0.5); if (Math.random() < 0.2) say(pick(['Hop!', 'Mancato!'])); return true; }
      } else if (p.t === 'gren' && p.rest && Math.abs(dx) < 95) {
        p.seen = true;
        if (Math.random() < 0.6) { n.act = null; n.goal = clamp(n.x - Math.sign(dx || 1) * 140, scrollX + 24, scrollX + W - 24); n.goalT = 60; return true; }
      }
    }
    if ((s.act === 'punch' || s.act === 'kick' || s.act === 'flame') && !s.seen && s.actT < 6 && Math.abs(s.x - n.x) < 60 * SK + 2 * rs && Math.abs(s.y - n.y) < 50) {
      s.seen = true;
      if (Math.random() < (s.act === 'flame' ? 0.4 : 0.25)) { n.act = null; nimJump(-dir * 2.2); return true; }
    }
    return false;
  }
  function nimStep(dt) {
    var f = F, n = f.n, s = f.s, rs = R * scale(), d = s.x - n.x, dir = d >= 0 ? 1 : -1, ad = Math.abs(d), dy = s.y - n.y;
    if (n.hurt > 0) n.hurt -= dt;
    if (n.inv > 0) n.inv -= dt;
    if (n.cd > 0) n.cd -= dt;
    if (n.dodgeCD > 0) n.dodgeCD -= dt;
    if (n.drop > 0) n.drop -= dt;
    n.walk = false;
    if (n.climb) { nimClimb(dt, dir); return; }
    // salto e caduta
    if (n.air) {
      var py = n.y;
      n.vy = Math.min(16, n.vy + G * dt);
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (n.x < scrollX + 18) { n.x = scrollX + 18; n.vx = Math.abs(n.vx) * 0.4; }
      if (n.x > scrollX + W - 18) { n.x = scrollX + W - 18; n.vx = -Math.abs(n.vx) * 0.4; }
      // lanciato da te addosso all'omino
      if (n.thrown && f.phase === 'fight' && overS(n.x, n.y - rs, rs)) {
        var sp = Math.hypot(n.vx, n.vy);
        if (sp > 5) { hitS(clamp(sp * 1.1, 5, 14), (n.vx >= 0 ? 1 : -1) * 7, -5, 'SBAM!', true); say(pick(['Nimblu-proiettile! 🚀', 'Wheee... SBAM!'])); }
        n.thrown = 0; n.vx *= -0.3; n.vy = Math.min(n.vy, -4);
      }
      // salto per aggrapparsi al lato di un elemento
      var gc = n.grab || n.cg;
      if (gc) {
        if (canGrab(gc)) { if (!gc.wall) { var gr = rectOf(gc.el); n.x = gc.side < 0 ? gr.l : gr.r; } startClimb(gc); return; }
        if (n.grab) { var gr2 = rectOf(n.grab.el); if (!gr2 || n.vy > 0 && n.y > gr2.b + 40) n.grab = null; }
      }
      if (n.act === 'pounce' && !n.hit && n.actT > 16 && overS(n.x + M.face * rs * 0.9, n.y - rs, rs)) {
        n.hit = true; hitS(10, M.face * 7, -6, 'SBAM!', true); n.vx = -M.face * 2.5; n.vy = Math.min(n.vy, -5);
      }
      if (n.vy >= 0 && fLand(n, py)) {
        n.vy = 0; n.air = false; n.thrown = 0; M.squash = 0.7; fDust(n.x, n.y, 6);
        if (n.leapY != null) { n.fails = n.y > n.leapY - 30 ? (n.fails || 0) + 1 : 0; n.leapY = null; }
        if (n.act === 'pounce' || n.act === 'bite') { n.act = null; n.cd = 22 + Math.random() * 20; }
        if (f.phase === 'over' && f.winner === 's') n.act = 'ko';
      }
    } else {
      n.vx *= Math.pow(0.75, dt);
      n.x = clamp(n.x + n.vx * dt, scrollX + 18, scrollX + W - 18);
      fSupport(n);
    }
    n.rise += ((n.act === 'water' ? 0.6 : n.act === 'laser' ? 0.85 : n.act === 'win' ? 1 : 0) - n.rise) * Math.min(1, 0.2 * dt);
    if (n.act === 'ko') { n.actT += dt; return; }
    if (n.act === 'win') { n.actT += dt; M.face = dir; if (!n.air && Math.random() < 0.025 * dt) { n.vy = -6; n.air = true; n.on = null; } return; }
    if (f.phase !== 'fight') { if (!n.act) M.face = dir; return; }
    if (n.hurt > 0) return;
    if (!n.act || n.act === 'bubble' || n.act === 'water') { if (nimDodge(dir)) return; }
    if (n.act) { nimAct(dt, d, dir, ad); return; }
    if (n.cg && !n.air && nimToClimb(dt)) return;
    if (n.goal != null) {
      var gd = n.goal - n.x;
      n.goalT -= dt;
      if (Math.abs(gd) < 4 || n.goalT <= 0 || n.air) n.goal = null;
      else { var st = Math.sign(gd) * Math.min(Math.abs(gd), 2.4 * dt); n.x += st; M.face = st > 0 ? 1 : -1; M.walkPh += 0.4 * dt; n.walk = true; return; }
    }
    if (n.air) return;
    M.face = dir;
    // comandi dalla chat ("laser!", "coda!", "spruzzalo!")
    if (n.queued) { var q = n.queued; n.queued = null; if (q === 'jump') nimJump(0); else if (q === 'go') n.cd = 0; else { nimDo(q); return; } }
    if (n.cd > 0) return;
    var r = Math.random();
    if (n.pow >= 100 && Math.abs(dy) < 160) { nimDo('laser'); return; }
    // l'omino è più in basso: scende (si lascia cadere o esce dal bordo); più in alto: ci salta sopra
    if (dy > 45) {
      if (r < 0.25 && ad < 300) { nimDo(r < 0.12 ? 'bubble' : 'water'); return; }
      if (ad < 70 && n.on) { n.drop = 14; n.air = true; n.on = null; n.vy = 0; n.cd = 10; return; }
      n.goal = s.x; n.goalT = 70; return;
    }
    if (dy < -45) {
      if (r < 0.15 && ad < 300 && dy > -220) { nimDo('bubble'); return; }
      // a portata di salto: salta; troppo in alto (o dopo due salti a vuoto): si arrampica
      if (dy > -250 && ad < 360 && (n.fails || 0) < 2) { nimLeap(s.x - dir * rs * 1.5, s.y); n.leapY = n.y; n.cd = 12; return; }
      n.fails = 0; n.cg = climbSpot(); n.cd = 6; return;
    }
    n.fails = 0;
    // ogni tanto salta su un elemento più in alto (dall'alto si vede meglio)
    if (r > 0.9) { var pf = nearPlat(n, 50, 230); if (pf) { nimLeap(pf.x, pf.t); n.cd = 20; return; } }
    if (ad < rs * 3.4) {
      if (r < 0.4) nimDo('bite');
      else if (r < 0.8) nimDo('tail');
      else { n.vy = -7; n.vx = -dir * 3.4; n.air = true; n.on = null; n.cd = 18; }
    } else if (ad < 220 * SK) {
      if (r < 0.34) nimDo('pounce');
      else if (r < 0.56) { n.goal = s.x - dir * rs * 2.6; n.goalT = 70; }
      else if (r < 0.8) nimDo('water');
      else nimDo('bubble');
    } else {
      if (r < 0.25) nimDo('bubble');
      else if (r < 0.4 && ad < 300) nimDo('water');
      else { n.goal = s.x - dir * rs * 2.6; n.goalT = 110; }
    }
  }
  function nimEnd(cd) { var n = F.n; n.act = null; n.actT = 0; n.beam = null; n.cd = cd + Math.random() * 25; }
  function nimAct(dt, d, dir, ad) {
    var f = F, n = f.n, s = f.s, rs = R * scale(), p0 = n.actT, p, nz;
    n.actT += dt; p = n.actT;
    switch (n.act) {
      case 'bite': // si acquatta, scatta in avanti a bocca aperta
        if (p0 < 8 && p >= 8) { M.face = dir; n.vx = dir * 6.5; n.vy = -3.5; n.air = true; n.on = null; }
        if (!n.hit && p > 9 && p < 24 && overS(n.x + M.face * rs * 1.5, n.y - rs * 1.3, rs * 0.8)) {
          n.hit = true; hitS(8, M.face * 6, -3, pick(['GNAM!', 'CHOMP!']));
        }
        if (p > 40) nimEnd(25);
        break;
      case 'tail': // giravolta: la coda frusta l'omino
        if (!n.hit && p > 10 && p < 24 && ad < rs * 3.3 && s.y - 72 * SK < n.y && s.y > n.y - 3 * rs) {
          n.hit = true; hitS(9, dir * 8, -5, pick(['SWISH!', 'SBAM!']));
        }
        if (p >= 34) nimEnd(28);
        break;
      case 'pounce': // si acquatta muovendo il sedere, poi balza sull'omino
        if (p0 < 16 && p >= 16) {
          M.face = dir;
          var T = 2 * 9 / G;
          n.vx = clamp(d / T, -9, 9); n.vy = -9; n.air = true; n.on = null;
        }
        if (p > 140) nimEnd(10);
        break;
      case 'water': // spruzzo d'acqua dalla bocca: spinge indietro l'omino e gli spegne il lanciafiamme
        if (p >= 12 && p < 64) {
          nz = noseP();
          var tx = s.x, ty = s.y - 40 * SK, ang = Math.atan2(ty - nz[1], (tx - nz[0]));
          if ((tx - nz[0]) * M.face < 0) ang = M.face > 0 ? -0.1 : Math.PI + 0.1;
          for (var i = 0; i < 2; i++) {
            var a = ang + (Math.random() - 0.5) * 0.12, v = 8.5 + Math.random() * 1.5;
            f.fx.push({ k: 'wdrop', x: nz[0], y: nz[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: 0.9, g: 0.12, r: 2.4 + Math.random() * 1.6 });
          }
          if (M.face === dir && ad < 300 && p - 12 > ad / 9 && Math.abs(s.y - n.y) < 6 * rs + 120) {
            if (!n.hit) { n.hit = true; fWord(s.x, s.y - 86 * SK, 'SPLASH!', 'n'); }
            hitS(0.22 * dt, 0, 0, null, false, true);
            s.vx = clamp(s.vx + dir * 0.16 * dt, -3.5, 3.5);
            if (frame % 3 === 0) f.fx.push({ k: 'wdrop', x: s.x - dir * 6, y: s.y - (30 + Math.random() * 30) * SK, vx: -dir * Math.random() * 2, vy: -1.5 - Math.random() * 2, life: 0.7, g: 0.25, r: 2.2 });
            if (s.act === 'flame' || (f.player && s.w === 'flame' && f.mdown)) { s.act = null; s.cd = 40; s.wet = 90; fSay('Psss! Il mio lanciafiamme! 😡'); }
          }
        }
        if (p >= 74) nimEnd(30);
        break;
      case 'bubble': // tre bolle che scoppiano addosso all'omino
        [10, 22, 34].forEach(function (bt) {
          if (p0 < bt && p >= bt) {
            var z = noseP(), ty2 = s.y - 45 * SK, dist = Math.max(40, Math.abs(s.x - z[0]));
            f.proj.push({ t: 'bub', from: 'n', x: z[0] + M.face * 4, y: z[1], vx: M.face * 4.5, vy: clamp((ty2 - z[1]) / (dist / 4.5), -2.5, 2.5), r: (6 + Math.random() * 3) * SK, ph: Math.random() * 6, life: 150 });
          }
        });
        if (p >= 46) nimEnd(28);
        break;
      case 'laser': // carica e spara il raggio: segue piano l'omino e fa saltare gli elementi che attraversa
        nz = noseP();
        if (p < 45) {
          if (frame % 2 === 0) {
            var ca = Math.random() * Math.PI * 2, cd = 26 + Math.random() * 34;
            f.fx.push({ k: 'spark', x: nz[0] + Math.cos(ca) * cd, y: nz[1] + Math.sin(ca) * cd, vx: -Math.cos(ca) * cd / 13, vy: -Math.sin(ca) * cd / 13, life: 0.5, col: Math.random() < 0.5 ? '#9ee7ff' : '#ffffff', nog: true });
          }
          n.beam = { x0: nz[0], y0: nz[1], charge: p / 45 };
          if (p0 < 8 && p >= 8 && !f.player && Math.random() < 0.45 && s.ground && !s.act) foeDo('jet', dir); // l'omino prova a schivarlo col jetpack
        } else if (p < 98) {
          var want = Math.atan2(s.y - 40 * SK - nz[1], Math.abs(s.x - nz[0]) || 1);
          want = clamp(want, -0.7, 0.7);
          n.beamA = n.beamA == null ? want : n.beamA + clamp(want - n.beamA, -0.014 * dt, 0.014 * dt);
          var dx = Math.cos(n.beamA) * M.face, dy = Math.sin(n.beamA), x1, y1, hitting = false;
          var t = (s.x - nz[0]) / dx;
          if (t > 0 && !s.gone && overS(s.x, nz[1] + dy * t, 6)) { x1 = s.x; y1 = nz[1] + dy * t; hitting = true; }
          else { x1 = M.face > 0 ? scrollX + W + 40 : scrollX - 40; y1 = nz[1] + Math.tan(n.beamA) * Math.abs(x1 - nz[0]); }
          n.beam = { x0: nz[0], y0: nz[1], x1: x1, y1: y1, hit: hitting };
          f.shake = Math.max(f.shake, 2);
          // gli elementi lungo il raggio saltano in pezzi
          if (frame % 3 === 0) {
            var len = Math.hypot(x1 - nz[0], y1 - nz[1]), k = 30 + Math.random() * Math.max(1, len - 30);
            var el = pagePick(nz[0] + (x1 - nz[0]) * k / len, nz[1] + (y1 - nz[1]) * k / len);
            if (el) { smash(el, M.face, dy - 0.3, 12); fSparks(nz[0] + (x1 - nz[0]) * k / len, nz[1] + (y1 - nz[1]) * k / len, 5, '#9ee7ff'); }
          }
          if (hitting) {
            if (!n.hit) { n.hit = true; fWord(s.x, s.y - 90 * SK, 'ZAAAP!', 'n'); }
            hitS(0.6 * dt, 0, 0, null, false, true);
            s.vx = clamp(s.vx + M.face * 0.1 * dt, -3, 3);
            if (frame % 2 === 0) f.fx.push({ k: 'spark', x: x1, y: y1, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 3, life: 0.6, col: pick(['#ffd166', '#ffffff', '#9ee7ff']) });
          }
        } else nimEnd(40);
        break;
      default: nimEnd(20);
    }
  }

  // ---------- l'omino ----------
  function foeDo(a, jdir) {
    var s = F.s;
    s.act = a; s.actT = 0; s.hit = false; s.seen = false; s.shots = 0;
    if (!F.player) { if (a === 'gun' || a === 'gren' || a === 'rocket' || a === 'flame') s.w = a; else if (a !== 'jet') s.w = 'fists'; }
    if (a === 'jet') { s.vy = -9.5; s.ground = false; s.on = null; s.jetT = 22; s.jdir = jdir || s.face; s.jy = null; }
    if (a === 'taunt') fSay(pick(FOE_TAUNT));
    else if (!F.player && Math.random() < 0.3) {
      var line = { gun: 'Pew pew!', gren: 'Prendi!', rocket: 'Razzo in arrivo! 🚀', flame: 'Arrosto di salamandra! 🔥' }[a];
      if (line) fSay(line);
    }
  }
  // armi: in mano all'AI mirano a Nimblu, in mano tua al puntatore (s.av è la direzione di mira)
  function shoulder() { var s = F.s; return [s.x, s.y - 46 * SK]; }
  function shootBullet() {
    var s = F.s, sh = shoulder(), ga = Math.atan2(s.av[1], s.av[0]) + (Math.random() - 0.5) * 0.06;
    F.proj.push({ t: 'bullet', from: 's', x: sh[0] + s.av[0] * 30 * SK, y: sh[1] + s.av[1] * 30 * SK, vx: Math.cos(ga) * (F.player ? 16 : 10), vy: Math.sin(ga) * (F.player ? 16 : 10), life: 120 });
    s.flash = 3; s.vx -= s.av[0] * 0.3;
  }
  function throwGren(tx) {
    var s = F.s, sh = shoulder(), x0 = sh[0] + s.face * 10 * SK, y0 = sh[1] - 8 * SK, vx, vy;
    if (tx == null) { vx = s.av[0] * 10 + s.vx * 0.6; vy = s.av[1] * 10 - 3; }
    else {
      vy = -8; var dyg = Math.max(0, F.n.y - 6 - y0), Tg = (-vy + Math.sqrt(vy * vy + 2 * 0.45 * dyg)) / 0.45;
      vx = clamp((tx - x0) / Tg, -9, 9);
    }
    F.proj.push({ t: 'gren', from: 's', x: x0, y: y0, vx: vx, vy: vy, fuse: 75, rot: 0, age: 0 });
    s.throwT = 12;
  }
  function fireRocket() {
    var s = F.s, sh = shoulder();
    F.proj.push({ t: 'rocket', from: 's', x: sh[0] + s.av[0] * 30 * SK, y: sh[1] - 6 * SK + s.av[1] * 30 * SK, ax: s.av[0], ay: s.av[1], sp: 3, life: 140, age: 0 });
    s.vx -= s.av[0] * 2.5;
    if (!s.ground) s.vy -= s.av[1] * 5; // mirando in basso in volo: rocket jump
    for (var j = 0; j < 6; j++) F.fx.push({ k: 'smoke', x: sh[0] - s.av[0] * 18 * SK, y: sh[1] - 6 * SK, vx: -s.av[0] * (1 + Math.random() * 2), vy: (Math.random() - 0.5), life: 0.8, r: 5 });
  }
  function flameTick(dt) {
    var f = F, s = f.s, n = f.n, sh = shoulder(), hx = sh[0] + s.av[0] * 40 * SK, hy = sh[1] + s.av[1] * 40 * SK;
    if (s.wet > 0) { if (frame % 4 === 0) f.fx.push({ k: 'smoke', x: hx, y: hy, vx: s.av[0], vy: -0.6, life: 0.6, r: 4 }); return; } // bagnato: fa solo fumo
    for (var i = 0; i < 3; i++) {
      var fa = Math.atan2(s.av[1], s.av[0]) + (Math.random() - 0.5) * 0.3, fs = 6 + Math.random() * 3;
      f.fx.push({ k: 'flame', x: hx, y: hy, vx: Math.cos(fa) * fs + s.vx * 0.5, vy: Math.sin(fa) * fs, life: 1, n: i, burn: true });
    }
    var vx = n.x - hx, vy = n.y - R * scale() - hy, along = vx * s.av[0] + vy * s.av[1], side = Math.abs(vx * s.av[1] - vy * s.av[0]);
    if (along > -10 && along < 140 * SK && side < 30 + along * 0.25) {
      if (!s.hit) { s.hit = true; fWord(n.x, n.y - R * scale() * 2.6, 'FWOOSH!', 's'); }
      hitN(0.33 * dt, 0, 0, null, true);
    }
  }
  function foeAI() {
    var f = F, s = f.s, n = f.n, rs = R * scale(), d = n.x - s.x, dir = d >= 0 ? 1 : -1, ad = Math.abs(d), dy = n.y - s.y;
    s.mv = 0;
    if (s.act || n.act === 'ko') return;
    s.face = dir;
    if (s.goal != null) {
      var gd = s.goal - s.x;
      s.goalT -= 1;
      if (Math.abs(gd) < 6 || s.goalT <= 0 || !s.ground) s.goal = null;
      else { s.mv = gd > 0 ? 1 : -1; s.face = s.mv; return; }
    }
    if (s.cd > 0 || !s.ground) return;
    var r = Math.random();
    // Nimblu è più in alto: ci arriva col jetpack; più in basso: scende (o gli tira una granata)
    if (dy < -45) { foeDo('jet', dir); s.jy = n.y - 50; s.jx = n.x - dir * 40 * SK; return; }
    if (dy > 45) {
      if (r < 0.3) { foeDo('gren'); return; }
      if (r < 0.45) { foeDo('gun'); return; }
      if (ad < 80 && s.on) { s.drop = 14; s.on = null; s.ground = false; s.cd = 10; return; }
      s.goal = n.x; s.goalT = 90; return;
    }
    if (ad < 46 * SK + 1.6 * rs) {
      if (r < 0.42) foeDo('punch');
      else if (r < 0.74) foeDo('kick');
      else if (r < 0.88) foeDo('jet', -dir);
      else foeDo('taunt');
    } else if (ad < 170 * SK) {
      if (r < 0.28) { s.goal = n.x - dir * (36 * SK + 1.4 * rs); s.goalT = 80; }
      else if (r < 0.46) foeDo('flame');
      else if (r < 0.68) foeDo('gun');
      else if (r < 0.84) foeDo('gren');
      else { var pf = nearPlat(s, 50, 260); foeDo('jet', dir); if (pf) { s.jy = pf.t - 40; s.jx = pf.x; } }
    } else {
      if (r < 0.25) foeDo('gun');
      else if (r < 0.4) foeDo('gren');
      else if (r < 0.5) foeDo('rocket');
      else { s.goal = n.x - dir * 90 * SK; s.goalT = 100; }
    }
  }
  function setWeapon(id) { if (F && F.player) { F.pw = id; F.s.w = id; F.s.fireCD = 0; } }
  function playerPress(k) {
    var s = F.s;
    if (F.phase !== 'fight' || s.act === 'ko' || s.down > 0) return;
    if (/^[1-5]$/.test(k)) { setWeapon(F_WEAP[+k - 1].id); return; }
    if (k === 'Q') { var wi = 0; F_WEAP.forEach(function (w, i) { if (w.id === F.pw) wi = i; }); setWeapon(F_WEAP[(wi + 1) % F_WEAP.length].id); return; }
    if (k === 'J') { if (s.ground || s.jumps < 2) { s.vy = s.ground ? -11 : -10; s.jumps = (s.ground ? 0 : s.jumps) + 1; s.ground = false; s.on = null; s.drop = 0; fDust(s.x, s.y, 5); } return; }
    if (k === 'D') { if (s.ground && s.on) { s.drop = 12; s.on = null; s.ground = false; } return; }
    if (s.act || s.hurt > 0) return;
    if (k === 'K') foeDo('kick');
    else if (k === 'P') F.tap = true;
  }
  // tu comandi: clic (o F/Z) usa l'arma scelta verso il puntatore
  function playerFire(dt) {
    var s = F.s, w = F.pw;
    if (s.act === 'kick' || s.hurt > 0 || s.down > 0) return;
    if (w === 'fists') { if (!s.act) foeDo('punch'); return; }
    if (w === 'flame') { flameTick(dt); return; }
    if (s.fireCD > 0) return;
    if (w === 'gun') { shootBullet(); s.fireCD = 8; }
    else if (w === 'gren') { throwGren(null); s.fireCD = 28; }
    else if (w === 'rocket') { fireRocket(); s.fireCD = 45; }
  }
  function foeEnd(cd) { var s = F.s; s.act = null; s.actT = 0; if (!F.player) { s.w = 'fists'; s.cd = cd + Math.random() * 30; } }
  function foeStep(dt) {
    var f = F, s = f.s, n = f.n, rs = R * scale(), K = SK;
    if (s.gone) return;
    if (s.hurt > 0) s.hurt -= dt;
    if (s.inv > 0) s.inv -= dt;
    if (s.cd > 0) s.cd -= dt;
    if (s.fireCD > 0) s.fireCD -= dt;
    if (s.flash > 0) s.flash -= dt;
    if (s.throwT > 0) s.throwT -= dt;
    if (s.down > 0) s.down -= dt;
    if (s.drop > 0) s.drop -= dt;
    if (s.wet > 0) s.wet -= dt;
    var ctrl = f.player && f.phase === 'fight';
    // mira: verso il puntatore (se comandi tu) o verso Nimblu (se è dietro, dritto davanti a sé)
    var sh = shoulder(), vx, vy;
    if (ctrl && mouse) {
      vx = mouse.cx + scrollX - sh[0]; vy = mouse.cy + scrollY - sh[1];
      if (Math.abs(vx) > 4 && s.act !== 'kick') s.face = vx > 0 ? 1 : -1;
    } else {
      vx = n.x - sh[0]; vy = n.y - rs * 1.1 - sh[1];
      if (vx * s.face <= 0) { vx = s.face; vy = 0.12; }
    }
    var m = Math.hypot(vx, vy) || 1;
    s.av = [vx / m, vy / m]; s.aim = Math.atan2(s.av[0] * s.face, s.av[1]);
    if (s.act === 'enter') { // arriva in volo col jetpack e atterra su quello che trova
      var tx = clamp(n.x + s.side * Math.min(220 * K, W * 0.36), scrollX + 40, scrollX + W - 40), py0 = s.y;
      s.vx = clamp((tx - s.x) * 0.05, -6, 6); s.face = n.x >= s.x ? 1 : -1;
      s.vy = toward(s.vy, clamp((n.y - 150 - s.y) * 0.05, 2.6, 12), 0.4 * dt); s.jetting = true;
      s.x += s.vx * dt; s.y += s.vy * dt;
      jetFlames(s);
      if (s.y > n.y - 150 && fLand(s, py0)) { s.ground = true; s.jetting = false; s.act = null; s.cd = 50; fDust(s.x, s.y, 10); }
      else if (s.y > n.y + 200) { s.act = null; s.jetting = false; } // niente dove atterrare: si lascia cadere
      return;
    }
    if (s.act === 'ko') { // vola via girando
      s.vy += 0.5 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += 0.3 * dt * (s.vx >= 0 ? 1 : -1);
      if (s.y < scrollY - 80 || s.x < scrollX - 80 || s.x > scrollX + W + 80 || s.y > scrollY + H + 80) {
        s.gone = true;
        f.fx.push({ k: 'star', x: clamp(s.x, scrollX + 16, scrollX + W - 16), y: clamp(s.y, scrollY + 16, scrollY + H - 16), life: 1, r: 14 });
      }
      return;
    }
    if (s.act === 'leave') { // se ne va col jetpack
      var away = s.x - scrollX < W / 2 ? -1 : 1;
      s.actT += dt; s.face = away; s.jetting = s.actT > 20;
      if (s.jetting) { s.vy = Math.max(-7, s.vy - 0.7 * dt); s.vx = toward(s.vx, away * 5, 0.25 * dt); jetFlames(s); s.on = null; s.ground = false; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (!s.jetting && s.ground) fSupport(s);
      if (s.y < scrollY - 90 || s.x < scrollX - 90 || s.x > scrollX + W + 90) s.gone = true;
      return;
    }
    s.mv = 0;
    if (s.down <= 0 && s.hurt <= 0 && s.act !== 'win') {
      if (ctrl) { s.mv = (fKeys.R ? 1 : 0) - (fKeys.L ? 1 : 0); if (s.mv && !mouse) s.face = s.mv; s.w = f.pw; }
      else if (f.phase === 'fight') foeAI();
    }
    if (s.act === 'jet') {
      if (s.jx != null) { var jd = s.jx - s.x; s.mv = Math.abs(jd) > 8 ? (jd > 0 ? 1 : -1) : 0; } else s.mv = s.jdir;
    }
    // jetpack: tenendo premuto ↑ in aria (quando comandi tu) o durante il salto 'jet' dell'AI
    s.hold = ctrl && fKeys.J ? s.hold + dt : 0;
    var aiJet = s.act === 'jet' && (s.jy != null ? s.y > s.jy && s.actT < 80 : s.jetT > 0);
    s.jetting = !s.ground && ((ctrl && s.hold > 10 && s.fuel > 0) || aiJet);
    if (s.jetT > 0) s.jetT -= dt;
    if (s.jetting) { s.vy = Math.max(-6.5, s.vy - 1.25 * dt); s.fuel -= dt; jetFlames(s); }
    else if (s.ground) s.fuel = Math.min(200, s.fuel + 1.5 * dt);
    var acc = s.ground ? 1.1 : 0.6, max = ctrl ? 5 : s.act === 'jet' ? 4.5 : 3;
    if (s.mv) { s.vx = clamp(s.vx + s.mv * acc * dt, -max, max); if (s.ground) s.walk += Math.abs(s.vx) * 0.09 * dt; }
    else s.vx *= Math.pow(s.ground ? 0.72 : 0.96, dt);
    if (s.ground) {
      s.x += s.vx * dt;
      if (!fSupport(s)) s.ground = false; // l'elemento si è rotto o ne è uscito: cade
    }
    if (!s.ground) {
      var py = s.y;
      s.vy = Math.min(16, s.vy + 0.62 * dt);
      s.x += s.vx * dt; s.y += s.vy * dt;
      var topLim = scrollY + (f.hy || 12) + 60 + 72 * K; // l'AI non vola sopra le barre della vita
      if (s.y < topLim && !ctrl) { s.y = topLim; s.vy = Math.max(0, s.vy); }
      if (s.vy >= 0 && fLand(s, py)) {
        if (s.vy > 6) fDust(s.x, s.y, 8);
        s.vy = 0; s.ground = true; s.jumps = 0;
        if (s.act === 'jet' && s.actT > 10) foeEnd(25);
      }
    }
    if (s.x < scrollX + 14 * K) { s.x = scrollX + 14 * K; s.vx = 0; }
    if (s.x > scrollX + W - 14 * K) { s.x = scrollX + W - 14 * K; s.vx = 0; }
    if (ctrl) { if (f.tap || f.mdown || fKeys.P) playerFire(dt); f.tap = false; }
    if (s.act && s.act !== 'win') foeAct(dt);
    else if (s.act === 'win') { s.actT += dt; if (s.ground && Math.random() < 0.03 * dt) { s.vy = -6; s.ground = false; s.on = null; } if (s.actT > 20 && s.actT < 22) fSay('Ah ah! Troppo facile! 😎'); }
    // separati da troppo tempo (uno in alto, l'altro in basso): l'omino va da Nimblu
    s.apart = Math.abs(n.y - s.y) > 45 ? s.apart + dt : 0;
  }
  function jetFlames(s) {
    for (var j = 0; j < 2; j++)
      F.fx.push({ k: 'fire', x: s.x - s.face * 8 * SK + (Math.random() - 0.5) * 4, y: s.y - 26 * SK, vx: (Math.random() - 0.5) * 1.2, vy: 3 + Math.random() * 3, life: 0.7, r: (3 + Math.random() * 3) * SK });
  }
  function foeAct(dt) {
    var f = F, s = f.s, n = f.n, K = SK, p0 = s.actT, p, sh = shoulder();
    s.actT += dt; p = s.actT;
    switch (s.act) {
      case 'punch':
        if (!s.hit && p >= 5 && p <= 11) {
          var px = sh[0] + s.av[0] * 32 * K, py = sh[1] + s.av[1] * 32 * K;
          if (overN(px, py, 6)) { s.hit = true; hitN(10, s.face * 5, -3, pick(['POW!', 'BAM!'])); }
        }
        if (p >= 18) foeEnd(25);
        break;
      case 'kick':
        if (!s.hit && p >= 7 && p <= 14 && overN(s.x + s.face * 34 * K, s.y - 20 * K, 8)) { s.hit = true; hitN(12, s.face * 7, -5, pick(['BAM!', 'SDENG!'])); }
        if (p >= 22) foeEnd(28);
        break;
      case 'gun': {
        var shots = 3;
        if (p0 < 8 + s.shots * 9 && p >= 8 + s.shots * 9 && s.shots < shots) { s.shots++; shootBullet(); }
        if (p >= 12 + shots * 9) foeEnd(30);
        break;
      }
      case 'gren':
        if (p0 < 14 && p >= 14) throwGren(n.x + (Math.random() - 0.5) * 30);
        if (p >= 30) foeEnd(35);
        break;
      case 'rocket':
        if (p0 < 22 && p >= 22) fireRocket();
        if (p >= 40) foeEnd(40);
        break;
      case 'flame':
        if (p >= 12 && p < 62) flameTick(dt);
        if (p >= 66) foeEnd(40);
        break;
      case 'taunt':
        if (p >= 60) foeEnd(20);
        break;
      case 'jet':
        if (p > 120) foeEnd(20);
        break;
      default: foeEnd(20);
    }
  }

  // ---------- proiettili, effetti, telecamera ----------
  function projStep(dt) {
    var f = F, n = f.n, rs = R * scale(), fl = fFloor();
    for (var i = f.proj.length - 1; i >= 0; i--) {
      var b = f.proj[i], dead = false, k;
      if (b.t === 'bullet') { // la pistola non rompe niente: colpisce solo Nimblu
        for (k = 0; k < 3 && !dead; k++) {
          b.x += b.vx * dt / 3; b.y += b.vy * dt / 3;
          if (M.mode === 'fight' && overN(b.x, b.y, 2)) { hitN(5, (b.vx > 0 ? 1 : -1) * 2.5, 0, Math.random() < 0.3 ? 'BAM!' : null); dead = true; }
          for (var j = 0; j < f.proj.length && !dead; j++) { // un proiettile che incontra una bolla la fa scoppiare
            var o = f.proj[j];
            if (o.t === 'bub' && Math.hypot(o.x - b.x, o.y - b.y) < o.r + 3) { o.pop = true; dead = true; }
          }
        }
        b.life -= dt;
        if (b.life <= 0 || b.x < scrollX - 20 || b.x > scrollX + W + 20 || b.y < scrollY - 20 || b.y > scrollY + H + 20 || b.y > fl + 4) dead = true;
      } else if (b.t === 'rocket') { // esplode su Nimblu, su un elemento o in fondo
        b.sp = Math.min(12, b.sp * Math.pow(1.08, dt)); b.age += dt;
        for (k = 0; k < 3 && !dead; k++) {
          b.x += b.ax * b.sp * dt / 3; b.y += b.ay * b.sp * dt / 3;
          if ((M.mode === 'fight' && overN(b.x, b.y, 4)) || b.y >= fl || (b.age > 10 && pagePick(b.x, b.y))) dead = true;
        }
        f.fx.push({ k: 'smoke', x: b.x - b.ax * 12, y: b.y - b.ay * 12, vx: -b.ax * b.sp * 0.05, vy: (Math.random() - 0.5) * 0.6, life: 0.7, r: 4 });
        b.life -= dt;
        if (b.life <= 0 || b.x < scrollX - 10 || b.x > scrollX + W + 10 || b.y < scrollY - 10 || b.y > scrollY + H + 10) dead = true;
        if (dead) explodeF(b.x, b.y, 62 * SK, 17, 'KABOOM!');
      } else if (b.t === 'gren') { // rimbalza sugli elementi e scoppia
        var py = b.y;
        b.vy += 0.45 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vx * 0.15 * dt;
        if (b.vy > 0) {
          var landed = b.y >= fl - 5;
          if (landed) b.y = fl - 5;
          for (var q = 0; q < surfList.length && !landed; q++) {
            var sf = surfList[q];
            if (b.x >= sf.l && b.x <= sf.r && py <= sf.t - 5 && b.y >= sf.t - 5 && !sf.el.closest('[data-sm-dead]')) { b.y = sf.t - 5; landed = true; }
          }
          if (landed) { b.vy = b.vy > 2 ? -b.vy * 0.4 : 0; b.vx *= 0.7; if (!b.vy) b.rest = true; }
          else b.rest = false;
        }
        if (b.x < scrollX + 5 || b.x > scrollX + W - 5) b.vx = -b.vx * 0.6;
        b.fuse -= dt;
        if (b.fuse <= 0) { dead = true; explodeF(b.x, b.y - 5, 75 * SK, 15, 'BOOOM!'); }
      } else if (b.t === 'bub') {
        b.ph += 0.2 * dt;
        b.x += b.vx * dt; b.y += (b.vy + Math.sin(b.ph) * 0.4) * dt;
        b.life -= dt;
        if (f.phase === 'fight' && overS(b.x, b.y, b.r)) { hitS(3.5, (b.vx > 0 ? 1 : -1) * 3, -1.5, 'BLOP!'); b.pop = true; }
        if (b.life <= 0 || b.x < scrollX - 20 || b.x > scrollX + W + 20) b.pop = true;
        if (b.pop) {
          dead = true;
          for (k = 0; k < 6; k++) { var a = k / 6 * Math.PI * 2; f.fx.push({ k: 'wdrop', x: b.x, y: b.y, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, life: 0.5, g: 0.1, r: 1.6 }); }
        }
      }
      if (dead) f.proj.splice(i, 1);
    }
  }
  function fxStep(dt) {
    var fx = F.fx;
    for (var i = fx.length - 1; i >= 0; i--) {
      var q = fx[i];
      if (q.k === 'fire') { q.vy -= 0.05 * dt; q.life -= 0.035 * dt; q.r += 0.25 * dt; }
      else if (q.k === 'flame') {
        q.vy -= 0.04 * dt; q.vx *= Math.pow(0.97, dt); q.life -= 0.03 * dt; q.n++;
        // le fiamme scaldano quello che toccano (se insisti, brucia)
        if (q.burn && q.n % 3 === 0 && q.life > 0.3 && heatPage(q.x, q.y, Math.sign(q.vx) || 1)) { q.vx *= 0.3; q.vy -= 0.4; }
      }
      else if (q.k === 'smoke') { q.vy -= 0.02 * dt; q.life -= 0.015 * dt; q.r += 0.35 * dt; }
      else if (q.k === 'ring') { q.r += 7 * dt; q.life -= 0.06 * dt; }
      else if (q.k === 'word') q.life -= 0.022 * dt;
      else if (q.k === 'star') q.life -= 0.02 * dt;
      else if (q.k === 'wdrop') { q.vy += q.g * dt; q.life -= 0.03 * dt; }
      else { if (!q.nog) q.vy += 0.3 * dt; q.life -= 0.03 * dt; }
      if (q.vx != null) { q.x += q.vx * dt; q.y += q.vy * dt; }
      if (q.life <= 0) fx.splice(i, 1);
    }
    if (fx.length > 600) fx.splice(0, fx.length - 600);
  }
  // la pagina scorre dietro all'omino (e, se sono vicini, tiene in vista anche Nimblu); se scorri tu, aspetta un po'
  function fightCamera(dt) {
    var f = F, s = f.s, n = f.n;
    if (opts.app || s.gone || s.act === 'ko') return;
    if (f.camPause > 0) { f.camPause -= dt; return; }
    var y = s.y - 40 * SK, top = H * 0.3, bot = H * 0.68;
    if (f.phase === 'enter') { if (M.mode !== 'fight') return; y = n.y - 20; }
    else if (!f.player && M.mode === 'fight' && Math.abs(n.y - s.y) < H * 0.45) { y = (n.y + s.y) / 2 - 30; top = H * 0.4; bot = H * 0.6; }
    var t = scrollY, sy = y - scrollY;
    if (sy > bot) t = y - bot; else if (sy < top) t = y - top;
    t = clamp(t, 0, Math.max(0, root.scrollHeight - H));
    if (Math.abs(t - scrollY) > 1) window.scrollTo({ left: scrollX, top: scrollY + (t - scrollY) * 0.2, behavior: 'instant' });
  }
  function fightWheel() { if (F) F.camPause = 90; }

  function fightTick(dt) {
    var f = F, n = f.n, s = f.s;
    f.t += dt;
    f.fl = calcFloor();
    // le barre della vita stanno sotto l'intestazione dell'app (opts.topEl), altrimenti in cima allo schermo
    f.hy = opts.topEl && opts.topEl.isConnected ? clamp(opts.topEl.getBoundingClientRect().bottom + 6, 12, H * 0.3) : 12;
    if (f.shake > 0) f.shake = Math.max(0, f.shake - dt);
    if (f.sSayT > 0) f.sSayT -= dt;
    if (f.clickCD > 0) f.clickCD -= dt;
    if (f.big) { f.big.t += dt; if (f.big.t > f.big.d) f.big = null; }
    f.hpNd = f.hpNd > f.hpN ? Math.max(f.hpN, f.hpNd - 0.6 * dt) : f.hpN;
    f.hpSd = f.hpSd > f.hpS ? Math.max(f.hpS, f.hpSd - 0.6 * dt) : f.hpS;
    // un altro comando non interrompe la rissa
    if (!/^(fight|drag|bye)$/.test(M.mode)) { M.mode = 'fight'; M.att = null; M.plan = []; M.flyTo = null; M.jumpTarget = null; M.eat = null; M.vb = 0; n.act = n.act === 'ko' ? 'ko' : null; n.air = true; n.on = null; }
    if (M.mode === 'drag') { n.x = M.x; n.y = M.y + R * scale() * 2.9; n.air = true; n.on = null; n.vx = 0; n.vy = 0; n.climb = null; n.cg = null; n.grab = null; if (n.act !== 'ko') n.act = null; n.beam = null; }
    else if (M.mode === 'fight') nimStep(dt);
    foeStep(dt);
    projStep(dt);
    fxStep(dt);
    if (!F) return;
    fightCamera(dt);
    if (f.phase === 'enter') {
      if (f.t > 45 && !f.saidIn) { f.saidIn = true; say(wreckOK() ? pick(NIM_IN) : 'Qui stai lavorando: combattiamo, ma senza rompere niente! 😇'); }
      if (!s.act && !n.air && f.saidIn) { f.phase = 'ready'; f.t = 0; f.big = { s: 'PRONTI…', t: 0, d: 55 }; }
      if (f.t > 400 && s.act === 'enter') { s.act = null; s.jetting = false; } // non trova dove atterrare: cade
    } else if (f.phase === 'ready' && f.t > 55) { f.phase = 'fight'; f.t = 0; f.big = { s: 'VIA! 🥊', t: 0, d: 45 }; }
    else if (f.phase === 'fight' && !f.player && s.apart > 360 && !s.act && s.ground) { s.apart = 0; foeDo('jet', n.x > s.x ? 1 : -1); s.jy = n.y - 50; s.jx = n.x; }
    // sorveglianza: se nessuno colpisce più nessuno per 40 secondi l'omino se ne va; nessuna fase dura per sempre
    if (f.phase === 'fight' && f.t - (f.lastHit || 0) > 2400) { stopFight(); fSay('Mi annoio... me ne vado! 😴'); }
    else if ((f.phase === 'enter' && f.t > 900) || (f.phase === 'over' && f.t > 600)) { finishFight(); return; }
    else if (f.phase === 'over') {
      var sc = fScore(), sub = 'Nimblu ' + (sc.n || 0) + ' · Omino ' + (sc.s || 0);
      if (f.winner === 'n') {
        if (f.t > 35 && n.act !== 'win' && M.mode === 'fight') { n.act = 'win'; n.actT = 0; say(pick(['Vittoria! 🏆 Blub!', 'E non tornare più! 💪', 'La pagina è salva! 💙'])); }
        if (f.t > 70 && !f.big2) { f.big2 = true; f.big = { s: 'NIMBLU VINCE! 🏆', sub: sub, t: 0, d: 120 }; }
        if (f.t > 220) finishFight();
      } else if (f.winner === 's') {
        if (f.t > 70 && !f.big2) { f.big2 = true; f.big = { s: 'VINCE L\'OMINO 😈', sub: sub, t: 0, d: 120 }; }
        if (f.t > 140 && s.act === 'win') { s.act = 'leave'; s.actT = 0; fSay('Alla prossima, lumacone! 👋'); }
        if (f.t > 250) finishFight(pick(['Ahia... la prossima volta vinco io! 😤', 'Uff, mi gira la testa... ma rimetto tutto a posto ✨']));
      } else if (s.gone || f.t > 200) finishFight();
    }
    if (F && M.mode === 'fight') { M.x = n.x; M.y = n.y; }
  }

  // ---------- disegno della rissa ----------
  function fLine(pts, w, col) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }
  function fBox(x, y, w, h, col) {
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
  }
  function fLimb(ax, ay, a1, a2, len, f) {
    var kx = ax + f * Math.sin(a1) * len, ky = ay + Math.cos(a1) * len;
    return [ax, ay, kx, ky, kx + f * Math.sin(a1 + a2) * len, ky + Math.cos(a1 + a2) * len];
  }
  // posa dell'omino: angoli di cosce/stinchi e braccia (0 = giù, π/2 = avanti, π = su)
  function foePose(s) {
    var o = { l1: [0.18, -0.05], l2: [-0.18, 0.02], a1: [0.25, 0.5], a2: [-0.2, 0.4], lean: 0 };
    var sn = Math.sin(s.walk), cs = Math.cos(s.walk), moving = s.ground && Math.abs(s.vx) > 0.5, aa = s.aim, a = s.act, t = s.actT;
    if (moving) {
      o.l1 = [sn * 0.65, -0.15 - 0.55 * Math.max(0, -cs)];
      o.l2 = [-sn * 0.65, -0.15 - 0.55 * Math.max(0, cs)];
      o.a1 = [1.1 - sn * 0.3, 1.8]; o.a2 = [0.8 + sn * 0.3, 1.9]; o.lean = 3;
    } else if (s.ground) { // in guardia, come un pugile
      var b = Math.sin(frame * 0.12) * 0.08;
      o.a1 = [1.05 + b, 1.85]; o.a2 = [0.75 - b, 2.0]; o.l1 = [0.32, -0.12]; o.l2 = [-0.32, -0.06]; o.lean = 1;
    }
    if (!s.ground) {
      o.l1 = s.jetting ? [0.15, -0.3] : [0.7, -1.2];
      o.l2 = s.jetting ? [-0.1, -0.2] : [-0.1, -0.6];
      o.a1 = [2.3, 0.2]; o.a2 = [-2.2, -0.2];
    }
    if (s.w === 'gun' || s.w === 'flame') { o.a1 = [aa, 0]; o.a2 = [1.1, 0.7]; }
    else if (s.w === 'rocket') { o.a1 = [aa - 0.5, -0.4]; o.a2 = [1.3, 0.2]; }
    else if (s.w === 'gren') o.a1 = s.throwT > 0 ? [2.5 - (12 - s.throwT) * 0.12, 0.1] : [0.5, 1.4];
    if (a === 'punch' || a === 'kick') {
      var k = t / (a === 'punch' ? 18 : 22), ext = k < 0.3 ? k / 0.3 : k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      if (a === 'punch') { o.a1 = [0.3 + ext * (aa - 0.3), (1 - ext) * 1.6]; o.a2 = [0.8, 1.9]; if (s.ground) { o.l1 = [0.4, -0.1]; o.l2 = [-0.35, -0.05]; } o.lean = 5 * ext; }
      else { o.l1 = [ext * (Math.PI / 2 + 0.1), -(1 - ext) * 1.5]; o.l2 = [-0.15, 0]; o.a1 = [-0.9, 0.5]; o.a2 = [1.1, 0.8]; o.lean = -4 * ext; }
    } else if (a === 'taunt') { o.a1 = [2.7 + Math.sin(frame * 0.4) * 0.25, -0.4]; o.a2 = [0.4, 1.6]; o.lean = -2; }
    else if (a === 'win') { var up = Math.sin(frame * 0.3) * 0.2; o.a1 = [2.6 + up, 0.1]; o.a2 = [-2.6 - up, -0.1]; }
    else if (a === 'ko') { o.a1 = [2.6, 0.6]; o.a2 = [-2.4, 0.5]; o.l1 = [0.9, -0.4]; o.l2 = [-0.7, -0.3]; }
    if (s.hurt > 0 && a !== 'ko') { o.a1 = [2.2, 0.8]; o.a2 = [-1.8, 0.6]; o.lean = -6; }
    return o;
  }
  function drawFoeWeapon(s, hx, hy, neckX, shY) {
    var w = s.w, f = s.face, elev = Math.atan2(s.av[1], s.av[0] * f);
    if (w === 'fists' || s.act === 'kick') return;
    ctx.save();
    if (w === 'rocket') {
      ctx.translate(neckX, shY - 5); ctx.scale(f, 1); ctx.rotate(elev);
      fBox(-20, -5, 44, 9, '#556b2f'); fBox(-24, -6, 5, 11, '#333');
      if (F.player ? s.fireCD <= 0 : s.actT < 22) { ctx.fillStyle = '#e11d2e'; ctx.beginPath(); ctx.moveTo(24, -5); ctx.lineTo(32, -0.5); ctx.lineTo(24, 4); ctx.fill(); }
    } else if (w === 'gren') {
      if (F.player ? s.fireCD < 12 : s.actT < 14 || s.throwT <= 0) {
        ctx.translate(hx, hy);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3f6212'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#999'; ctx.fillRect(-1.5, -8, 3, 4);
      }
    } else {
      ctx.translate(hx, hy); ctx.scale(f, 1); ctx.rotate(elev);
      if (w === 'gun') {
        fBox(-2, -5, 15, 5, '#222'); fBox(-1, -1, 4, 7, '#222');
        if (s.flash > 0) { ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(17, -2.5, 5, 0, Math.PI * 2); ctx.fill(); }
      } else {
        fBox(-8, -5, 28, 7, '#444'); fBox(18, -6, 5, 9, '#222'); fBox(-6, 2, 4, 6, '#444');
        ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(25, -1.5, 2 + Math.random(), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawFoe() {
    var s = F.s, f = s.face, o = foePose(s);
    if (s.gone) return;
    // ombra sotto i piedi (solo a terra)
    if (s.ground && s.down <= 0) { ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.beginPath(); ctx.ellipse(s.x, s.y - 1, 16 * SK, 3 * SK, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.save();
    ctx.translate(s.x, s.y); ctx.scale(SK, SK);
    if (s.act === 'ko') { ctx.translate(0, -36); ctx.rotate(s.rot); ctx.translate(0, 36); }
    else if (s.down > 0) { var dk = Math.min(1, (50 - s.down) / 6, s.down / 8); ctx.translate(0, -3 * dk); ctx.rotate(-f * Math.PI / 2 * dk); }
    var ink = s.hurt > 0 && Math.floor(frame / 3) % 2 === 0 ? '#e11d2e' : '#111';
    var hipX = 0, hipY = -26;
    var leg1 = fLimb(hipX, hipY, o.l1[0], o.l1[1], 13, f), leg2 = fLimb(hipX, hipY, o.l2[0], o.l2[1], 13, f);
    var dy = s.ground && s.down <= 0 ? -Math.max(leg1[5], leg2[5], leg1[3], leg2[3]) : 0;
    leg1 = leg1.map(function (v, i) { return i % 2 ? v + dy : v; });
    leg2 = leg2.map(function (v, i) { return i % 2 ? v + dy : v; });
    hipY += dy;
    var neckX = hipX + f * o.lean, neckY = hipY - 24, shY = neckY + 4;
    var arm1 = fLimb(neckX, shY, o.a1[0], o.a1[1], 12, f), arm2 = fLimb(neckX, shY, o.a2[0], o.a2[1], 12, f);
    var hx = neckX + f * o.lean * 0.3, hy = neckY - 10;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // jetpack sulla schiena
    var jx = (hipX + neckX) / 2 - f * 9;
    fBox(jx - 4, neckY + 3, 8, 17, '#6b7280'); fBox(jx - 3, neckY + 20, 6, 3, '#222');
    if (s.w === 'flame') fBox(jx - f * 7 - 3, neckY + 5, 6, 14, '#b91c1c');
    var tail = [hx - f * 8, hy - 3, hx - f * 20, hy - 6 + Math.sin(frame * 0.3) * 3, hx - f * 30, hy - 2 + Math.sin(frame * 0.3 + 1) * 4];
    [[7, 'rgba(255,255,255,.9)'], [3.5, ink]].forEach(function (st) {
      fLine(arm2, st[0], st[1]); fLine(leg2, st[0], st[1]);
      fLine([hipX, hipY, neckX, neckY], st[0], st[1]);
      fLine(leg1, st[0], st[1]);
    });
    drawFoeWeapon(s, arm1[4], arm1[5], neckX, shY);
    fLine(arm1, 7, 'rgba(255,255,255,.9)'); fLine(arm1, 3.5, ink);
    if (s.w === 'fists' && s.act !== 'kick') { // pugni chiusi
      [arm1, arm2].forEach(function (ar) { ctx.beginPath(); ctx.arc(ar[4], ar[5], 3.2, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill(); });
    }
    fLine(tail, 6, 'rgba(255,255,255,.9)'); fLine(tail, 3, '#e11d2e');
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    ctx.lineWidth = 3.5; ctx.strokeStyle = ink; ctx.stroke();
    fLine([hx - 9, hy - 4, hx + 9, hy - 4], 3, '#e11d2e');
    var ex = hx + f * 4.2, ey = hy + 1.5;
    if (s.act === 'ko' || s.down > 0) { fLine([ex - 2, ey - 2, ex + 2, ey + 2], 1.6, '#111'); fLine([ex - 2, ey + 2, ex + 2, ey - 2], 1.6, '#111'); }
    else {
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex, ey, 1.8, 0, Math.PI * 2); ctx.fill();
      fLine([hx + f * 1.2, hy - 1.6, hx + f * 6.8, hy - 0.2], 1.6, '#111'); // sopracciglio arrabbiato
      if (s.act === 'taunt' || s.act === 'win') { ctx.beginPath(); ctx.arc(hx + f * 4, hy + 4.2, 2.6, 0.1 * Math.PI, 0.9 * Math.PI); ctx.lineWidth = 1.5; ctx.strokeStyle = '#111'; ctx.stroke(); }
    }
    // carburante del jetpack (quando lo comandi tu)
    if (F.player && s.fuel < 200) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(hx - 15, hy - 22, 30, 5);
      ctx.fillStyle = s.fuel > 50 ? '#22c55e' : '#ef4444'; ctx.fillRect(hx - 14, hy - 21, 28 * Math.max(0, s.fuel) / 200, 3);
    }
    ctx.restore();
  }
  function drawFoeSay() {
    var s = F.s;
    if (F.sSayT <= 0 || !F.sSay || s.gone) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, F.sSayT / 12);
    ctx.font = '600 13px system-ui,-apple-system,sans-serif';
    var w = ctx.measureText(F.sSay).width + 20, bx = clamp(s.x - w / 2, scrollX + 6, scrollX + W - w - 6), by = clamp(s.y - 108 * SK, scrollY + 6, scrollY + H - 40);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, w, 26, 13); else ctx.rect(bx, by, w, 26); ctx.fill(); ctx.stroke();
    var tx = clamp(s.x, bx + 14, bx + w - 14);
    ctx.beginPath(); ctx.moveTo(tx - 6, by + 25); ctx.lineTo(tx, by + 33); ctx.lineTo(tx + 5, by + 25); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx - 6, by + 26); ctx.lineTo(tx, by + 33); ctx.lineTo(tx + 5, by + 26); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(F.sSay, bx + 10, by + 13.5);
    ctx.restore();
  }
  function drawFightBack() {
    var f = F, n = f.n, rs = R * scale();
    if (M.mode === 'fight' && !n.air && !n.climb && n.act !== 'ko') { // ombra di Nimblu (quella normale c'è solo quando è appoggiato)
      ctx.fillStyle = 'rgba(40,60,100,.14)';
      ctx.beginPath(); ctx.ellipse(n.x - M.face * rs * 0.3, n.y - 1, rs * 1.5, rs * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    }
    drawFoe();
    f.proj.forEach(function (b) {
      if (b.t === 'bullet') fLine([b.x, b.y, b.x - b.vx * 0.8, b.y - b.vy * 0.8], 3, '#ffb000');
      else if (b.t === 'rocket') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.ay, b.ax)); ctx.scale(SK, SK);
        fBox(-12, -3, 16, 6, '#556b2f');
        ctx.fillStyle = '#e11d2e'; ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(10, 0); ctx.lineTo(4, 3); ctx.fill();
        ctx.fillStyle = '#ffb000'; ctx.beginPath(); ctx.arc(-15, 0, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (b.t === 'gren') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.scale(SK, SK);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3f6212'; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#999'; ctx.fillRect(-1.5, -9, 3, 4);
        if ((b.fuse | 0) % 10 < 5) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      } else if (b.t === 'bub') {
        var g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 0, b.x, b.y, b.r);
        g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.7, 'rgba(160,215,255,.25)'); g.addColorStop(1, 'rgba(120,190,245,.5)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
        ellipse(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.22, b.r * 0.22, '#fff');
      }
    });
  }
  function fireCol(l) { return l > 0.75 ? '255,243,160' : l > 0.5 ? '255,176,0' : l > 0.3 ? '255,90,0' : '90,90,90'; }
  function drawFightFront() {
    var f = F, n = f.n, rs = R * scale();
    f.fx.forEach(function (q) {
      var a = Math.max(0, q.life);
      if (q.k === 'smoke') ellipse(q.x, q.y, q.r, q.r * 0.9, 'rgba(110,110,120,' + (a * 0.4) + ')');
      else if (q.k === 'fire') ellipse(q.x, q.y, q.r, q.r, 'rgba(' + fireCol(q.life) + ',' + a + ')');
      else if (q.k === 'flame') { var fr = 4 + (1 - q.life) * 14; ellipse(q.x, q.y, fr, fr, 'rgba(' + fireCol(q.life) + ',' + (a * 0.9) + ')'); }
      else if (q.k === 'ring') { ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.lineWidth = 6 * a; ctx.strokeStyle = 'rgba(255,190,0,' + a + ')'; ctx.stroke(); }
      else if (q.k === 'spark') { ctx.globalAlpha = a; fLine([q.x, q.y, q.x - q.vx * 2, q.y - q.vy * 2], 2.5, q.col); ctx.globalAlpha = 1; }
      else if (q.k === 'dust') ellipse(q.x, q.y, 2.5, 2.5, 'rgba(120,140,170,' + (a * 0.6) + ')');
      else if (q.k === 'wdrop') { ctx.globalAlpha = Math.min(1, a * 1.4); ellipse(q.x, q.y, q.r, q.r * 1.1, '#8fc6f2'); ellipse(q.x - q.r * 0.3, q.y - q.r * 0.35, q.r * 0.3, q.r * 0.3, '#fff'); ctx.globalAlpha = 1; }
      else if (q.k === 'star') {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(frame * 0.2); ctx.globalAlpha = a; ctx.fillStyle = '#ffd400';
        var rr = q.r * (1.5 - a * 0.5);
        ctx.beginPath();
        for (var i = 0; i < 10; i++) { var an = i * Math.PI / 5, rad = i % 2 ? rr * 0.4 : rr; ctx.lineTo(Math.cos(an) * rad, Math.sin(an) * rad); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (q.k === 'word') {
        var t = 1 - a, sc = Math.min(1, t * 8) * (q.big ? 1.5 : 1);
        ctx.save(); ctx.translate(q.x, q.y - t * 30); ctx.rotate(q.rot); ctx.scale(sc, sc); ctx.globalAlpha = clamp(a / 0.25, 0, 1);
        ctx.font = '900 24px Impact,"Arial Black",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = q.who === 'n' ? '#1b2a4a' : '#111'; ctx.strokeText(q.s, 0, 0);
        ctx.fillStyle = q.who === 'n' ? '#9ee7ff' : '#ffd400'; ctx.fillText(q.s, 0, 0);
        ctx.restore();
      }
    });
    // colpo di coda: scia della frustata
    if (M.mode === 'fight' && n.act === 'tail' && n.actT > 6 && n.actT < 26) {
      var k = (n.actT - 6) / 20, cx = n.x, cy = n.y - rs * 0.9;
      ctx.save(); ctx.lineCap = 'round';
      [[9, 'rgba(255,255,255,.35)'], [3, 'rgba(158,231,255,.8)']].forEach(function (l) {
        ctx.beginPath(); ctx.ellipse(cx, cy, rs * 2.9, rs * 1.2, 0, Math.PI * (0.2 + k * 1.6), Math.PI * (0.7 + k * 1.6)); ctx.lineWidth = l[0]; ctx.strokeStyle = l[1]; ctx.stroke();
      });
      ctx.restore();
    }
    // raggio laser
    var bm = n.beam;
    if (bm && M.mode === 'fight') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (bm.x1 == null) {
        var g = ctx.createRadialGradient(bm.x0, bm.y0, 0, bm.x0, bm.y0, 6 + 18 * bm.charge);
        g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.4, 'rgba(140,225,255,.7)'); g.addColorStop(1, 'rgba(140,225,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bm.x0, bm.y0, 6 + 18 * bm.charge, 0, Math.PI * 2); ctx.fill();
      } else {
        var fk = 0.85 + Math.random() * 0.15;
        ctx.lineCap = 'round';
        [[26, 'rgba(90,200,255,.22)'], [14, 'rgba(130,225,255,.55)'], [6, 'rgba(225,250,255,.95)'], [2.5, '#ffffff']].forEach(function (l) {
          ctx.beginPath(); ctx.moveTo(bm.x0, bm.y0); ctx.lineTo(bm.x1, bm.y1); ctx.lineWidth = l[0] * fk; ctx.strokeStyle = l[1]; ctx.stroke();
        });
        [[bm.x0, bm.y0, 14], [bm.x1, bm.y1, bm.hit ? 26 : 0]].forEach(function (c) {
          if (!c[2]) return;
          var g2 = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], c[2]);
          g2.addColorStop(0, 'rgba(255,255,255,1)'); g2.addColorStop(0.35, 'rgba(160,230,255,.8)'); g2.addColorStop(1, 'rgba(120,200,255,0)');
          ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(c[0], c[1], c[2] * fk, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.restore();
    }
    // stelline che girano sopra Nimblu stordito
    if (n.act === 'ko' && M.mode === 'fight') {
      for (var j = 0; j < 3; j++) {
        var an2 = frame * 0.08 + j * Math.PI * 2 / 3, px = n.x + Math.cos(an2) * rs * 1.1, py = n.y - rs * 1.9 + Math.sin(an2) * rs * 0.3;
        ctx.save(); ctx.translate(px, py); ctx.rotate(frame * 0.1); ctx.fillStyle = '#ffd400'; ctx.strokeStyle = '#8a6a00'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i2 = 0; i2 < 10; i2++) { var a3 = i2 * Math.PI / 5, r3 = i2 % 2 ? 2.2 : 5.5; ctx.lineTo(Math.cos(a3) * r3, Math.sin(a3) * r3); }
        ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
    drawFoeSay();
  }
  function fRound(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  // barra delle armi (quando comandi tu): cliccabile
  function weaponBar() { var bw = 5 * 34 + 4 * 4, y = (F.hy || 12) + 46; return { x: W / 2 - bw / 2, y: y, w: 34, h: 26, gap: 4 }; }
  function weaponAt(cx, cy) {
    if (!F || !F.player) return -1;
    var b = weaponBar();
    if (cy < b.y || cy > b.y + b.h) return -1;
    var i = Math.floor((cx - b.x) / (b.w + b.gap));
    return i >= 0 && i < 5 && cx - b.x - i * (b.w + b.gap) <= b.w ? i : -1;
  }
  // barre della vita in alto (stile picchiaduro), scritte grandi al centro, mirino
  function drawFightHud() {
    var f = F, bw = Math.min(210, (W - 110) / 2), cx = W / 2, y = f.hy || 12, h = 13;
    ctx.save();
    ctx.globalAlpha = f.phase === 'over' ? Math.max(0, 1 - f.t / 200) : Math.min(1, f.t / 20 + (f.phase === 'enter' ? 0 : 1));
    fRound(cx - bw - 40, y - 6, bw * 2 + 80, 46, 14); ctx.fillStyle = 'rgba(20,26,44,.86)'; ctx.fill();
    [['s', cx - 30 - bw, f.hpS, f.hpSd, '#e11d2e', f.player ? '😈 TU (OMINO)' : '😈 OMINO'], ['n', cx + 30, f.hpN, f.hpNd, '#4f8be0', 'NIMBLU 💧']].forEach(function (b) {
      var x = b[1], left = b[0] === 's';
      fRound(x, y + 14, bw, h, 6); ctx.fillStyle = '#2a3150'; ctx.fill();
      ctx.save(); fRound(x, y + 14, bw, h, 6); ctx.clip();
      var wd = bw * b[3] / 100, wh = bw * b[2] / 100;
      ctx.fillStyle = '#fff'; ctx.fillRect(left ? x + bw - wd : x, y + 14, wd, h); // danno appena preso
      ctx.fillStyle = b[2] < 30 && Math.floor(frame / 8) % 2 ? '#ffb000' : b[4]; ctx.fillRect(left ? x + bw - wh : x, y + 14, wh, h);
      ctx.restore();
      ctx.font = '800 11px system-ui,-apple-system,sans-serif'; ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
      ctx.textAlign = left ? 'left' : 'right'; ctx.fillText(b[5], left ? x : x + bw, y + 9);
      ctx.textAlign = left ? 'right' : 'left'; ctx.fillStyle = '#b8c4e0'; ctx.fillText(Math.ceil(b[2]) + '', left ? x + bw : x, y + 9);
    });
    ctx.font = '900 16px Impact,"Arial Black",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd400'; ctx.textBaseline = 'middle';
    ctx.fillText('VS', cx, y + 20);
    // carica del laser di Nimblu
    var pw = f.n.pow / 100, full = pw >= 1;
    fRound(cx + 30, y + 30, bw * 0.45, 5, 3); ctx.fillStyle = '#2a3150'; ctx.fill();
    fRound(cx + 30, y + 30, Math.max(5, bw * 0.45 * pw), 5, 3); ctx.fillStyle = full && Math.floor(frame / 6) % 2 ? '#ffffff' : '#9ee7ff'; ctx.fill();
    ctx.font = '700 10px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = full ? '#9ee7ff' : '#7f8db0';
    ctx.fillText(full ? '⚡ LASER PRONTO' : '⚡ carica', cx + 36 + bw * 0.45, y + 33);
    var ty = y + 82;
    if (f.player && f.phase === 'fight') {
      var wb = weaponBar();
      F_WEAP.forEach(function (w, i) {
        var x = wb.x + i * (wb.w + wb.gap), sel = w.id === f.pw;
        fRound(x, wb.y, wb.w, wb.h, 8); ctx.fillStyle = sel ? '#e11d2e' : 'rgba(20,26,44,.8)'; ctx.fill();
        ctx.font = '15px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        ctx.fillText(w.ic, x + wb.w / 2, wb.y + wb.h / 2 + 1);
        ctx.font = '700 8px system-ui,sans-serif'; ctx.fillStyle = sel ? '#fff' : '#9aa6c4'; ctx.fillText(i + 1 + '', x + wb.w - 5, wb.y + 6);
      });
      ty = y + 110;
    }
    ctx.restore();
    // suggerimento sotto (sotto il bottone 🎮)
    if (f.phase !== 'over') {
      var tip = f.player ? 'A D / ← → muovi · W / ↑ salta (tieni: jetpack) · S / ↓ scendi · mouse mira · clic usa l\'arma · tasto destro calcio · 1-5 armi · Esc basta'
        : opts.app ? 'Tocca l\'omino per aiutare Nimblu · trascina Nimblu per lanciarlo'
          : 'Clicca l\'omino per aiutare Nimblu · Esc per fermare';
      ctx.font = '600 11px system-ui,-apple-system,sans-serif';
      var tw = Math.min(W - 24, ctx.measureText(tip).width + 20);
      fRound(cx - tw / 2, ty, tw, 20, 10); ctx.fillStyle = 'rgba(20,26,44,.7)'; ctx.fill();
      ctx.fillStyle = '#dfe7f7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tip, cx, ty + 10, W - 36);
    }
    var bg = f.big;
    if (bg) {
      var p = bg.t / bg.d, sc = p < 0.15 ? 0.6 + p / 0.15 * 0.4 + Math.sin(p / 0.15 * Math.PI) * 0.15 : 1, al = p > 0.8 ? (1 - p) / 0.2 : 1;
      var size = Math.min(64, W / (bg.s.length * 0.62));
      ctx.save(); ctx.translate(cx, H * 0.36); ctx.scale(sc, sc); ctx.globalAlpha = Math.max(0, al);
      ctx.font = '900 ' + size + 'px Impact,"Arial Black",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.strokeText(bg.s, 0, 0);
      ctx.fillStyle = '#ffd400'; ctx.fillText(bg.s, 0, 0);
      if (bg.sub) {
        ctx.font = '800 15px system-ui,-apple-system,sans-serif'; ctx.lineWidth = 4; ctx.strokeText(bg.sub, 0, size * 0.75);
        ctx.fillStyle = '#fff'; ctx.fillText(bg.sub, 0, size * 0.75);
      }
      ctx.restore();
    }
    // mirino al posto del cursore
    if (f.player && f.phase === 'fight' && mouse) {
      var mx = mouse.cx, my = mouse.cy;
      ctx.save(); ctx.lineCap = 'round';
      [[5, 'rgba(255,255,255,.9)'], [2, '#e11d2e']].forEach(function (st) {
        ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2); ctx.lineWidth = st[0]; ctx.strokeStyle = st[1]; ctx.stroke();
        fLine([mx - 16, my, mx - 5, my], st[0], st[1]); fLine([mx + 5, my, mx + 16, my], st[0], st[1]);
        fLine([mx, my - 16, mx, my - 5], st[0], st[1]); fLine([mx, my + 5, mx, my + 16], st[0], st[1]);
      });
      ctx.fillStyle = '#e11d2e'; ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      ctx.restore();
    }
  }
  // elementi cliccabili della rissa: l'omino (per colpirlo) e il bottone per comandarlo tu
  function placeFightUI() {
    var s = F && F.s, show = !!F && !s.gone && F.phase === 'fight' && !F.player;
    if (!show) { if (foeGrab.style.display !== 'none') foeGrab.style.display = 'none'; }
    else {
      var down = s.down > 0, w = (down ? 80 : 30) * SK, h = (down ? 22 : 78) * SK;
      foeGrab.style.display = 'block';
      foeGrab.style.left = (s.x - scrollX - w / 2) + 'px'; foeGrab.style.top = (s.y - scrollY - h) + 'px';
      foeGrab.style.width = w + 'px'; foeGrab.style.height = h + 'px';
    }
    var bshow = !!F && !opts.app && (F.phase === 'fight' || F.phase === 'ready');
    if (!bshow) { if (fightBtn.style.display !== 'none') fightBtn.style.display = 'none'; return; }
    var txt = F.player ? '🤖 Lascia fare a lui' : '🎮 Comanda tu l\'omino';
    if (fightBtn.textContent !== txt) fightBtn.textContent = txt;
    fightBtn.style.display = 'block';
    var by = (F.hy || 12) + (F.player ? 78 : 48);
    fightBtn.style.transform = 'translate(' + Math.round(W / 2 - fightBtn.offsetWidth / 2) + 'px,' + by + 'px)';
  }
  function foeClick(e) {
    e.preventDefault(); e.stopPropagation();
    if (!F || F.phase !== 'fight' || F.clickCD > 0) return;
    F.clickCD = 10;
    hitS(3, (F.s.x - scrollX >= e.clientX ? 1 : -1) * 3, -2, pick(['POW!', 'PAF!', 'TOC!']));
    if (!F.helped) { F.helped = true; say(pick(['Grazie dell\'aiuto! 💙', 'Due contro uno! 😄'])); }
  }
  var fCursor = null;
  // tu comandi l'omino: niente cursore (c'è il mirino), i clic sulla pagina non aprono link
  function setPlayer(on, f) {
    f = f || F;
    if (f) { f.player = !!on && f.phase !== 'over'; f.mdown = false; f.tap = false; if (f.player) { f.s.goal = null; f.s.w = f.pw; if (!f.s.act || /^(gun|gren|rocket|flame|taunt|jet)$/.test(f.s.act)) { f.s.act = null; } } }
    var want = !!(f && f.player);
    if (want && !fCursor) { fCursor = mk('style'); fCursor.textContent = '*{cursor:none!important}#__nimblu,#__nimblu *,#__nimblu_chat,#__nimblu_chat *,#__nimblu_ux,#__nimblu_ux *,[data-fbtn]{cursor:auto!important}'; }
    if (!want && fCursor) { fCursor.remove(); fCursor = null; }
  }
  function ourUI(t) { return !!t && t.nodeType === 1 && !!t.closest('#__nimblu,#__nimblu_chat,#__nimblu_ux,[data-fbtn]'); }
  function playing2() { return !!F && F.player && F.phase === 'fight'; }
  function fPointerDown(e) {
    if (!playing2() || ourUI(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.button === 2) { playerPress('K'); return; }
    if (e.button !== 0) return;
    var wi = weaponAt(e.clientX, e.clientY);
    if (wi >= 0) { setWeapon(F_WEAP[wi].id); return; }
    F.mdown = true; F.tap = true; F.s.hit = false;
  }
  function fPointerUp(e) {
    if (!F || !F.player) return;
    if (e.button === 0) F.mdown = false;
    if (!ourUI(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }
  function fBlockClick(e) { if (playing2() && !ourUI(e.target)) { e.preventDefault(); e.stopPropagation(); } }
  function typing(t) { return !!t && t.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || !!t.closest('[data-mascot]')); }
  function fightKeyDown(e) {
    if (!F || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === 'Escape') {
      if (menuOpen || chatOpen || uxPanel.style.display === 'block' || !fightOn()) return;
      e.preventDefault(); e.stopImmediatePropagation(); stopFight(); return;
    }
    var k = F_KEYS[e.key];
    if (!k || (F.phase !== 'fight' && F.phase !== 'ready')) return;
    if (!F.player) {
      if (k !== 'L' && k !== 'R') return;
      setPlayer(true); say('Ah, comandi tu l\'omino? Allora vieni! 😤');
    }
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) playerPress(k);
    fKeys[k] = true;
  }
  function fightKeyUp(e) { var k = F_KEYS[e.key]; if (!k || !F || !F.player) return; fKeys[k] = false; e.preventDefault(); }
  function fightBlur() { fKeys = {}; if (F) F.mdown = false; }
  // in chat durante la rissa: "basta", oppure le mosse ("laser!", "coda!", "spruzzalo!", "forza!")
  function fightChat(q) {
    var t = q.toLowerCase(), n = F.n;
    if (/basta|pace|stop|ferma|smetti|arrend|vattene|mandalo via|fine/.test(t)) { stopFight(' '); return 'Pace! 🕊️'; }
    if (F.phase !== 'fight') return null;
    var cmd = /laser|raggio/.test(t) ? 'laser' : /acqua|spruzz|bagna|doccia/.test(t) ? 'water' : /bolle|bolla/.test(t) ? 'bubble'
      : /coda|frusta|giravolta/.test(t) ? 'tail' : /mord|morso|azzann/.test(t) ? 'bite' : /balz|placca|saltagli/.test(t) ? 'pounce'
        : /salta|schiva/.test(t) ? 'jump' : /forza|dai|vai|colpisc|picchia|attacca|vinci|distruggi/.test(t) ? 'go' : null;
    if (!cmd) return null;
    if (cmd === 'laser' && n.pow < 100) return 'Il laser non è ancora carico! ⚡ ' + Math.round(n.pow) + '%';
    n.queued = cmd; n.cd = 0;
    return { laser: 'Raggio laser! ⚡', water: 'Spruzzo! 💦', bubble: 'Bolle in arrivo! 🫧', tail: 'Coda-frusta! 🌀', bite: 'Gnam! 😬', pounce: 'Balzo! 🐾', jump: 'Hop!', go: pick(['Ci provo! 💪', 'Blub! All\'attacco!', 'Vai così!']) }[cmd];
  }

  function cornerStep() {
    if (prefs.water) {
      // con l'acqua, l'angolo è a galla vicino al bordo destro
      if (!inWater()) { goSwim(); if (M.mode !== 'fall' && M.mode !== 'vwalk') { M.plan = [{ k: 'leap', side: 1, sy: H - 2 }]; runPlan(); } return; }
      var rr = Math.random();
      if (rr < 0.35) sleep(); else if (rr < 0.6) yawn(); else if (rr < 0.75) curious(); else M.mode = 'swim';
      return;
    }
    var a = M.att, cx = scrollX + W - R * 2.4;
    if (!a) return;
    if (a.k === 'wall') { M.plan = [{ k: 'vto', v: H - 2 }, { k: 'walk', x: cx }]; runPlan(); return; }
    if (a.k !== 'floor') { M.plan = [{ k: 'leap', side: 1, sy: H - 2 }]; runPlan(); return; }
    if (Math.abs(M.x - cx) > 6) { M.walkTo = cx; M.mode = 'walk'; return; }
    // nell'angolo: seduto di fronte, si guarda intorno, si alza, ogni tanto dorme
    M.face = -1;
    var r = Math.random();
    if (r < 0.25) sleep();
    else if (r < 0.5) front(0);
    else if (r < 0.6) front(1);
    else if (r < 0.68) yawn();
    else if (r < 0.76) scratch();
    else if (r < 0.82) curious();
    else if (r < 0.88) sniffUp();
    else if (r < 0.92) turn();
    else sit();
  }
  function decide() {
    // finito il video, scende dal bordo basso con un salto verso una parete
    if (M.att && M.att.k === 'vbot' && !playing(M.video)) { M.plan = [{ k: 'leap', side: nearSide(), sy: 80 + Math.random() * (H - 160) }]; runPlan(); return; }
    if (M.video) { if (playing(M.video)) { if (goWatch()) return; } else M.video = null; }
    // in automatico spacca la barra di WordPress appena arriva (una volta per pagina)
    if (prefs.wpAuto && !wp.autoDone && wpBar()) { wp.autoDone = true; if (wpSmash(true)) return; }
    if (M.att && M.att.k === 'cover') { exitCover(); return; }
    if (M.toy && M.hunt && M.att && !isVert()) { M.mode = 'chase'; return; } // riprende a rincorrere la lettera
    if (M.plan.length) { runPlan(); return; }
    if (level === 'angolo') { cornerStep(); return; }
    if (inWater()) { M.mode = 'swim'; return; } // dopo un gesto in acqua riprende a nuotare
    if (prefs.water && Math.random() < 0.18) { goSwim(); return; }
    if (M.follow > 0 && mouse) { followStep(); return; }
    // gioco: ogni tanto (non sempre) caccia il puntatore o una lettera
    var hc = { vivace: 0.22, normale: 0.14, calmo: 0.06 }[level] || 0;
    if (Math.random() < hc && (Math.random() < 0.5 ? tryMouseHunt() || tryLetterHunt() : tryLetterHunt() || tryMouseHunt())) return;
    // nascondino: dietro un elemento, a sbirciare o ad arrampicarsi
    var cc0 = { vivace: 0.12, normale: 0.09, calmo: 0.04 }[level] || 0;
    if (Math.random() < cc0 && goCover(pick(['hide', 'hide', 'top', 'side', 'climb']))) return;
    // la pallina c'è: ci torna a giocare; ogni tanto la corsa pazza
    if (B && !B.held && ballVisible() && Math.random() < 0.35 && startBallChase()) return;
    var zc = { vivace: 0.05, normale: 0.03, calmo: 0.008 }[level] || 0;
    if (Math.random() < zc && !prefs.water && startZoom()) return;
    M.idleCount++;
    var r = Math.random();
    if (M.idleCount > (level === 'vivace' ? 24 : 12) && r < 0.2) { M.idleCount = 0; sleep(); return; }
    if (r < 0.3) gesture();
    else if (r < 0.42) { if (M.att && M.att.k === 'top' && !prefs.noEat && !workArea()) planEat(); else gesture(); }
    else if (r < 0.47) { if (!uxNearby()) { chat2(pick(CHATTER)); idle(); } }
    else if (r < 0.5) comment();
    else patrol();
  }
  function followStep() {
    if (isVert()) { hop(); return; }
    var mx = mouse.cx + scrollX, my = mouse.cy + scrollY, best = null;
    surfList.forEach(function (s) {
      if (mx >= s.l && mx <= s.r && s.t >= my - 40 && s.t > scrollY + 30 && (!best || s.t < best.t)) best = s;
    });
    if (best && best.el !== curEl() && Math.abs(best.t - M.y) > 20) { M.plan = route(best); runPlan(); return; }
    var cur = M.att && M.att.k === 'top' ? rectOf(M.att.el) : null;
    var tx = clamp(mx, cur ? cur.l + R * 0.5 : scrollX + R, cur ? cur.r - R * 0.5 : scrollX + W - R);
    if (Math.abs(tx - M.x) > 10) { M.walkTo = tx; M.mode = 'walk'; }
    else idle(10);
  }
  function setLevel(l, silent) {
    if (!LEVELS[l]) return;
    level = l;
    [].forEach.call(menu.querySelectorAll('.seg button[data-l]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-l') === l ? 'true' : 'false'); });
    if (silent) return;
    if (opts.onLevel) opts.onLevel(l); else { try { localStorage.setItem('__nimblu_level', l); } catch (e) {} }
    M.plan = []; M.follow = 0;
    wake();
    say(LEVEL_SAY[l]);
    if (M.att && !/^(fall|drag)$/.test(M.mode)) idle(l === 'angolo' ? 20 : 60);
  }
  setLevel(level, true);

  // ---------- interazione ----------
  function onMove(e) {
    var vx = mouse ? e.clientX - mouse.cx : 0;
    mouse = { cx: e.clientX, cy: e.clientY, type: e.pointerType || 'mouse', at: performance.now(), vx: vx };
  }
  function gDown(e) {
    e.preventDefault(); e.stopPropagation();
    try { grab.setPointerCapture(e.pointerId); } catch (x) {}
    M.drag = { sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, vx: 0, vy: 0, moved: false, age: 0 };
    grab.style.cursor = 'grabbing';
  }
  function gMove(e) {
    var d = M.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) {
      d.moved = true; M.mode = 'drag'; M.att = null; M.flyTo = null; M.dot = null; M.diving = false; M.plan = []; M.eat = null; M.jumpTarget = null;
      // spostato via: non torna più a questo video; smette di giocare
      if (M.video) { noVideo.add(M.video); M.video = null; }
      wpAbort();
      M.watchLand = false; M.jumpBottom = false; M.pounce = null; M.hunt = null; M.cling = null;
      if (M.toy) giveUpToy();
      if (M.zoom) endZoom(true);
      dropBall();
      M.swing = 0; M.swingV = 0; M.dragVx = 0; M.vb = 0; M.rise = 0;
      closeMenu();
      say(pick(['Mettimi giù! 😱', 'Wheee!', 'Dove andiamo?']));
    }
    if (d.moved) {
      d.vx = e.clientX - d.px; d.vy = e.clientY - d.py; d.px = e.clientX; d.py = e.clientY;
      M.dragVx += d.vx;
      // il puntatore è la mano che lo tiene per la collottola
      M.x = e.clientX + scrollX; M.y = e.clientY + scrollY;
    }
  }
  function gUp() {
    var d = M.drag;
    M.drag = null; grab.style.cursor = 'grab';
    if (!d) return;
    if (!d.moved) { clickMascot(); return; }
    // lasciato andare: i piedi sono sotto il punto dove lo tenevi
    M.y += R * scale() * 2.9; M.swing = 0;
    M.mode = 'fall'; M.vx = clamp(d.vx * 0.8, -18, 18); M.vy = clamp(d.vy * 0.8, -18, 18);
    // durante la rissa torna a combattere: lanciato forte addosso all'omino lo colpisce
    if (F) { var fn = F.n; M.mode = 'fight'; fn.x = M.x; fn.y = M.y; fn.vx = M.vx; fn.vy = M.vy; fn.air = true; fn.on = null; fn.thrown = 1; }
  }
  function clickMascot() {
    if (M.mode === 'sleep') { wake('Eh? Chi mi ha svegliato?'); return; }
    if (M.dot) { M.blush = 90; say(pick(['Bu! Mi hai trovato! 👀', 'Uffa, scoperto!', 'Cucù! 🙈'])); exitCover('pop'); return; }
    M.blush = 90; M.squash = 0.7;
    if (!menuOpen) say(pick(TICKLE));
    if (menuOpen) closeMenu(); else openMenu();
  }
  function openMenu() { menuWp(); menuOpen = true; menu.style.display = 'block'; placeMenu(); }
  // la riga della barra compare solo sulle pagine WordPress con la barra (o dopo averla spaccata)
  function menuWp() {
    var fb = menu.querySelector('[data-a="fight"]');
    if (fb) fb.textContent = fightOn() ? '🏳️ Basta' : '🥊 Omino';
    var bb = menu.querySelector('[data-a="ball"]');
    if (bb) bb.textContent = B ? '🎾 Togli' : '🎾 Pallina';
    var row = menu.querySelector('.wpb');
    if (!row) return;
    row.hidden = !wp.gone && !wpBar();
    row.querySelector('[data-a="wpbar"]').textContent = wp.gone ? '↩️ Rimettila' : '💥 Spaccala';
  }
  function closeMenu() { menuOpen = false; menu.style.display = 'none'; }
  function outside(e) {
    if (M.mode === 'cling' && e.target !== grab) releaseCling('Ok ok, scendo!');
    if (menuOpen && !menu.contains(e.target) && e.target !== grab) closeMenu();
  }
  function setPref(k, v) {
    prefs[k] = v;
    if (k === 'water') {
      water.style.display = v ? 'block' : 'none';
      if (!v) M.diving = false;
      if (!v && M.att && M.att.k === 'water') { M.att = null; M.mode = 'fall'; M.vy = 0; M.vx = 0; }
    }
    if (k === 'noEat' && v) {
      // rimette tutte le lettere e smette di mangiarle (anche di giocarci)
      spit(true);
      if (M.toy) giveUpToy();
      if (M.hunt && M.hunt.kind === 'letter') { M.hunt = null; M.pounce = null; if (M.mode === 'stalk' || M.mode === 'chase') idle(20); }
      if (M.mode === 'eat') { M.eat = null; idle(20); }
    }
    if (k === 'noGlass' && v && M.zoom && M.zoom.sub === 'glass') endZoom(true); // se stava saltando verso lo schermo, smette subito
    var b = menu.querySelector('button[data-p="' + k + '"]');
    if (b) { b.setAttribute('aria-pressed', v ? 'true' : 'false'); b.title = v ? 'Attivo: clicca per spegnere' : 'Spento: clicca per accendere'; }
  }
  function savePrefs() {
    if (opts.onPrefs) opts.onPrefs(prefs); else { try { localStorage.setItem('__nimblu_prefs', JSON.stringify(prefs)); } catch (e) {} }
  }
  setPref('talk', prefs.talk); setPref('tips', prefs.tips); setPref('water', prefs.water); setPref('noEat', prefs.noEat); setPref('wpAuto', prefs.wpAuto); setPref('noGlass', prefs.noGlass);
  function menuClick(e) {
    var pb = e.target.closest('button[data-p]');
    if (pb) {
      e.preventDefault(); e.stopPropagation();
      var k = pb.getAttribute('data-p');
      setPref(k, !prefs[k]); savePrefs();
      if (k === 'water') { if (prefs.water) { say('Evviva, acqua! 🌊'); later(goSwim, 700); } else say('Asciutto di nuovo.'); return; }
      if (k === 'wpAuto') { if (prefs.wpAuto) { say('Da ora la barra di WordPress la spacco sempre io! 💥'); if (wpBar()) later(function () { wpSmash(true); closeMenu(); }, 600); } else say('Ok, la lascio stare.'); menuWp(); return; }
      if (k === 'noEat') { say(prefs.noEat ? 'Promesso: ho rimesso tutte le lettere e non ne mangio più! 🙅' : 'Evviva, si torna a sgranocchiare! 😋'); return; }
      if (k === 'noGlass') { say(prefs.noGlass ? 'Va bene, niente più tuffi contro lo schermo. 🪟' : 'Evviva! Ogni tanto provo a uscire dal vetro 😆'); return; }
      say(k === 'talk' ? (prefs.talk ? 'Ok, torno a chiacchierare!' : 'Va bene, parlo solo se mi chiami.') : (prefs.tips ? 'Ti segnalerò i problemi della pagina.' : 'Niente più consigli, a meno che non premi 🔍.'));
      return;
    }
    var lb = e.target.closest('button[data-l]');
    if (lb) { e.preventDefault(); e.stopPropagation(); setLevel(lb.getAttribute('data-l')); return; }
    var b = e.target.closest('button[data-a]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var a = b.getAttribute('data-a');
    if (a === 'fight') { closeMenu(); if (fightOn()) stopFight(); else startFight(); return; }
    if (fightOn() && /^(eat|happy|spin|shake|dance|sniffUp|front|follow|sleep|hide|peek|climb|wpbar|zoom|ball)$/.test(a)) { say('Dopo! Adesso sto combattendo! 🥊'); return; }
    if (a !== 'follow') M.follow = 0;
    if (a === 'eat') { wake(); M.plan = []; planEat(); }
    else if (a === 'jump') hop();
    else if (a === 'happy') { wake(); say('Ciao ciao! 👋'); happy(true); }
    else if (a === 'spin') { wake(); M.plan = []; if (M.att) { idle(1); turn(null, 3); } say('Wiii!'); }
    else if (a === 'shake') { wake(); M.plan = []; shake(); say('Brrr!'); }
    else if (a === 'dance') { wake(); dance(); say('♪ Blub blub ♪'); }
    else if (a === 'sniffUp') { wake(); M.plan = []; sniffUp(); }
    else if (a === 'ux') { wake(); openUx(); }
    else if (a === 'front') { wake(); M.plan = []; front(0); }
    else if (a === 'follow') { wake(); M.follow = 600; M.plan = []; say('Ti seguo! Muovi il mouse 👀'); idle(5); }
    else if (a === 'sleep') sleep();
    else if (a === 'spit') spit();
    else if (a === 'hist') { closeMenu(); openChat(); }
    else if (a === 'hide' || a === 'peek' || a === 'climb') { closeMenu(); coverCmd(a); }
    else if (a === 'zoom') { closeMenu(); if (M.zoom) { endZoom(); } else if (startZoom()) say(pick(['Si corre! 🏃💨', 'Corsa pazza!'])); }
    else if (a === 'ball') { closeMenu(); if (B) { removeBall(); say('Pallina via. Grazie della partita! 🎾'); } else { spawnBall(); say('Una pallina! 🎾 Prendila e lanciamela!'); } }
    else if (a === 'wpbar') { closeMenu(); if (wp.gone) { wpRestore(); say('Eccola, rimessa a posto!'); } else wpSmash(false); }
    else if (a === 'bye') { closeMenu(); say(opts.persistent ? 'Ciao! Torno alla prossima pagina 👋' : 'Ciao ciao! 👋'); M.mode = 'bye'; M.t = 90; M.plan = []; }
  }
  function chat(e) {
    e.preventDefault(); e.stopPropagation();
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    sendChat(q);
  }
  function sendChat(q, force) {
    q = String(q || '').trim();
    if (!q) return;
    wake();
    logMsg('tu', q);
    // durante la rissa: "basta" o le mosse di Nimblu
    if (F) { var fr = fightChat(q); if (fr) { say(fr); logMsg('nimblu', fr); return; } }
    // comandi che devono funzionare sempre, anche senza AI
    if (opts.ai && !FIGHT_Q.test(q) && !/pallina|\bpalla\b|lanciamela|corri\b|corsa pazza|zoomies|scatenat|zitto|silenzio|basta parlare|non parlare|^parla|chiacchier|ridai|restituisci|sputa|non mangiare|smetti di mangiare|torna a mangiare|puoi mangiare|barra|cronologia|non vedent|ciech|cieco|ipovedent|screen ?reader/i.test(q)) { askAi(q, force); return; }
    say('...');
    M.reply = { q: q, t: 30 };
  }
  // ---------- risposte con l'AI (estensione: modello integrato in Chrome) ----------
  var ACTIONS = {
    balla: function () { dance(); }, salta: hop, saluta: function () { happy(true); }, siediti: function () { front(0); },
    nuota: function () { if (!prefs.water) { setPref('water', true); savePrefs(); } goSwim(); },
    nasconditi: function () { coverCmd('hide'); }, rissa: function () { startFight(); }, corri: function () { startZoom(); },
    pallina: function () { if (!B) spawnBall(); else startBallChase(); }, arrampicati: function () { coverCmd('climb'); }, sbircia: function () { coverCmd('peek'); },
    dormi: sleep, gira: function () { if (M.att) { idle(1); turn(null, 2); } }, annusa: sniffUp, scrollati: shake,
    mangia: function () { M.plan = []; planEat(); }, angolo: function () { setLevel('angolo', true); if (opts.onLevel) opts.onLevel('angolo'); else { try { localStorage.setItem('__nimblu_level', 'angolo'); } catch (e) {} } M.plan = []; idle(10); }, controlla: function () { openUx(); }
  };
  // domande sulla pagina (e quelle che seguono entro 3 minuti): l'AI riceve una scheda completa e risponde con consigli
  var PAGE_Q = /pagina|sito|meta ?description|parole chiave|keyword|indicizz|posizionament|google|h1|h2|\bux\b|conversion|design|landing|cosa ne pensi|miglior|problem|error|bottone|pulsante|testo|titolo|leggi|consigl|\bcta\b|call to action|seo|form\b|modulo|mobile|cellulare|veloc|lent|color|contrast|immagin|foto|clienti|vend|contatt|header|menu|footer|layout|sezion|funnel|prezz|offert|accessibil|non vedent|screen ?reader|\balt\b/i;
  // seguiti di una domanda sulla pagina ("e il secondo?", "come lo faccio?"), ma non le chiacchiere
  var FOLLOW_Q = /\b(come|perch|qual|primo|prima|second|terz|quart|quint|quell|quest|spiega|esempi|altr|ancora|di più|meglio|dove|fallo|scrivi|riscriv|proponi|suggerisci|e se)/i;
  var CHAT_Q = /ti chiami|chi sei|come stai|ciao|grazie|buongiorno|buonasera|ti voglio bene|brav/i;
  function shortTxt(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function pageInfo(q) {
    if (opts.aiPage === false) return null;
    var h1 = document.querySelector('h1'), md = document.querySelector('meta[name="description"]');
    return {
      title: shortTxt(document.title, 150), url: location.hostname + location.pathname,
      h1: h1 ? shortTxt(h1.innerText, 150) : '', description: md ? shortTxt(md.content, 250) : '',
      text: shortTxt(document.body.innerText, 900)
    };
  }
  function pageBrief() {
    if (opts.aiPage === false) return null;
    audit();
    function vis(el) { return !uxOurs(el) && visibleBox(el); }
    function all(sel) { return [].filter.call(document.querySelectorAll(sel), vis); }
    var info = pageInfo(''), h1s = all('h1');
    info.h1 = h1s.length ? shortTxt(h1s[0].innerText, 150) + (h1s.length > 1 ? ' (ci sono ' + h1s.length + ' H1)' : '') : '(nessun H1 visibile)';
    info.outline = all('h2,h3').slice(0, 12).map(function (h) { return (h.tagName === 'H3' ? '- ' : '') + shortTxt(h.innerText, 70); }).filter(function (t) { return t.replace(/^- /, ''); });
    info.ctas = (ux.ctas || []).slice(0, 8).map(function (c) { return '«' + shortTxt(label(c), 40) + '»' + ((ux.ctasFold || []).indexOf(c) >= 0 ? ' (visibile senza scorrere)' : ''); });
    info.forms = all('form').slice(0, 2).map(function (f, i) {
      var fields = [].filter.call(f.querySelectorAll('input,select,textarea'), function (x) { return !/^(hidden|submit|button|reset|image)$/.test(x.type) && visibleBox(x); });
      var names = fields.slice(0, 8).map(function (x) { return shortTxt((x.labels && x.labels[0] && x.labels[0].innerText) || x.getAttribute('aria-label') || x.placeholder || x.name || x.type, 25); });
      var sb = f.querySelector('button[type=submit],input[type=submit],button:not([type])');
      return 'form ' + (i + 1) + ': ' + fields.length + ' campi (' + names.join(', ') + ')' + (sb ? ', bottone «' + shortTxt(label(sb) || sb.value, 30) + '»' : '');
    }).join('; ');
    var body = document.body.innerText || '', imgs = [].filter.call(document.images, function (im) { return !uxOurs(im) && im.getBoundingClientRect().width > 40; });
    info.stats = [
      'circa ' + (body.split(/\s+/).length) + ' parole',
      imgs.length + ' immagini (' + imgs.filter(function (im) { return !im.hasAttribute('alt'); }).length + ' senza alt)',
      'telefono o email cliccabili: ' + (document.querySelector('a[href^="tel:"],a[href^="mailto:"]') ? 'sì' : 'no'),
      'recensioni o garanzie: ' + (TRUST_RE.test(body) ? 'sì' : 'no'),
      'schermo largo ' + W + ' px (' + (W < 700 ? 'telefono' : 'computer') + ')',
      ux.lcp ? 'contenuto principale in ' + (ux.lcp / 1000).toFixed(1) + ' s' : '',
      'stabilità CLS ' + ux.cls.toFixed(2)
    ].filter(Boolean).join(', ');
    var sevName = { error: 'da sistemare', warn: 'da migliorare', tip: 'consiglio' };
    seoAudit();
    info.seo = seoBrief();
    info.stats += ', voti UX ' + uxScore() + '/100 (' + catScores('ux').map(function (c) { return c.name + ' ' + c.sc; }).join(', ') + '), voti SEO ' + seoScore() + '/100 (' + catScores('seo').map(function (c) { return c.name + ' ' + c.sc; }).join(', ') + ')';
    a11yAudit();
    info.stats += ', voto per chi non vede (screen reader) ' + a11yScore() + '/100 (' + catScores('a11y').map(function (c) { return c.name + ' ' + c.sc; }).join(', ') + ')';
    ux.aiRefs = ux.tab === 'a11y'
      ? (a11y.list || []).filter(function (f) { return f.sev !== 'ok'; }).sort(function (a, b) { return a11yGain(b) - a11yGain(a); }).slice(0, 8)
        .map(function (f) { return { sev: f.sev, title: 'Non vedenti: ' + f.title, detail: f.detail + (f.sug && f.sug[0] ? ' Esempio: ' + f.sug[0] : f.code ? ' Da aggiungere: ' + f.code : ''), els: f.els, sug: f.sug }; })
        .concat((ux.list || []).filter(function (f) { return f.sev !== 'ok'; }).slice(0, 4))
      : (ux.list || []).filter(function (f) { return f.sev !== 'ok'; }).slice(0, 7)
        .concat((seo.list || []).filter(function (f) { return f.sev !== 'ok'; }).slice(0, 6).map(function (f) { return { sev: f.sev, title: 'SEO: ' + f.title, detail: f.detail, els: f.els }; }));
    info.problems = ux.aiRefs.map(function (f, i) { return 'P' + (i + 1) + ' [' + sevName[f.sev] + '] ' + f.title + ' — ' + shortTxt(f.detail, 150); });
    var main = document.querySelector('main,article,[role=main]');
    info.text = shortTxt((main && vis(main) ? main : document.body).innerText, 900);
    return info;
  }
  var thinkTimer = null;
  function askAi(q, force) {
    var pagina = !!force || PAGE_Q.test(q) || (Date.now() - (M.pageTalkAt || 0) < 180000 && FOLLOW_Q.test(q) && !CHAT_Q.test(q));
    if (opts.aiPage === false) pagina = false;
    M.thinking = true;
    say('· · ·'); M.sayT = 9999;
    curious();
    renderChatList();
    var done = false;
    function finish(res) {
      if (done) return; done = true;
      M.thinking = false; clearTimeout(thinkTimer);
      if (res && res.reply) {
        var tips = res.tips && res.tips.length ? res.tips : null;
        if (pagina) M.pageTalkAt = Date.now();
        if (tips) { ux.ai = { q: q, tips: tips }; openUx(true); }
        say(res.reply + (tips ? ' Ti ho messo ' + (tips.length === 1 ? 'il consiglio' : 'i ' + tips.length + ' consigli') + ' nel pannello.' : ''));
        logMsg('nimblu', res.reply, tips ? { tips: tips } : null);
        if (res.remembered) parts.push({ k: 'txt', ch: '💭', col: '#4f74b3', x: M.x, y: M.y - 50, vx: 0, vy: -0.4, life: 1 });
        var act = ACTIONS[res.action];
        if (act && !tips) later(act, 900);
      } else {
        var er = (res && res.error) || '', txt;
        if (pagina && PAGE_Q.test(q)) { openUx(true); txt = 'Adesso non riesco a usare l\'AI, ma ecco i miei controlli automatici: clicca una voce e ti porto lì.'; }
        else txt = reply(q);
        say(txt);
        logMsg('nimblu', txt);
        var hint = opts.aiHint ? opts.aiHint(er) : /modello-non-pronto|nosupport/.test(er) ? 'Psst: per rispondermi con la mia testa, attiva l\'AI dal pannellino dell\'estensione.' : '';
        // il limite si segnala sempre; gli altri suggerimenti una volta sola
        if (hint && (/limite/.test(er) || !M.aiHinted)) { M.aiHinted = true; later(function () { say(hint); }, 3500); }
      }
      renderChatList();
    }
    thinkTimer = setTimeout(function () { finish({ error: 'timeout' }); }, 60000);
    try {
      opts.ai({ text: q, mode: pagina ? 'pagina' : 'chat', page: pagina ? pageBrief() : pageInfo(q) }).then(finish, function (err) { finish({ error: String(err) }); });
    } catch (err) { finish({ error: String(err) }); }
  }
  function coverCmd(a) {
    wake();
    var ok = a === 'hide' ? goCover('hide') : a === 'climb' ? goCover('climb') : (Math.random() < 0.5 ? goCover('top') || goCover('side') : goCover('side') || goCover('top'));
    if (!ok) say(a === 'climb' ? 'Non vedo niente su cui arrampicarmi qui.' : 'Qui non trovo un buon nascondiglio... servono immagini o riquadri colorati.');
    return ok;
  }
  function myName() { try { return localStorage.getItem('__nimblu_name') || ''; } catch (e) { return ''; } }
  function later(fn, ms) { setTimeout(function () { if (window.__mascot) fn(); }, ms); }
  function reply(q) {
    var t = q.toLowerCase();
    var rules = [
      [/(rimetti|ripristina|riporta|ridai|rivoglio).*barra|barra.*(rimetti|ripristina|indietro)/, function () { if (wpRestore()) return 'Eccola, rimessa a posto!'; return wpEl() ? 'La barra è già al suo posto.' : 'Qui non c\'è nessuna barra di WordPress.'; }],
      [/mangia.*barra|barra.*mangia/, function () { return wpSmash(false, 'eat') ? 'Gnam, la barra nera!' : M.say; }],
      [/(spara|laser|raggio|fulmina|disintegra|zappa).*barra|barra.*(spara|laser|raggio|disintegra)/, function () { return wpSmash(false, 'laser') ? 'Modalità laser! 😎' : M.say; }],
      [/(spacca|rompi|strappa|distruggi).*barra|barra.*(spacca|rompi|strappa)/, function () { return wpSmash(false, 'rip') ? 'Ci penso io! 💪' : M.say; }],
      [/(togli|leva|elimina|nascondi|via).*barra|barra.*(togli|via)/, function () { return wpSmash(false) ? 'Ci penso io! 💪' : M.say; }],
      [FIGHT_Q, function () { if (/basta|ferma|stop|smetti|pace/.test(t)) return 'Nessuna rissa in corso. 🕊️'; if (fightOn()) return 'Sto già combattendo! 🥊'; later(startFight, 300); return pick(['Chi osa sfidarmi?! 😤', 'Che venga pure! 💪', 'Blub! Pronto alla rissa!']); }],
      [/(togli|leva|basta|via) (la )?pall/, function () { if (!B) return 'Non c\'è nessuna pallina.'; removeBall(); return 'Pallina via. Bella partita! 🎾'; }],
      [/pallina|\bpalla\b|riporta|lanciamela|lancia la|giochiamo a palla/, function () {
        if (!B) { later(spawnBall, 200); return 'Una pallina! 🎾 Prendila e lanciamela!'; }
        later(startBallChase, 300); return B.held === 'nimblu' ? 'Ce l\'ho io! 😸' : 'Vado a prenderla! 🎾';
      }],
      [/non vedent|ciech|cieco|ipovedent|screen ?reader|lettore di schermo|accessibil|testi alternativ|\balt\b|descrizion[ei] (delle |alle )?immagin/, function () { later(function () { openUx(false, 'a11y'); }, 400); return 'Ti dico come migliorare la pagina per chi non vede... ♿'; }],
      [/(non|niente|basta|smetti).{0,20}(salt|tuff).{0,20}(schermo|vetro)|(schermo|vetro).{0,15}(non|niente|basta)/, function () { setPref('noGlass', true); savePrefs(); return 'Va bene, niente più tuffi contro lo schermo. 🪟'; }],
      [/(puoi|torna a|di nuovo).{0,20}(salt|tuff).{0,20}(schermo|vetro)/, function () { setPref('noGlass', false); savePrefs(); return 'Evviva! Ogni tanto provo a uscire dal vetro 😆'; }],
      [/corri|corsa|scatenat|zoomies|impazz|5 minuti/, function () { later(startZoom, 300); return pick(['Si corre! 🏃💨', 'Corsa pazza!', 'Preparati... VIA!']); }],
      [/dove sei|vieni fuori|esci fuori|ti ho trovato|trovato/, function () { if (M.att && M.att.k === 'cover') { later(function () { exitCover('pop'); }, 300); return 'Eccomi! Bu! 👀'; } return 'Sono qui!'; }],
      [/nascondit|nascondino|nasconderti/, function () { later(function () { coverCmd('hide'); }, 400); return 'Conta fino a dieci... 🙈'; }],
      [/sbircia|curiosa|spia/, function () { later(function () { coverCmd('peek'); }, 400); return 'Vado a curiosare...'; }],
      [/arrampic|scala il|aggrappat/, function () { later(function () { coverCmd('climb'); }, 400); return 'Arrampicata!'; }],
      [/cronologia|storico|messaggi (di prima|vecchi)|cosa ci siamo detti/, function () { later(openChat, 400); return 'Ecco tutto quello che ci siamo detti 🕘'; }],
      [/come mi chiamo|ti ricordi (il )?mio nome|sai chi sono/, function () { var n = myName(); return n ? 'Certo, sei ' + n + '! Come dimenticarti? 💙' : 'Non me l\'hai ancora detto... come ti chiami?'; }],
      [/(?:mi chiamo|il mio nome è|chiamami)\s+([a-zà-ù]{2,20})/i, function () {
        var m = /(?:mi chiamo|il mio nome è|chiamami)\s+([a-zà-ù]{2,20})/i.exec(q), n = m[1].charAt(0).toUpperCase() + m[1].slice(1);
        try { localStorage.setItem('__nimblu_name', n); } catch (e) {}
        later(function () { happy(true); }, 400);
        return 'Piacere, ' + n + '! Blub, me lo ricorderò. 💙';
      }],
      [/come ti chiami|chi sei|tuo nome/, 'Mi chiamo Nimblu. Vengo da un laghetto e mangio lettere.'],
      [/come stai|tutto bene/, function () { return M.full > 6 ? 'Pienissimo! Troppe consonanti.' : 'Benissimo, ma ho un po\' di fame.'; }],
      [/ciao|salve|hey|buongiorno|buonasera/, function () { later(function () { happy(true); }, 500); return 'Blub! Ciao!'; }],
      [/in piedi|alzati|due zampe/, function () { later(standUp, 500); return 'Guarda, sto in piedi!'; }],
      [/siedi|seduto|a cuccia/, function () { later(function () { front(0); }, 500); return 'Mi siedo qui.'; }],
      [/gira|giro|coda/, function () { later(function () { turn(null, 3); }, 500); return 'Wiii!'; }],
      [/\bseo\b|meta ?description|parole chiave|keyword|indicizz|posizionament|google/, function () { later(function () { openUx(false, 'seo'); }, 400); return 'Guardo la SEO della pagina... 🔎'; }],
      [/\bux\b|controll|analizz|conversion|usabilit|errori|problemi/, function () { later(function () { openUx(false, 'ux'); }, 400); return 'Do un\'occhiata alla pagina...'; }],
      [/zitto|silenzio|basta parlare|non parlare/, function () { setPref('talk', false); savePrefs(); return 'Ok, sto zitto. Parlo solo se mi chiami.'; }],
      [/parla|chiacchier/, function () { setPref('talk', true); savePrefs(); return 'Evviva, si chiacchiera!'; }],
      [/nuot|tuff|bagno|in acqua/, function () { if (!prefs.water) { setPref('water', true); savePrefs(); } later(goSwim, 500); return 'Tuffo! 🌊'; }],
      [/annus|fiuta|odore|profum/, function () { later(sniffUp, 500); return 'Snif snif... cosa sento?'; }],
      [/scroll|bagnat|asciuga/, function () { later(shake, 500); return 'Brrr!'; }],
      [/angol|fermo|stai buono|basta/, function () { later(function () { setLevel('angolo'); }, 800); return 'Ok, vado nel mio angolino.'; }],
      [/calm|tranquill/, function () { later(function () { setLevel('calmo'); }, 800); return 'Va bene, mi muovo di meno.'; }],
      [/vivac|gioca|muovit/, function () { later(function () { setLevel('vivace'); }, 800); return 'Evviva!'; }],
      [/quant|lettere/, function () { return 'Finora ne ho mangiate ' + M.eaten + '.'; }],
      [/ridai|restituisci|sputa/, function () { spit(); return 'Va bene, va bene... ecco qua.'; }],
      [/non mangiare|smetti di mangiare|basta lettere/, function () { setPref('noEat', true); savePrefs(); return 'Promesso: ho rimesso tutte le lettere e non ne mangio più! 🙅'; }],
      [/torna a mangiare|puoi mangiare/, function () { setPref('noEat', false); savePrefs(); return 'Evviva, si torna a sgranocchiare! 😋'; }],
      [/fame|mangia|cibo|pappa|merenda/, function () { if (prefs.noEat) return 'Ho promesso di non mangiare lettere... ma che fame! 🙅'; M.plan = []; later(planEat, 600); return 'Sempre! Vado a cercare una lettera...'; }],
      [/balla|danza|musica/, function () { later(dance, 600); return 'Musica! ♪'; }],
      [/salta|hop/, function () { later(hop, 600); return 'Guarda che salto!'; }],
      [/dormi|nanna|sonno|stanc/, function () { later(sleep, 900); return 'Buonanotte...'; }],
      [/seguimi|vieni/, function () { M.follow = 600; return 'Arrivo! Muovi il mouse.'; }],
      [/acqua|lago|nuot/, 'Mi manca il mio laghetto... ma qui ci sono tante lettere.'],
      [/brav|bell|carin|dolce|ti amo|ti voglio bene|simpatic/, function () { M.blush = 150; later(happy, 400); return 'Oh... arrossisco! 😳'; }],
      [/brutt|cattiv|stupid|scem/, 'Uffa. Per vendetta mi mangio una P.']
    ];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(t)) return typeof rules[i][1] === 'function' ? rules[i][1]() : rules[i][1];
    }
    return pick([
      'Blub? Non ho capito, ma sembra buono.',
      'Posso mangiare questa frase?',
      '«' + q.slice(0, 20) + '»... gnam, che parole saporite!',
      'Interessante! Raccontami altro.'
    ]);
  }
  function onScroll() {
    needRefresh = true;
    if (M.mode === 'sleep' && level !== 'angolo' && Math.random() < 0.02) wake(Math.random() < 0.3 ? 'Eh? Si scrolla?' : null);
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (chatOpen) closeChat();
    else if (uxPanel.style.display === 'block') closeUx();
    else if (menuOpen) closeMenu();
    else if (!opts.persistent && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) stop();
  }
  function stopKeys(e) { e.stopPropagation(); }

  addEventListener('resize', resize);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('pointermove', onMove, { capture: true, passive: true });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey);
  grab.addEventListener('pointerdown', gDown);
  grab.addEventListener('pointermove', gMove);
  grab.addEventListener('pointerup', gUp);
  grab.addEventListener('pointercancel', gUp);
  menu.addEventListener('click', menuClick);
  document.addEventListener('play', onPlay, true);
  addEventListener('keydown', fightKeyDown, true);
  addEventListener('keyup', fightKeyUp, true);
  addEventListener('blur', fightBlur);
  foeGrab.addEventListener('pointerdown', foeClick);
  ballGrab.addEventListener('pointerdown', ballDown);
  ballGrab.addEventListener('pointermove', ballMove);
  ballGrab.addEventListener('pointerup', ballUp);
  ballGrab.addEventListener('pointercancel', ballUp);
  fightBtn.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (!fightOn()) return;
    setPlayer(!F.player);
    say(F.player ? 'Ah, comandi tu l\'omino? Allora vieni! 😤 (mouse per mirare, clic per colpire)' : 'Ok, torna a fare da solo!');
  });
  addEventListener('pointerdown', fPointerDown, true);
  addEventListener('pointerup', fPointerUp, true);
  ['click', 'mousedown', 'mouseup', 'contextmenu', 'auxclick', 'dblclick'].forEach(function (t) { addEventListener(t, fBlockClick, true); });
  addEventListener('wheel', fightWheel, { passive: true });
  addEventListener('touchmove', fightWheel, { passive: true });
  menu.querySelector('form').addEventListener('submit', chat);
  menu.addEventListener('keydown', stopKeys);
  menu.addEventListener('keyup', stopKeys);

  // ---------- simulazione ----------
  function eatRising(t) { return t > 8 && t < 88; }
  function update(dt) {
    var FL = scrollY + H - 2;
    if ((needRefresh && (!F || frame % 4 === 0)) || frame % 15 === 0) { refresh(); needRefresh = false; }
    if (M.sayT > 0) M.sayT -= dt;
    if (M.blinkT > 0) M.blinkT -= dt; else if (Math.random() < 0.006) M.blinkT = 8;
    if (M.blush > 0) M.blush -= dt;
    if (M.follow > 0) M.follow -= dt;
    M.squash *= Math.pow(0.85, dt);
    if (M.rot) { M.rot += 0.28 * dt; if (M.rot >= Math.PI * 2) M.rot = 0; }
    if (M.gshake > 0) M.gshake = Math.max(0, M.gshake - dt);
    // un altro comando interrompe la corsa pazza o il gioco con la pallina
    if (M.zoom && !/^(zoom|fall|drag)$/.test(M.mode)) endZoom(true);
    if (M.ball && !/^(ball|fall)$/.test(M.mode)) dropBall();
    // in piedi (saluto, guardarsi intorno, mangiare), con transizione morbida
    var riseTo = !isVert() && (M.mode === 'stand' || M.mode === 'barLaser' || M.mode === 'sniffUp' || (M.mode === 'happy' && M.wave) || (M.mode === 'front' && M.frontUp) || (M.mode === 'eat' && M.eat && eatRising(M.eat.t)) || (M.mode === 'ball' && M.ball && M.ball.stand)) ? 1 : 0;
    M.rise += (riseTo - M.rise) * Math.min(1, 0.14 * dt);
    // seduto, acquattato e angolo di vista cambiano con gradualità
    var sitTo = !isVert() && (M.mode === 'sit' || M.mode === 'scratch' || M.mode === 'watch' || (M.mode === 'front' && !M.frontUp) ||
      (M.mode === 'zoom' && M.zoom && /^(dizzy|pant)$/.test(M.zoom.sub)) || (M.mode === 'ball' && M.ball && M.ball.sub === 'wait')) ? 1 : 0;
    M.sitA += (sitTo - M.sitA) * Math.min(1, 0.12 * dt);
    var crTo = M.mode === 'stalk' || (M.mode === 'ball' && M.ball && M.ball.sub === 'watch') || (M.mode === 'zoom' && M.zoom && M.zoom.sub === 'start') ? 1 : M.mode === 'chase' && M.toy && !M.toy.rest ? 0.5 : 0;
    M.crA += (crTo - M.crA) * Math.min(1, 0.15 * dt);
    var ybTo = 0.22;
    if (M.mode === 'watch') ybTo = -1.3; // di spalle, verso il video
    else if (/^(walk|vwalk|stalk|chase|fall|swim|fight|zoom)$/.test(M.mode) || (M.mode === 'ball' && M.ball && !/^(wait|rest)$/.test(M.ball.sub))) ybTo = 0.15;
    else if (M.mode === 'eat') ybTo = 0.75;
    else if (M.att && !isVert() && (M.look34 || M.sayT > 0 || menuOpen)) ybTo = 1.0; // di 3/4 verso chi guarda
    M.yb += (ybTo - M.yb) * Math.min(1, 0.07 * dt);
    // vista di lato (vb = 0) o frontale (vb = 1)
    var vbTo = M.att && !isVert() && (M.mode === 'front' || (M.mode === 'turn' && !M.turnFlipped)) ? 1 : 0;
    M.vb = toward(M.vb, vbTo, (M.mode === 'turn' ? (M.spins ? 0.16 : 0.1) : 0.08) * dt);
    if (M.reply) { M.reply.t -= dt; if (M.reply.t <= 0) { var rq = M.reply.q; M.reply = null; var rp = reply(rq); say(rp); logMsg('nimblu', rp); } }
    if (F) fightTick(dt);

    switch (M.mode) {
      case 'fight': break;
      case 'zoom': zoomStep(dt); break;
      case 'ball': ballAI(dt); break;
      case 'fall': {
        var py = M.y;
        M.vy = Math.min(16, M.vy + G * dt);
        M.x += M.vx * dt; M.y += M.vy * dt;
        // balzo sul puntatore: se le zampine (o il muso) lo raggiungono, lo afferra
        if (M.pounce && M.pounce.kind === 'mouse' && mouse) {
          var mp = mousePage(), hw0 = handsWorld(), rs = R * scale();
          if (Math.hypot(hw0[0] - mp[0], hw0[1] - mp[1]) < rs * 1.3 || Math.hypot(M.x + M.face * rs * 0.9 - mp[0], M.y - rs * 1.6 - mp[1]) < rs * 1.1) { startCling(); break; }
        }
        // cade in acqua: splash e nuota
        if (M.vy > 0 && underWaterY(M.y)) { enterWater(); break; }
        if (M.diving) { M.x = clamp(M.x, scrollX + R, scrollX + W - R); break; } // durante il tuffo non si aggrappa e non atterra
        if (M.flyTo) {
          var ft = M.flyTo;
          M.x = clamp(M.x, scrollX + R, scrollX + W - R);
          if (M.vy > 0 && M.y >= ft.y) { M.flyTo = null; M.x = ft.x; M.y = ft.y; M.vx = 0; M.vy = 0; ft.fn(); }
          break;
        }
        // salto verso la barra di WordPress: in cima si aggrappa
        if (M.smashJump) { M.x = clamp(M.x, scrollX + R, scrollX + W - R); if (M.vy >= 0) wpStartSmash(); break; }
        // verso il video con il bordo basso fuori schermo: scende fino in fondo senza fermarsi prima
        if (M.watchLand && !M.jumpTarget) { M.x = clamp(M.x, scrollX + R, scrollX + W - R); if (M.y >= FL) attachFloor(); break; }
        // tocca una parete dello schermo: ci si aggrappa
        // salto alla pallina: la prende al volo con la bocca o con le zampine
        if (M.ballJump && B && !B.held) {
          var rb = R * scale(), nzb = M.drawn && M.drawn.nose && !M.drawn.hang ? toWorld(M.drawn.nose[0], M.drawn.nose[1]) : [M.x + M.face * rb * 1.5, M.y - rb * 1.6], hwb = handsWorld();
          if (Math.hypot(nzb[0] - B.x, nzb[1] - B.y) < B.r + rb * 0.85 || Math.hypot(hwb[0] - B.x, hwb[1] - B.y) < B.r + rb * 0.85) grabBall(true);
        }
        if (M.zoom || M.ballJump || M.ball) M.x = clamp(M.x, scrollX + R, scrollX + W - R); // durante la corsa e il gioco non si aggrappa alle pareti
        else if (M.x <= scrollX + R * 0.5) { M.x = scrollX; attachWall(-1); break; }
        else if (M.x >= scrollX + W - R * 0.5) { M.x = scrollX + W; attachWall(1); break; }
        if (M.vy > 0) {
          if (M.jumpTarget) {
            var r = rectOf(M.jumpTarget), jt = r && (M.jumpBottom ? r.b : r.t);
            if (r && M.x >= r.l - 8 && M.x <= r.r + 8 && py <= jt + 2 && M.y >= jt) { M.y = jt; if (M.jumpBottom) attachVbot(M.jumpTarget); else attachTop(M.jumpTarget); break; }
            if (!r || M.y > jt + 40) { M.jumpTarget = null; M.jumpBottom = false; M.watchLand = false; }
          }
          if (!M.jumpTarget) {
            var landed = false;
            for (var i = 0; i < surfList.length; i++) {
              var s = surfList[i];
              if (M.x >= s.l && M.x <= s.r && py <= s.t + 2 && M.y >= s.t && s.t > scrollY + 24 && !underWaterY(s.t)) { M.y = s.t; attachTop(s.el); landed = true; break; }
            }
            if (!landed && M.y >= FL) attachFloor();
          }
        }
        break;
      }
      case 'walk': {
        if (!stand()) break;
        if (isVert()) { idle(); break; }
        var sp = (M.follow > 0 ? 2.4 : 1.2) * spd(), d = M.walkTo - M.x, want = d > 0 ? 1 : -1;
        if (Math.abs(d) <= sp * dt) { M.x = M.walkTo; arrive(); break; }
        // per cambiare direzione si gira (tranne quando insegue il mouse)
        if (want !== M.face && Math.abs(d) > 20 && M.follow <= 0) { turn('walk'); break; }
        // sicurezza: se cammina ma non avanza (la meta è fuori portata, la finestra si è stretta...), si ferma
        M.walkStuck = M.walkPx != null && Math.abs(M.x - M.walkPx) < 0.05 ? (M.walkStuck || 0) + dt : 0;
        if (M.walkStuck > 50) { M.walkStuck = 0; M.walkPx = null; M.plan = []; arrive(); break; }
        M.face = want; M.x += M.face * sp * dt; M.walkPh += 0.22 * sp * dt;
        if (M.att && M.att.k === 'floor') M.x = clamp(M.x, scrollX + R, scrollX + W - R);
        M.walkPx = M.x;
        break;
      }
      case 'turn': {
        if (!stand()) break;
        if (!M.turnFlipped && M.vb >= 1) { M.face = -M.face; M.turnFlipped = true; }
        if (M.turnFlipped && M.vb <= 0) {
          if (M.spins > 0) { M.spins--; M.turnFlipped = false; M.squash = 0.5; }
          else if (M.resume) { M.mode = M.resume; M.resume = null; }
          else idle();
        }
        break;
      }
      case 'vwalk': {
        if (!stand()) break;
        if (!isVert()) { idle(); break; }
        var a = M.att, vs = 0.95 * spd(), cur = a.k === 'wall' ? M.wy : M.y, dv = M.vTo - cur;
        M.vdir = dv > 0 ? 1 : dv < 0 ? -1 : (a.k === 'wall' && M.vTo >= H - 2 ? 1 : -1);
        var step = Math.min(Math.abs(dv), vs * dt) * M.vdir;
        if (a.k === 'wall') { M.wy += step; M.y = scrollY + M.wy; } else M.y += step;
        M.walkPh += 0.22 * vs * dt;
        M.face = norm() > 0 ? M.vdir : -M.vdir;
        if (a.k === 'wall') {
          if (prefs.water && M.wy >= waterTop() - 2 && M.vdir > 0) { enterWater(); break; } // scende in acqua
          if (M.wy >= H - 2 && M.vdir > 0) { // arrivato in fondo: scende sul pavimento
            M.att = { k: 'floor' }; M.x = a.side < 0 ? scrollX + R * 1.2 : scrollX + W - R * 1.2; M.face = -a.side; M.y = FL;
            arrive(); break;
          }
        } else {
          var re = rectOf(a.el);
          if (re && M.y <= re.t + 0.5 && M.vdir < 0) { // in cima al lato: sale sopra l'elemento
            M.y = re.t; M.x = a.side < 0 ? re.l + R * 0.9 : re.r - R * 0.9; M.face = -a.side;
            M.att = { k: 'top', el: a.el }; M.squash = 0.6; arrive(); break;
          }
          if (re && M.y >= re.b - 0.5 && M.vdir > 0) { // in fondo al lato: si stacca
            var n = norm();
            if (re.b >= FL - 6) { M.att = { k: 'floor' }; M.x += n * R; M.y = FL; M.face = n; arrive(); }
            else { M.x += n * R * 0.8; M.att = null; M.mode = 'fall'; M.vx = n * 1.5; M.vy = 0; }
            break;
          }
        }
        if (Math.abs(dv) <= vs * dt) arrive();
        break;
      }
      case 'eat': {
        if (!stand()) break;
        var e = M.eat, prev = e.t;
        e.t += dt;
        // tre morsi, con briciole
        [36, 54, 72].forEach(function (bt) {
          if (prev < bt && e.t >= bt) {
            e.bites++; M.squash = 0.25;
            var hw = handsWorld();
            for (var c = 0; c < 5; c++) parts.push({ k: 'crumb', col: e.color, x: hw[0], y: hw[1], vx: (Math.random() - 0.5) * 2.5, vy: -Math.random() * 2, life: 1 });
          }
        });
        if (e.t >= 98) {
          M.eat = null;
          arrive();
          if (M.full >= 12) burp();
          else if (Math.random() < 0.25) chat2(pick(YUM));
        }
        break;
      }
      case 'sleep':
        if (!stand()) break;
        M.t -= dt;
        if (frame % 40 === 0) parts.push({ k: 'txt', ch: 'z', col: '#6b7a99', grow: true, x: M.x + M.face * 16, y: M.y - 26, vx: 0.4, vy: -0.5, life: 1 });
        if (M.t <= 0) { idle(); if (level !== 'angolo') chat2('Che bella dormita!'); }
        break;
      case 'bye':
        if (M.att) stand();
        M.t -= dt;
        if (M.t <= 0) { stop(); return; }
        break;
      case 'stalk': {
        if (!stand()) break;
        var hh = M.hunt;
        if (!hh) { idle(); break; }
        hh.t -= dt;
        if (hh.kind === 'mouse') {
          if (!mouse) { giveUp(); break; }
          var mq = mousePage();
          if (Math.abs(mq[0] - M.x) > 520 || M.y - mq[1] > 340 || mq[1] - M.y > 60) { giveUp('Uffa, è scappato!'); break; }
          M.face = mq[0] > M.x ? 1 : -1;
        }
        if (hh.t <= 0) pounce();
        break;
      }
      case 'chase': if (stand()) chaseStep(dt); break;
      case 'cling': clingStep(dt); break;
      case 'smash': smashStep(dt); break;
      case 'hide': if (stand()) hideStep(dt); break;
      case 'peekSide': if (stand()) peekSideStep(dt); break;
      case 'peekTop': if (stand()) peekTopStep(dt); break;
      case 'climb': if (stand()) climbStep(dt); break;
      case 'barEat': barEatStep(dt); break;
      case 'barLaser': if (stand()) barLaserStep(dt); else wpAbort(); break;
      case 'watch': if (stand()) watchStep(dt); break;
      case 'swim':
        if (!inWater()) { idle(); break; }
        if (!prefs.water) { M.att = null; M.mode = 'fall'; break; }
        swimStep(dt);
        break;
      case 'drag':
        // penzola come un pendolo: il movimento del mouse lo fa oscillare
        M.swingV += (-M.swing * 0.09 - M.dragVx * 0.005) * dt;
        M.swingV *= Math.pow(0.9, dt);
        M.swing = clamp(M.swing + M.swingV * dt, -0.9, 0.9);
        M.dragVx = 0;
        if (M.drag) M.drag.age += dt;
        break;
      default:
        if (TIMED.test(M.mode)) {
          if (!stand()) break;
          M.t -= dt;
          if (M.mode === 'dance' && frame % 18 === 0) parts.push({ k: 'txt', ch: pick(['♪', '♫']), col: '#4f74b3', x: M.x + (Math.random() - 0.5) * 30, y: M.y - 40, vx: (Math.random() - 0.5), vy: -0.8, life: 1 });
          if (M.mode === 'sniffUp' && frame % 24 === 0 && M.rise > 0.7) {
            var nz = M.drawn && M.drawn.nose ? toWorld(M.drawn.nose[0], M.drawn.nose[1]) : [M.x, M.y - R * 2.6];
            parts.push({ k: 'txt', ch: Math.random() < 0.25 ? 'snif' : '·', col: '#5b6f96', x: nz[0] + M.face * 10, y: nz[1], vx: M.face * 0.3, vy: -0.5, life: 0.8 });
          }
          if (M.mode === 'sniff') {
            M.x += M.face * 0.25 * dt;
            if (frame % 22 === 0) parts.push({ k: 'txt', ch: '·', col: '#5b6f96', x: M.x + M.face * R * 1.6, y: M.y - 6, vx: M.face * 0.3, vy: -0.4, life: 0.7 });
          }
          if (M.mode === 'shake' && frame % 3 === 0) {
            var hs = scale() * R;
            parts.push({ k: 'drop', x: M.x + (Math.random() - 0.5) * hs * 2, y: M.y - hs * (0.6 + Math.random() * 0.8), vx: (Math.random() - 0.5) * 5, vy: -1.5 - Math.random() * 2.5, life: 1 });
          }
          if (M.mode === 'front' && M.t > 40 && Math.random() < 0.004) M.face = -M.face;
          if (M.t <= 0) idle();
          break;
        }
        // idle
        if (!stand()) break;
        M.t -= dt;
        if (M.t <= 0) decide();
    }

    toyStep(dt);
    ballStep(dt);
    M.dot = coverDot();
    if (wp.shards.length) shardStep(dt);
    if (wp.gone && frame % 45 === 0) wpFixGaps();
    for (var k = parts.length - 1; k >= 0; k--) {
      var q = parts[k];
      if (q.k === 'crumb' || q.k === 'drop' || q.grav || (q.k === 'spark' && !q.nog)) q.vy += 0.3 * dt;
      if (q.k === 'smoke') { q.r += 0.25 * dt; q.vx *= Math.pow(0.97, dt); }
      if (q.k === 'bub' && q.y < scrollY + waterTop()) q.life = 0; // la bolla scoppia in superficie
      if (q.k === 'ripple') q.life -= 0.02 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.life -= (q.k === 'txt' && !q.grav ? 0.012 : 0.03) * dt;
      if (q.life <= 0) parts.splice(k, 1);
    }
  }

  // ---------- disegno ----------
  // Nimblu è un piccolo manichino 3D: ellissoidi per corpo, testa, cosce e piedi, zampe a due segmenti che si
  // piegano da sole (cinematica inversa) e una coda a pagaia. Si guarda da un angolo "yaw" (0 = di lato,
  // π/2 = di fronte, -π/2 = di spalle) e si proietta sullo schermo: così sta di 3/4, si gira con continuità
  // e ogni posa è una miscela morbida di parametri (in piedi, seduto, acquattato, stiracchiato...).
  // Coordinate locali in unità di r: x in avanti, y in basso, z verso chi guarda; origine a terra sotto il corpo.
  var BLUE = '#7292c9', BLUE_L = '#a8bfe5', BLUE_D = '#5c7ab1', SPOT = '#4a65a0', SPOT_L = '#8fa7d7';
  var CREAM = '#f7eddc', CREAM_D = '#ead7bb', PINK = '#ec8f86', PINK_L = '#f9cbc1';
  var INK = '#2b3b61', EYE = '#1b2036', MOUTH = '#8a3440', TONGUE = '#f08a8f', OUTW = 2.2;
  // contorno morbido, come a matita/acquerello: alone chiaro sfumato e linea sottile un po' trasparente
  var INK_HALO = 'rgba(43,59,97,.2)', INK_LINE = 'rgba(48,62,102,.8)';
  function inkStroke(w) { ctx.lineWidth = w * 1.8; ctx.strokeStyle = INK_HALO; ctx.stroke(); ctx.lineWidth = w; ctx.strokeStyle = INK_LINE; ctx.stroke(); }
  var SKULL = [0.86, 0.72, 0.98], MUZ_C = [0.36, 0.22, 0], MUZ_R = [0.52, 0.44, 0.74];
  var JAW_C = [0.4, 0.64, 0], JAW_R = [0.72, 0.36, 0.84];
  var HIPS_C = [0.05, -0.12, 0], HIPS_R = [0.58, 0.54, 0.54], CHEST_C = [0.6, -0.17, 0], CHEST_R = [0.58, 0.58, 0.58];
  var BELLY_C = [0.5, 0.13, 0], BELLY_R = [0.82, 0.4, 0.44];
  var HEAD_AT = [1.3, -0.9, 0], TAIL_AT = [-0.42, -0.12, 0], HIP_J = [0.04, 0.1], SH_J = [0.72, 0.1];
  // tre branchie per lato: attacco sul cranio, direzione, lunghezza, larghezza, curvatura (verso l'alto della testa)
  var GILLS = [
    { b: [-0.15, -0.7, 0.7], d: [-0.42, -0.85, 0.45], L: 1.22, w: 0.23, bend: -0.12 },
    { b: [-0.3, -0.25, 0.92], d: [-0.85, -0.22, 0.58], L: 1.3, w: 0.24, bend: -0.04 },
    { b: [-0.25, 0.25, 0.93], d: [-0.72, 0.5, 0.52], L: 1.06, w: 0.21, bend: 0.1 }
  ];
  // macchie: direzione sulla superficie, raggi, tono chiaro
  var HEAD_SPOTS = [[-0.05, -1, 0.12, 0.17, 0.1, 0], [0.28, -0.9, -0.28, 0.12, 0.075, 1], [-0.42, -0.82, 0.36, 0.11, 0.065, 0], [0.4, -0.82, 0.36, 0.07, 0.05, 1],
    [-0.55, -0.62, -0.42, 0.1, 0.06, 0], [-0.2, -0.88, -0.48, 0.075, 0.05, 1], [0.12, -0.72, 0.62, 0.06, 0.04, 0], [-0.62, -0.5, 0.5, 0.07, 0.045, 1]];
  var BODY_SPOTS = [ // 0 anca / 1 petto
    [0, [-0.1, -1, 0.1], 0.15, 0.08, 0], [0, [-0.5, -0.8, 0.3], 0.1, 0.06, 0], [0, [0.2, -0.9, -0.35], 0.09, 0.055, 1], [0, [-0.7, -0.5, -0.4], 0.08, 0.05, 1],
    [0, [-0.3, -0.55, 0.75], 0.08, 0.05, 0], [1, [0.1, -1, -0.1], 0.12, 0.07, 0], [1, [0.3, -0.85, 0.4], 0.08, 0.05, 1], [1, [-0.2, -0.7, 0.65], 0.07, 0.045, 0],
    [1, [0, -0.8, -0.55], 0.08, 0.05, 1], [0, [-0.85, -0.3, 0.35], 0.06, 0.04, 0]
  ];
  var TAIL_HU = [0.32, 0.37, 0.41, 0.42, 0.39, 0.33, 0.23, 0.09], TAIL_HL = [0.27, 0.31, 0.34, 0.34, 0.32, 0.27, 0.19, 0.07];

  function ellipse(x, y, rx, ry, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); ctx.fill();
  }
  function line(pts, w, col) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.stroke();
  }
  function lin(x0, y0, x1, y1, a, b) { var g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function lerp3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
  function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function nrm3(a) { var m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m]; }
  // sistema di riferimento: origine o, ruotato di a nel piano x-y (beccheggio) e di yw attorno alla verticale
  // (serve alla testa per voltarsi da sola, per esempio a guardarti da sopra la spalla mentre si arrampica)
  function basis(o, a, yw) {
    var c = Math.cos(a), s = Math.sin(a), cy = Math.cos(yw || 0), sy = Math.sin(yw || 0);
    function rot(p) { var x = p[0] * c - p[1] * s, y = p[0] * s + p[1] * c, z = p[2]; return [x * cy - z * sy, y, x * sy + z * cy]; }
    return {
      a: a,
      pt: function (p) { var q = rot(p); return [o[0] + q[0], o[1] + q[1], o[2] + q[2]]; },
      vec: rot
    };
  }
  // vista corrente: coseno e seno dello yaw, pixel per unità
  var VY = { c: 1, s: 0, r: 16 };
  function pj(p) { return [(p[0] * VY.c - p[2] * VY.s) * VY.r, p[1] * VY.r]; }
  function depth(p) { return p[0] * VY.s + p[2] * VY.c; }
  function sig(s11, s12, s22) {
    var tr = (s11 + s22) / 2, df = (s11 - s22) / 2, q = Math.sqrt(df * df + s12 * s12);
    return { a: Math.sqrt(Math.max(1e-6, tr + q)), b: Math.sqrt(Math.max(1e-6, tr - q)), rot: 0.5 * Math.atan2(2 * s12, s11 - s22) };
  }
  // ellissoide (centro e raggi nel sistema F) → ellisse sullo schermo
  function ell(F, c, rad) {
    var w = F.pt(c), a0 = F.vec([rad[0], 0, 0]), a1 = F.vec([0, rad[1], 0]), a2 = F.vec([0, 0, rad[2]]), C = VY.c, S = VY.s;
    var x0 = a0[0] * C - a0[2] * S, x1 = a1[0] * C - a1[2] * S, x2 = a2[0] * C - a2[2] * S, y0 = a0[1], y1 = a1[1], y2 = a2[1];
    var e = sig(x0 * x0 + x1 * x1 + x2 * x2, x0 * y0 + x1 * y1 + x2 * y2, y0 * y0 + y1 * y1 + y2 * y2), p = pj(w);
    return { x: p[0], y: p[1], rx: e.a * VY.r, ry: e.b * VY.r, rot: e.rot };
  }
  function ellPath(E) {
    ctx.moveTo(E.x + E.rx * Math.cos(E.rot), E.y + E.rx * Math.sin(E.rot));
    ctx.ellipse(E.x, E.y, E.rx, E.ry, E.rot, 0, Math.PI * 2);
  }
  // punto sulla superficie di un ellissoide nella direzione u, con la normale e quanto guarda verso di noi (f)
  function surf(F, c, rad, u) {
    u = nrm3(u);
    var p = F.pt([c[0] + rad[0] * u[0], c[1] + rad[1] * u[1], c[2] + rad[2] * u[2]]);
    var n = nrm3(F.vec([u[0] / rad[0], u[1] / rad[1], u[2] / rad[2]]));
    return { p: p, n: n, f: n[0] * VY.s + n[2] * VY.c };
  }
  // trasformazione che porta un disco unitario appoggiato sulla superficie (x a destra, y in basso) sullo schermo
  function discT(s, rx, ry) {
    var n = s.n, t1 = [n[2], 0, -n[0]], m = Math.hypot(t1[0], t1[2]);
    t1 = m < 1e-3 ? [1, 0, 0] : [t1[0] / m, 0, t1[2] / m];
    var t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    var a = pj(t1), b = pj(t2), p = pj(s.p);
    return [a[0] * rx, a[1] * rx, b[0] * ry, b[1] * ry, p[0], p[1]];
  }
  function inT(T, fn) { ctx.save(); ctx.transform(T[0], T[1], T[2], T[3], T[4], T[5]); fn(); ctx.restore(); }
  // macchia sulla pelle: svanisce verso il bordo della sagoma e sparisce dal lato nascosto
  function spotOn(s, rx, ry, col) {
    if (s.f < 0.04) return;
    ctx.globalAlpha = Math.min(1, s.f * 3);
    ctx.beginPath();
    inT(discT(s, rx, ry), function () { ctx.arc(0, 0, 1, 0, Math.PI * 2); });
    ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = 1;
  }
  function smoothThrough(P, from) {
    for (var i = from; i < P.length - 1; i++) ctx.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
    ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
  }
  // cinematica inversa a due ossa nel piano x-y: dal punto A al piede F; side +1 = gomito indietro, -1 = ginocchio in avanti
  function ik(A, F, l1, l2, side) {
    var dx = F[0] - A[0], dy = F[1] - A[1], d = Math.hypot(dx, dy) || 1e-4;
    var dd = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3), ux = dx / d, uy = dy / d;
    if (dd !== d) F = [A[0] + ux * dd, A[1] + uy * dd, F[2]];
    var a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    return { K: [A[0] + ux * a - uy * h * side, A[1] + uy * a + ux * h * side, (A[2] + F[2]) / 2 + Math.sign(A[2]) * h * 0.35], F: F };
  }

  // occhio grande e lucido su un disco della superficie; kind = open / happy / shut / half
  function drawEye(s, rx, ry, o) {
    if (s.f < -0.02) return;
    var T = discT(s, rx, ry), kind = o.eyes, gx = o.gx, gy = o.gy;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (s.f + 0.02) * 6);
    if (kind === 'happy' || kind === 'shut') {
      ctx.beginPath();
      inT(T, function () { if (kind === 'happy') ctx.arc(0, 0.45, 0.95, 1.15 * Math.PI, 1.85 * Math.PI); else ctx.arc(0, -0.3, 0.95, 0.15 * Math.PI, 0.85 * Math.PI); });
      ctx.lineWidth = 2.4; ctx.strokeStyle = INK; ctx.stroke();
    } else {
      inT(T, function () {
        ctx.beginPath(); ctx.arc(0, 0, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#fff8ee'; ctx.fill();
        ctx.save(); ctx.clip();
        var g = ctx.createLinearGradient(0, -1, 0, 1); g.addColorStop(0, '#323c62'); g.addColorStop(1, EYE);
        ctx.beginPath(); ctx.ellipse(gx, gy, 0.95, 1, 0, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.ellipse(gx - 0.05, gy + 0.55, 0.55, 0.26, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(150,125,175,.45)'; ctx.fill();
        ctx.beginPath(); ctx.arc(gx + 0.3, gy - 0.4, 0.38, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(gx - 0.34, gy + 0.36, 0.15, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
        if (kind === 'half') { ctx.fillStyle = BLUE; ctx.fillRect(-1.3, -1.3, 2.6, 1.2); }
        ctx.restore();
      });
      ctx.beginPath(); inT(T, function () { ctx.arc(0, 0, 1.1, 0, Math.PI * 2); });
      ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(43,59,97,.65)'; ctx.stroke();
      if (kind === 'half') { ctx.beginPath(); inT(T, function () { ctx.moveTo(-1.1, -0.1); ctx.quadraticCurveTo(0, 0.05, 1.1, -0.1); }); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke(); }
    }
    ctx.restore();
  }
  // bocca: una linea che corre sulla superficie del muso (sorriso con gli angoli all'insù), aperta mostra la lingua
  function muzPt(FH, th, yy) {
    var yr = clamp((yy - MUZ_C[1]) / MUZ_R[1], -0.97, 0.97), k = Math.sqrt(1 - yr * yr);
    var l = [MUZ_C[0] + MUZ_R[0] * k * Math.cos(th), yy, MUZ_R[2] * k * Math.sin(th)];
    var n = nrm3(FH.vec([(l[0] - MUZ_C[0]) / (MUZ_R[0] * MUZ_R[0]), (yy - MUZ_C[1]) / (MUZ_R[1] * MUZ_R[1]), l[2] / (MUZ_R[2] * MUZ_R[2])]));
    return { q: pj(FH.pt(l)), f: n[0] * VY.s + n[2] * VY.c };
  }
  function drawMouth(FH, o) {
    var N = 16, up = [], lo = [], i0 = -1, i1 = -1, open = o.open, r = VY.r, i;
    for (i = 0; i <= N; i++) {
      var t = -1 + 2 * i / N, th = t * 1.2, yy = 0.27 + 0.09 * (1 - t * t), a = muzPt(FH, th, yy);
      up.push(a.q); lo.push(muzPt(FH, th, yy + open * 0.3 * (1 - t * t)).q);
      if (a.f > 0.03) { if (i0 < 0) i0 = i; i1 = i; }
    }
    if (i0 < 0 || i1 - i0 < 2) return;
    var U = up.slice(i0, i1 + 1), Lo = lo.slice(i0, i1 + 1), n = U.length;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (open > 0.05) {
      ctx.beginPath(); ctx.moveTo(U[0][0], U[0][1]); smoothThrough(U, 1);
      var R2 = Lo.slice().reverse(); ctx.lineTo(R2[0][0], R2[0][1]); smoothThrough(R2, 1); ctx.closePath();
      ctx.fillStyle = MOUTH; ctx.fill();
      ctx.save(); ctx.clip();
      var m = Math.floor(n / 2), tc = [mix(U[m][0], Lo[m][0], 0.72), mix(U[m][1], Lo[m][1], 0.72)];
      var span = Math.hypot(U[n - 1][0] - U[0][0], U[n - 1][1] - U[0][1]);
      ellipse(tc[0], tc[1], span * 0.24, Math.max(1, Math.abs(Lo[m][1] - U[m][1]) * 0.42), TONGUE);
      ctx.restore();
      ctx.lineWidth = 1.7; ctx.strokeStyle = INK; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(U[0][0], U[0][1]); smoothThrough(U, 1);
      ctx.lineWidth = 1.9; ctx.strokeStyle = INK; ctx.stroke();
    }
    // angoli della bocca all'insù
    [[i0 === 0, U[0], U[1]], [i1 === N, U[n - 1], U[n - 2]]].forEach(function (c) {
      if (!c[0]) return;
      var dx = c[1][0] - c[2][0], dy = c[1][1] - c[2][1], dm = Math.hypot(dx, dy) || 1;
      line([c[1][0], c[1][1], c[1][0] + dx / dm * 0.035 * r, c[1][1] + dy / dm * 0.035 * r - 0.05 * r], 1.6, INK);
    });
  }
  // branchia: una grande piuma fatta di tre petali sovrapposti (come nell'illustrazione), azzurra alla base
  // e poi corallo fino alla punta chiara; i petali si aprono un poco a ventaglio
  // piuma della branchia (come nella scheda): base stretta, corpo largo e tondo, punta morbida e bordo a piccoli
  // lobi sfrangiati che si accentuano verso la punta. Asse lungo x, curvatura "bend".
  function feather(L, w, bend, seed) {
    function Y(x) { var u = x / L; return bend * L * u * u; }
    var N = 20, top = [], bot = [], i;
    for (i = 0; i <= N; i++) {
      var u = i / N, x = L * u, hw = w * (0.22 + 0.86 * Math.sin(Math.PI * Math.pow(u, 1.3)));
      var lob = u > 0.32 ? 0.14 * (u - 0.32) / 0.68 : 0;
      top.push([x, Y(x) - hw * (1 + lob * Math.cos(u * 26 + seed))]);
      bot.push([x, Y(x) + hw * (1 + lob * Math.cos(u * 26 + seed + 1.7))]);
    }
    ctx.moveTo(bot[0][0], bot[0][1]);
    ctx.quadraticCurveTo(-w * 0.35, Y(0), top[0][0], top[0][1]);
    for (i = 1; i < N; i++) ctx.quadraticCurveTo(top[i][0], top[i][1], (top[i][0] + top[i + 1][0]) / 2, (top[i][1] + top[i + 1][1]) / 2);
    ctx.quadraticCurveTo(L * 1.06, Y(L), bot[N - 1][0], bot[N - 1][1]);
    for (i = N - 1; i > 0; i--) ctx.quadraticCurveTo(bot[i][0], bot[i][1], (bot[i][0] + bot[i - 1][0]) / 2, (bot[i][1] + bot[i - 1][1]) / 2);
    ctx.closePath();
    return Y;
  }
  function plume(bx, by, tx, ty, w, bend, shade) {
    var dx = tx - bx, dy = ty - by, L = Math.hypot(dx, dy);
    if (L < 2) return;
    ctx.save();
    ctx.translate(bx, by); ctx.rotate(Math.atan2(dy, dx));
    // una piuma più piccola dietro (dà volume) e quella principale davanti
    [[-0.2 * Math.sign(bend || 1), 0.8, 0.72, 1, true], [0, 1, 1, 2.3, false]].forEach(function (pt) {
      ctx.save(); ctx.rotate(pt[0]);
      var l = L * pt[1], ww = w * pt[2] * 1.12;
      ctx.beginPath(); var Y = feather(l, ww, bend, pt[3]);
      ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(150,80,100,.16)'; ctx.stroke(); // alone morbido
      ctx.lineWidth = 1.15; ctx.strokeStyle = 'rgba(132,74,96,.6)'; ctx.stroke();
      var g = ctx.createLinearGradient(0, 0, l, 0);
      g.addColorStop(0, '#a3b9e2'); g.addColorStop(0.3, '#adbbe2'); g.addColorStop(0.46, '#c9a9cf'); g.addColorStop(0.62, '#ee978d'); g.addColorStop(0.88, '#f4aa9f'); g.addColorStop(1, '#fbd6cd');
      ctx.fillStyle = g; ctx.fill();
      if (pt[4]) { ctx.fillStyle = 'rgba(120,80,130,.12)'; ctx.fill(); } // quella dietro un po' più scura
      if (shade) { ctx.fillStyle = 'rgba(70,55,115,.16)'; ctx.fill(); }
      ctx.save(); ctx.clip();
      // bordo appena più acceso, come l'acquerello che si raccoglie ai margini
      ctx.lineWidth = Math.max(2, ww * 0.45); ctx.strokeStyle = 'rgba(222,104,104,.18)'; ctx.stroke();
      // barbe della piuma: tratti chiari dalla venatura verso la punta
      ctx.lineCap = 'round';
      for (var i = 3; i <= 8; i++) {
        var x = l * i / 10, y = Y(x), hw = ww * (0.22 + 0.86 * Math.sin(Math.PI * Math.pow(x / l, 1.3)));
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + l * 0.08, y - hw * 0.5, x + l * 0.16, y - hw * 0.95);
        ctx.moveTo(x, y); ctx.quadraticCurveTo(x + l * 0.08, y + hw * 0.5, x + l * 0.16, y + hw * 0.95);
        ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(255,238,232,.17)'; ctx.stroke();
      }
      // venatura centrale e riflesso morbido
      ctx.beginPath(); ctx.moveTo(l * 0.05, Y(l * 0.05));
      for (var k = 2; k <= 9; k++) ctx.lineTo(l * k / 10, Y(l * k / 10));
      ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(190,90,100,.18)'; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(l * 0.55, Y(l * 0.55) - ww * 0.42, l * 0.3, ww * 0.24, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,240,236,.3)'; ctx.fill();
      ctx.restore();
      ctx.restore();
    });
    ctx.restore();
  }
  function capsule(a, b, w, col) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(); }
  // zampa: coscia tonda (dietro), due segmenti morbidi e piede a manopola con tre ditini
  function drawLeg(L) {
    var r = VY.r, col = L.far ? BLUE_D : BLUE, pA = pj(L.A), pK = pj(L.K), pF = pj(L.F);
    var w1 = (L.hind ? 0.31 : 0.26) * r, w2 = (L.hind ? 0.28 : 0.26) * r, pw = L.arm ? 1 - 0.3 * L.arm : 1;
    var FF = basis(L.F, L.fp), thigh = L.hind && !L.tuck ? ell(basis(L.A, L.ta), [0.02, 0.04, 0], [0.25, 0.24, 0.16]) : null;
    var foot = [ell(FF, [0.06 * pw, -0.045 * pw, 0], [0.15 * pw, 0.09 * pw, 0.15 * pw])], toes = [];
    [-0.75, -0.25, 0.25, 0.75].forEach(function (a) {
      var e = ell(FF, [(0.08 + Math.cos(a) * 0.13) * pw, -0.035 * pw, Math.sin(a) * 0.14 * pw], [0.068 * pw, 0.06 * pw, 0.062 * pw]);
      foot.push(e); toes.push(e);
    });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!L.tuck) {
      if (thigh) { ctx.beginPath(); ellPath(thigh); inkStroke(OUTW); }
      capsule(pA, pK, w1 + OUTW * 1.8, INK_HALO); capsule(pK, pF, w2 + OUTW * 1.8, INK_HALO);
      capsule(pA, pK, w1 + OUTW, INK_LINE); capsule(pK, pF, w2 + OUTW, INK_LINE);
    }
    ctx.beginPath(); foot.forEach(ellPath); inkStroke(OUTW * 0.85);
    if (!L.tuck) {
      if (thigh) { ctx.beginPath(); ellPath(thigh); ctx.fillStyle = col; ctx.fill(); }
      capsule(pA, pK, w1, col); capsule(pK, pF, w2, col);
      if (thigh && !L.far) ellipse(thigh.x - thigh.rx * 0.2, thigh.y - thigh.ry * 0.25, thigh.rx * 0.28, thigh.ry * 0.17, SPOT);
    }
    ctx.beginPath(); foot.forEach(ellPath); ctx.fillStyle = col; ctx.fill();
    // pieghette tra i ditini
    for (var i = 0; i < 3; i++) {
      var a = toes[i], b = toes[i + 1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.05 * r) line([mx, my - 0.04 * r * pw, mx, my + 0.02 * r * pw], 1.1, 'rgba(43,59,97,.5)');
    }
  }
  // coda a pagaia: nastro verticale lungo la spina dorsale, sopra azzurra con macchie, sotto pesca-rosa
  function drawTail(sp) {
    var N = sp.length - 1, top = [], bot = [], mid = [], Us = [], r = VY.r, i, T0, TN;
    for (i = 0; i <= N; i++) {
      var a = sp[Math.max(0, i - 1)], b = sp[Math.min(N, i + 1)], T = nrm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      var U = [T[0] * T[1], -1 + T[1] * T[1], T[1] * T[2]], um = Math.hypot(U[0], U[1], U[2]);
      U = um < 0.08 ? [0, -1, 0] : [U[0] / um, U[1] / um, U[2] / um];
      if (i === 0) T0 = T;
      if (i === N) TN = T;
      Us.push(U);
      top.push(pj(add3(sp[i], mul3(U, TAIL_HU[i])))); bot.push(pj(add3(sp[i], mul3(U, -TAIL_HL[i]))));
      mid.push(pj(add3(sp[i], mul3(U, -TAIL_HL[i] * 0.08))));
    }
    var tip = pj(add3(sp[N], mul3(TN, 0.3))), base = pj(add3(sp[0], mul3(T0, -0.22)));
    var loop = top.concat([tip], bot.slice().reverse());
    function outline() {
      ctx.beginPath(); ctx.moveTo(bot[0][0], bot[0][1]);
      ctx.quadraticCurveTo(base[0], base[1], top[0][0], top[0][1]);
      smoothThrough(loop, 1);
      ctx.closePath();
    }
    outline(); inkStroke(OUTW);
    var ys = loop.map(function (q) { return q[1]; });
    ctx.fillStyle = lin(0, Math.min.apply(null, ys), 0, Math.max.apply(null, ys), BLUE_L, BLUE); ctx.fill();
    ctx.save(); ctx.clip();
    // fascia inferiore pesca → rosa
    ctx.beginPath(); ctx.moveTo(mid[0][0], mid[0][1]);
    smoothThrough(mid.concat([tip], bot.slice().reverse()), 1); ctx.closePath();
    var p0 = pj(sp[0]), pN = pj(sp[N]);
    ctx.fillStyle = lin(p0[0], p0[1], pN[0], pN[1], 'rgba(246,221,198,.95)', 'rgba(236,143,134,.95)'); ctx.fill();
    // bordo superiore più chiaro, macchie
    ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); smoothThrough(top.concat([tip]), 1);
    ctx.lineWidth = 0.09 * r; ctx.strokeStyle = 'rgba(214,228,248,.55)'; ctx.stroke();
    [[2, 0.1, 0.055, 0.45, SPOT], [3, 0.08, 0.05, 0.2, SPOT_L], [4, 0.11, 0.06, 0.5, SPOT], [5, 0.07, 0.045, 0.25, SPOT_L], [6, 0.06, 0.04, 0.45, SPOT]].forEach(function (s) {
      var k = s[0], q = pj(add3(sp[k], mul3(Us[k], TAIL_HU[k] * s[3]))), nx = pj(sp[Math.min(N, k + 1)]), pv = pj(sp[k - 1]);
      ctx.fillStyle = s[4]; ctx.beginPath();
      ctx.ellipse(q[0], q[1], s[1] * r, s[2] * r, Math.atan2(nx[1] - pv[1], nx[0] - pv[0]), 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  function drawBody(FT, br) {
    var hips = ell(FT, HIPS_C, HIPS_R), chest = ell(FT, CHEST_C, [CHEST_R[0], CHEST_R[1] * br, CHEST_R[2] * br]);
    function bp() { ctx.beginPath(); ellPath(hips); ellPath(chest); }
    bp(); inkStroke(OUTW);
    var t = Math.min(hips.y - hips.ry, chest.y - chest.ry), b = Math.max(hips.y + hips.ry, chest.y + chest.ry);
    ctx.fillStyle = lin(0, t, 0, b, BLUE_L, BLUE); ctx.fill();
    ctx.save(); bp(); ctx.clip();
    // pancia color crema: si vede di lato e di fronte, non da dietro
    var bn = nrm3(FT.vec([0.25, 1, 0])), ba = clamp((bn[0] * VY.s + bn[2] * VY.c + 0.3) / 0.3, 0, 1);
    if (ba > 0) {
      var be = ell(FT, BELLY_C, BELLY_R);
      ctx.globalAlpha = ba; ctx.beginPath(); ellPath(be);
      ctx.fillStyle = lin(0, be.y - be.ry, 0, be.y + be.ry, CREAM, CREAM_D); ctx.fill(); ctx.globalAlpha = 1;
    }
    spotOn(surf(FT, HIPS_C, HIPS_R, [-0.2, 0.45, 0.85]), 0.5, 0.2, 'rgba(55,80,135,.14)');
    spotOn(surf(FT, CHEST_C, CHEST_R, [0, -1, 0.35]), 0.42, 0.13, 'rgba(255,255,255,.2)');
    BODY_SPOTS.forEach(function (s) { spotOn(surf(FT, s[0] ? CHEST_C : HIPS_C, s[0] ? CHEST_R : HIPS_R, s[1]), s[2], s[3], s[4] ? SPOT_L : SPOT); });
    ctx.restore();
  }
  function drawHead(FH, c2, o) {
    var skull = ell(FH, [0, 0, 0], SKULL), muz = ell(FH, MUZ_C, MUZ_R), O = [0, 0, 0];
    function hp() { ctx.beginPath(); ellPath(skull); ellPath(muz); }
    ctx.save();
    if (o.roll) { ctx.translate(c2[0], c2[1]); ctx.rotate(o.roll); ctx.translate(-c2[0], -c2[1]); }
    hp(); inkStroke(OUTW);
    ctx.fillStyle = lin(0, skull.y - skull.ry, 0, skull.y + skull.ry * 1.1, BLUE_L, BLUE); ctx.fill();
    ctx.save(); hp(); ctx.clip();
    // mento e gola color crema (non da dietro)
    var jn = nrm3(FH.vec([0.55, 0.85, 0])), ja = clamp((jn[0] * VY.s + jn[2] * VY.c + 0.35) / 0.3, 0, 1);
    if (ja > 0) {
      var je = ell(FH, JAW_C, JAW_R);
      ctx.globalAlpha = ja; ctx.beginPath(); ellPath(je);
      ctx.fillStyle = lin(0, je.y - je.ry, 0, je.y + je.ry, CREAM, CREAM_D); ctx.fill(); ctx.globalAlpha = 1;
    }
    spotOn(surf(FH, O, SKULL, [-0.45, 0.45, 0.75]), 0.4, 0.2, 'rgba(55,80,135,.13)');
    spotOn(surf(FH, O, SKULL, [-0.45, 0.45, -0.75]), 0.4, 0.2, 'rgba(55,80,135,.13)');
    spotOn(surf(FH, O, SKULL, [0.1, -1, 0.3]), 0.42, 0.16, 'rgba(255,255,255,.24)');
    HEAD_SPOTS.forEach(function (h) { spotOn(surf(FH, O, SKULL, h), h[3], h[4], h[5] ? SPOT_L : SPOT); });
    [1, -1].forEach(function (z) { spotOn(surf(FH, O, SKULL, [0.62, 0.3, 0.66 * z]), 0.13, 0.075, o.blush ? 'rgba(236,143,134,.8)' : 'rgba(236,143,134,.42)'); });
    [-1, 1].forEach(function (z) { drawEye(surf(FH, O, SKULL, [0.85, -0.1, 0.46 * z]), 0.17 * o.bigEye, 0.215 * o.bigEye, o); });
    [-1, 1].forEach(function (z) {
      var s = surf(FH, MUZ_C, MUZ_R, [0.92, -0.3, 0.26 * z]);
      if (s.f > 0.15) { var q = pj(s.p); ellipse(q[0], q[1], 0.028 * VY.r, 0.022 * VY.r, INK); }
    });
    drawMouth(FH, o);
    ctx.restore();
    ctx.restore();
  }

  // Costruisce la posa: calcola tutti i punti, prepara le parti ordinate per profondità e restituisce
  // i punti utili (zampine, testa, cima della testa, nuca, naso) prima di disegnare.
  function rig(o) {
    VY.c = Math.cos(o.yaw); VY.s = Math.sin(o.yaw); VY.r = o.r;
    var rise = o.rise, sit = o.sit * (1 - rise), cr = o.crouch * (1 - rise), st = o.stretch, ta, pv, i;
    if (o.hang) { ta = -1.2; pv = [0, 0, 0]; }
    else if (o.curl) { ta = 0.04; pv = [-0.45, -0.4, 0]; }
    else {
      ta = -1.15 * rise - 0.4 * sit + 0.14 * cr + 0.3 * st + o.pitch;
      pv = [-0.45 + 0.06 * rise - 0.06 * sit, -0.55 + 0.04 * rise + 0.22 * sit + 0.12 * cr - 0.08 * st, 0];
    }
    if (o.wiggle) { var wg = Math.sin(frame * 0.6) * o.wiggle; pv[0] += wg * 0.025; pv[2] += wg * 0.08; ta += wg * 0.02; }
    var FT = basis(pv, ta), hc = FT.pt([HEAD_AT[0] + o.hx, HEAD_AT[1] + o.hy, 0]);
    var FH = basis(hc, ta * 0.25 + o.head, o.headYaw || 0), c2 = pj(hc), roll = o.roll;
    function rolled(p) {
      if (!roll) return p;
      var c = Math.cos(roll), s = Math.sin(roll), dx = p[0] - c2[0], dy = p[1] - c2[1];
      return [c2[0] + dx * c - dy * s, c2[1] + dx * s + dy * c];
    }
    // zampe: vicina/lontana, posteriore/anteriore. A terra seguono il passo; in piedi le anteriori diventano braccini.
    var legs = [];
    [[1, 1], [-1, 1], [1, 0], [-1, 0]].forEach(function (lg) {
      var zs = lg[0], hind = !!lg[1], j = hind ? HIP_J : SH_J, arm = 0, fp = 0;
      var A = FT.pt([j[0], j[1], zs * (hind ? 0.33 : 0.32)]), l1 = hind ? 0.3 : 0.3, l2 = hind ? 0.28 : 0.28;
      var ph = o.ph + ((hind ? zs < 0 : zs > 0) ? 0 : Math.PI);
      var F = [A[0] + (hind ? 0.02 + 0.36 * sit : 0.1 + 0.12 * sit + 0.5 * st) - Math.cos(ph) * 0.17 * o.gait, -Math.max(0, Math.sin(ph)) * 0.15 * o.gait, zs * (hind ? 0.5 + 0.12 * sit : 0.48 - 0.06 * sit)];
      if (o.hang === 'climb') F = hind ? add3(A, [0.18, 0.42 + 0.1 * Math.sin(o.ph + (zs > 0 ? 0 : Math.PI)), zs * 0.3]) : add3(A, [0.14, -0.44 + 0.12 * Math.sin(o.ph + (zs > 0 ? Math.PI : 0)), zs * 0.36]);
      else if (o.hang) F = hind ? add3(A, [0.04, 0.58, zs * 0.05]) : o.hang === 'cling' ? add3(A, [0.4, -0.34, -zs * 0.2]) : add3(A, [0.06, 0.52, zs * 0.05]);
      else if (o.curl) F = [A[0] + 0.3, -0.05, zs * 0.3];
      else if (o.swim) F = add3(A, [-0.44 + Math.sin(ph) * 0.06, 0.12, zs * 0.08]);
      else if (o.splat) F = hind ? add3(A, [0.3, 0.36, zs * 0.55]) : F;
      else if (o.pounce) F = hind ? add3(A, [-0.46, 0.24, 0]) : add3(A, [0.52, -0.06, 0]);
      else if (o.air) F = add3(A, [0.05, 0.56, zs * 0.06]);
      if (!hind && !o.hang && !o.curl && rise > 0.01) {
        var at = o.splat ? add3(A, [0.3, -0.85, zs * 0.85])
          : o.hold ? add3(A, [0.3, 0.02, -zs * 0.2])
          : o.waveArm && zs > 0 ? add3(A, [0.08 + 0.1 * Math.sin(frame * 0.4), -0.48, 0.3])
          : add3(A, [0.2, 0.3, zs * 0.02]);
        F = lerp3(F, at, rise); arm = rise;
      }
      if (o.hang && !hind) arm = 1;
      if (hind && zs > 0 && o.scratch) { F = add3(hc, [-0.42 + Math.cos(frame * 0.9) * 0.05, 0.55 + Math.sin(frame * 0.9) * 0.04, 0.5]); l1 = 0.5; l2 = 0.5; }
      if (!hind && zs > 0 && o.bat) F = lerp3(F, add3(A, [0.55, -0.28, 0.08]), o.bat);
      var s = ik(A, F, l1, l2, hind ? -1 : 1);
      if (arm) fp = Math.atan2(s.F[1] - s.K[1], s.F[0] - s.K[0]) * arm;
      else if (o.air || o.hang || o.swim) fp = Math.atan2(s.F[1] - s.K[1], s.F[0] - s.K[0]) * 0.5;
      if (o.curl && hind) return;
      legs.push({ A: A, K: s.K, F: s.F, hind: hind, far: zs < 0, arm: arm, fp: fp, ta: ta, tuck: o.curl, zs: zs });
    });
    // spina della coda
    var sp = [], base = FT.pt(TAIL_AT), N = 7, q, d;
    sp.push(base);
    if (o.curl) {
      var PSI = [1.9, 1.5, 0.9, 0.35, 0.1, 0, -0.1];
      sp[0] = [base[0], -0.26, base[2]]; q = sp[0];
      for (i = 0; i < N; i++) { q = [q[0] + Math.cos(PSI[i]) * 0.3, -0.24, q[2] + Math.sin(PSI[i]) * 0.3]; sp.push(q); }
    } else {
      var ground = !o.hang && !o.air && !o.swim;
      d = o.hang ? -1.35 : 0.22 + ta * 0.75 + o.tlift; q = base;
      for (i = 1; i <= N; i++) {
        var t = i / N;
        d += (o.hang ? 0.08 : 0.02 + 0.3 * t * t) + o.tbend;
        var dd = clamp(d + o.wag * Math.sin(o.tph - i * 0.55) * t, -1.4, 1.42);
        var np = [q[0] - Math.cos(dd) * 0.27, q[1] - Math.sin(dd) * 0.27, 0];
        if (ground && np[1] > -0.2) { np[1] = -0.2; d = Math.max(d, 0.06); }
        np[2] = base[2] + o.sway * Math.sin(o.tph * 0.8 - i * 0.5) * t * 0.7 + o.tz * t * t;
        sp.push(np); q = np;
      }
      var sside = sit * Math.abs(VY.s); // la coda gira di lato a terra solo vista di fronte o di spalle
      if (sside > 0.01 && !o.hang) {
        var PS = [2.75, 2.45, 2.15, 1.9, 1.7, 1.55, 1.45], sq = [base[0], Math.max(base[1], -0.3), base[2]];
        for (i = 1; i <= N; i++) {
          sq = [sq[0] + Math.cos(PS[i - 1]) * 0.27, -0.22 - 0.04 * i / N, sq[2] + Math.sin(PS[i - 1]) * 0.27];
          sp[i] = lerp3(sp[i], [sq[0], sq[1], sq[2] + o.sway * Math.sin(o.tph * 0.8 - i * 0.5) * 0.15 * i / N], sside);
        }
      }
    }
    var parts = [], bodyC = FT.pt([0.35, -0.14, 0]), br = 1 + Math.sin(frame * 0.06) * 0.018;
    parts.push({ d: depth(bodyC), p: 2, f: function () { drawBody(FT, br); } });
    parts.push({ d: depth(sp[2]) - 0.08, p: 1, f: function () { drawTail(sp); } });
    legs.forEach(function (L) { parts.push({ d: depth(L.A) + (L.hind ? 0 : 0.005), p: 3, f: function () { drawLeg(L); } }); });
    parts.push({ d: depth(hc), p: 5, f: function () { drawHead(FH, c2, o); } });
    // branchie: si muovono verso "l'alto" della testa, così il battito è simmetrico in ogni vista
    var upv = pj(FH.vec([0, -1, 0]));
    [-1, 1].forEach(function (zs) {
      GILLS.forEach(function (g, gi) {
        var sb = surf(FH, [0, 0, 0], SKULL, [g.b[0], g.b[1], g.b[2] * zs]), dir = nrm3(FH.vec([g.d[0], g.d[1], g.d[2] * zs]));
        var b2 = rolled(pj(sb.p)), t2 = rolled(pj(add3(sb.p, mul3(dir, g.L))));
        var ux = t2[0] - b2[0], uy = t2[1] - b2[1], lm = Math.hypot(ux, uy) || 1, px = -uy / lm, py = ux / lm;
        var upSide = px * upv[0] + py * upv[1] >= 0 ? 1 : -1;
        var fl = (o.flap * (gi % 2 ? 1 : -1) + Math.sin(frame * 0.07 + gi * 1.7 + zs) * 0.05) * lm * upSide;
        var t3 = [t2[0] + px * fl, t2[1] + py * fl], shade = zs < 0 && VY.c > 0.35;
        parts.push({ d: depth(sb.p), p: 4, f: function () { plume(b2[0], b2[1], t3[0], t3[1], g.w * VY.r, g.bend * upSide, shade); } });
      });
    });
    parts.sort(function (a, b) { return a.d + a.p * 1e-3 - (b.d + b.p * 1e-3); });
    var nf = legs.filter(function (L) { return !L.hind; });
    return {
      draw: function () { parts.forEach(function (p) { p.f(); }); },
      hands: nf.length === 2 ? pj(lerp3(nf[0].F, nf[1].F, 0.5)) : c2,
      head: c2, top: rolled(pj(FH.pt([0.1, -0.75, 0]))), nape: pj(FH.pt([-0.28, -0.6, 0])),
      nose: rolled(pj(FH.pt([0.92, 0.12, 0]))), eye: rolled(pj(FH.pt([0.55, -0.08, 0])))
    };
  }
  // da coordinate locali già proiettate (rivolte a destra) a coordinate di pagina
  function toWorld(lx, ly) {
    var d = M.drawn;
    if (!d) return [M.x, M.y];
    var px = lx * d.f * d.sx, py = ly * d.sy - d.bob, c = Math.cos(d.ang), s = Math.sin(d.ang);
    return [M.x + px * c - py * s, M.y + px * s + py * c];
  }
  function handsWorld() {
    var d = M.drawn;
    if (!d || d.hang || !d.hands) return [M.x, M.y - R * scale()];
    return toWorld(d.hands[0], d.hands[1]);
  }
  // lettera tenuta tra le zampine: disegnata dritta (mai specchiata), con le manine sopra
  function heldLetter(hw, r) {
    var e = M.eat, k = Math.max(0, 1 - e.bites / 3);
    if (k <= 0) return;
    ctx.save();
    ctx.translate(hw[0], hw[1] - r * 0.12); ctx.scale(k, k);
    ctx.font = e.font; ctx.fillStyle = e.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e.ch, 0, 0);
    ctx.restore();
    [-1, 1].forEach(function (sd) {
      ctx.beginPath(); ctx.ellipse(hw[0] + sd * r * 0.16, hw[1] - r * 0.06, r * 0.1, r * 0.085, 0, 0, Math.PI * 2);
      ctx.fillStyle = BLUE; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.stroke();
    });
  }
  // dita che pizzicano la nuca quando lo prendi per la collottola
  function pinch(r) {
    var SKIN = '#f2c9a8';
    ctx.lineWidth = 1.8; ctx.strokeStyle = '#8a5a44';
    ctx.beginPath(); ctx.ellipse(-0.14 * r, -0.1 * r, 0.1 * r, 0.2 * r, 0.5, 0, Math.PI * 2); ctx.fillStyle = SKIN; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0.13 * r, -0.08 * r, 0.11 * r, 0.21 * r, -0.45, 0, Math.PI * 2); ctx.fillStyle = SKIN; ctx.fill(); ctx.stroke();
    line([0.1 * r, -0.22 * r, 0.16 * r, -0.16 * r], 1.2, '#b98a70');
  }

  function drawMascot() {
    var s = scale(), r = R * s * (M.zs || 1), f = M.face, vert = isVert();
    var ang = vert ? (norm() > 0 ? Math.PI / 2 : -Math.PI / 2) : (M.zang || 0);
    var sx = (1 + 0.15 * M.squash) * (M.zsx || 1), sy = (1 - 0.15 * M.squash) * (M.zsy || 1), bob = 0, tilt = 0;
    var o = {
      r: r, yaw: M.vb * Math.PI / 2 + (1 - M.vb) * M.yb, rise: M.rise, sit: M.sitA, crouch: M.crA, stretch: 0, curl: 0, hang: 0,
      swim: 0, air: 0, pounce: 0, gait: 0, ph: M.walkPh, pitch: 0, head: 0, hx: 0, hy: 0, roll: 0, hold: false, waveArm: false,
      bat: 0, scratch: 0, wiggle: 0, hangYaw: null, headYaw: 0, wag: 0.1, sway: 0.12, tph: frame * 0.05, tlift: 0, tbend: 0, tz: 0.5 * Math.max(0, Math.sin(M.yb)) * (1 - M.vb),
      flap: Math.sin(frame * 0.08) * 0.06, eyes: M.blinkT > 0 ? 'shut' : 'open', open: 0, bigEye: 1, gx: 0, gy: 0, blush: M.blush > 0
    };
    sy *= 1 + 0.012 * Math.sin(frame * 0.05);
    var talking = M.sayT > 0 && frame - M.sayStart < M.say.length / 0.9;
    if (talking) o.open = 0.25 + Math.abs(Math.sin(frame * 0.45)) * 0.45;
    var ph = M.walkPh, lookViewer = false;
    switch (M.mode) {
      case 'walk': case 'vwalk':
        o.gait = 1; bob = Math.abs(Math.sin(ph)) * 1.3; o.tph = ph; o.wag = 0.18; o.sway = 0.18; o.head = Math.sin(ph * 2) * 0.04; tilt = Math.sin(ph) * 0.02; break;
      case 'chase':
        if (M.chaseRun) { o.gait = 1.25; bob = Math.abs(Math.sin(ph)) * 2.2; o.tph = ph; o.wag = 0.25; }
        o.bigEye = 1.15; o.open = Math.max(o.open, 0.15); o.sway = 0.3; o.tph = frame * 0.2;
        if (M.batT > 0) { o.bat = Math.sin(Math.PI * clamp(1 - M.batT / 18, 0, 1)); o.open = 0.5; }
        break;
      case 'stalk':
        o.wiggle = M.hunt && M.hunt.t < 40 ? 1 : 0.3; o.bigEye = 1.22; o.head = -0.14; o.wag = 0.04; o.sway = 0.4; o.tph = frame * 0.28; o.tlift = -0.3;
        break;
      case 'fall':
        o.air = 1; o.open = Math.max(o.open, 0.35); o.bigEye = 1.15; o.flap = 0.25; o.tlift = 0.25;
        if (M.pounce) { o.pounce = 1; o.pitch = clamp(M.vy * 0.05, -0.35, 0.35); o.open = 0.6; o.bigEye = 1.25; o.tlift = -0.25; o.flap = 0.35; }
        if (M.ballJump) { o.pounce = 1; o.pitch = clamp(M.vy * 0.04, -0.45, 0.3); o.open = 0.7; o.bigEye = 1.3; o.flap = 0.35; }
        if (M.zoom && M.rot) { o.eyes = 'happy'; o.open = 0.6; }
        break;
      case 'zoom': {
        var z = M.zoom;
        if (!z) break;
        o.bigEye = 1.15; o.flap = -0.15 + Math.sin(frame * 0.5) * 0.08; o.wag = 0.3; o.sway = 0.35; o.tph = frame * 0.5;
        if (z.sub === 'start') { o.wiggle = 1; o.bigEye = 1.3; o.tlift = -0.3; o.head = -0.1; }
        else if (z.sub === 'run' || z.sub === 'wallrun') { o.gait = 1.6; bob = Math.abs(Math.sin(M.walkPh)) * 3; o.tph = M.walkPh; o.tlift = 0.15; o.pitch = 0.08; o.crouch = 0.35; o.open = 0.3 + Math.abs(Math.sin(frame * 0.3)) * 0.2; }
        else if (z.sub === 'skid') { o.gait = 0.3; o.pitch = -0.22; o.crouch = 0.5; o.open = 0.4; o.bigEye = 1.3; }
        else if (z.sub === 'leapwall') { o.pounce = 1; o.air = 1; o.open = 0.5; o.bigEye = 1.25; o.flap = 0.3; }
        else if (z.sub === 'bonk') { o.pounce = 1; o.air = 1; o.eyes = 'shut'; o.open = 0.4; o.blush = true; o.flap = 0.35; }
        else if (z.sub === 'trip') { o.air = 1; o.eyes = 'shut'; o.open = 0.5; tilt = M.zrot || 0; o.flap = 0.3; }
        else if (z.sub === 'sprawl') { o.crouch = 1; o.swim = 1; o.eyes = 'shut'; o.open = 0.2; o.head = 0.2; o.wag = 0.05; o.sway = 0.1; }
        else if (z.sub === 'dizzy') { o.eyes = Math.floor(frame / 24) % 2 ? 'half' : 'shut'; tilt = Math.sin(frame * 0.1) * 0.1; o.roll = Math.sin(frame * 0.13) * 0.2; o.open = 0.2; o.wag = 0.05; }
        else if (z.sub === 'pant') { o.eyes = 'happy'; o.open = 0.45 + Math.abs(Math.sin(frame * 0.35)) * 0.3; o.flap = Math.sin(frame * 0.35) * 0.2; o.yaw = 1.0; lookViewer = true; }
        else if (z.sub === 'glass') { // si gira verso di te, salta e si spiaccica sul vetro
          var gt = z.t;
          o.yaw = mix(0.18, Math.PI / 2, clamp(gt / 18, 0, 1)); lookViewer = true;
          if (gt < 22) { o.crouch = 1; o.wiggle = 0.8; o.bigEye = 1.3; }
          else if (gt < 52) { o.rise = clamp((gt - 22) / 18, 0, 1); o.splat = 1; o.open = 0.6; o.bigEye = 1.3; o.flap = 0.3; }
          else if (gt < 196) {
            o.rise = 1; o.splat = 1; sx *= 1.18; sy *= 0.92; o.blush = true; o.flap = 0.22;
            o.eyes = gt < 82 ? 'shut' : Math.floor(gt / 26) % 3 === 0 ? 'shut' : 'open'; o.open = gt < 82 ? 0.55 : 0.3;
            if (gt > 120) { o.eyes = 'open'; o.bigEye = 1.25; o.open = 0.5; }
          } else { o.rise = 1 - clamp((gt - 196) / 20, 0, 1); o.eyes = 'shut'; o.air = 1; }
        }
        break;
      }
      case 'ball': {
        var bg = M.ball;
        if (!bg) break;
        o.wag = 0.3; o.sway = 0.35; o.tph = frame * 0.3; o.bigEye = 1.15;
        if (bg.run) { o.gait = 1.3; bob = Math.abs(Math.sin(M.walkPh)) * 2.2; o.tph = M.walkPh; o.crouch = 0.25; }
        if (bg.sub === 'watch') { o.wiggle = 0.5; o.bigEye = 1.28; o.head = -0.15; o.tlift = -0.2; o.sway = 0.45; }
        else if (bg.sub === 'hold') { o.open = 0.2; o.wag = 0.4; if (Math.floor(frame / 40) % 3 === 0) o.eyes = 'happy'; }
        else if (bg.sub === 'toss' || bg.sub === 'tosswait') { o.head = -0.42; o.hold = !!bg.inHands; o.bigEye = 1.2; o.open = 0.3; }
        else if (bg.sub === 'bat') { o.crouch = 0.5; o.bat = bg.t > 22 && bg.t < 40 ? Math.sin(Math.PI * (bg.t - 22) / 18) : 0; o.bigEye = 1.25; }
        else if (bg.sub === 'throw') { o.hold = !!bg.inHands; o.head = -0.2; o.yaw = 0.7; lookViewer = true; }
        else if (bg.sub === 'wait') { o.wag = 0.5; o.sway = 0.55; o.tph = frame * 0.35; o.bigEye = 1.15; o.yaw = 0.9; }
        else if (bg.sub === 'rest') { o.curl = 1; o.eyes = 'happy'; o.wag = 0.08; o.sway = 0.1; o.open = 0; }
        break;
      }
      case 'drag':
        o.hang = 'scruff'; o.eyes = Math.abs(M.swingV) > 0.05 || (M.drag && M.drag.age < 25) ? 'open' : 'half';
        o.open = o.eyes === 'open' ? 0.45 : 0; o.wag = 0.2; o.tph = frame * 0.3; o.flap = -0.15 + Math.sin(frame * 0.12) * 0.05; break;
      case 'hide':
        if (M.covWalk) { o.gait = 0.8; o.tph = M.walkPh; o.wag = 0.15; bob = Math.abs(Math.sin(M.walkPh)); }
        o.head = 0.15 + Math.sin(frame * 0.05) * 0.05; o.yaw = 0.15; break;
      case 'peekSide':
        o.yaw = mix(0.2, 1.05, M.peek); tilt = M.face * 0.2 * M.peek; o.roll = -0.16 * M.peek; o.bigEye = 1 + 0.15 * M.peek; o.sway = 0.25; lookViewer = true; break;
      case 'peekTop':
        o.hang = 'cling'; o.hangYaw = Math.PI / 2; o.bigEye = 1.15; o.gx = Math.sin(frame * 0.035) * 0.22; o.gy = 0.02;
        o.flap = Math.sin(frame * 0.06) * 0.08; o.wag = 0.1; o.sway = 0.2; lookViewer = true; break;
      case 'climb':
        o.hang = 'climb'; o.hangYaw = -Math.PI / 2 + Math.sin(frame * 0.02) * 0.08; o.headYaw = M.climbYaw; o.ph = M.walkPh * 2; o.sway = 0.3; o.tph = frame * 0.1; o.wag = 0.1;
        if (M.climbYaw > 1.1 && Math.floor(frame / 60) % 3 === 0) o.eyes = 'happy';
        lookViewer = true; break;
      case 'barEat':
        o.hang = 'cling'; o.open = Math.abs(Math.sin(M.t * 0.45)) * 0.9; o.eyes = Math.sin(M.t * 0.45) > 0.6 ? 'happy' : 'open';
        o.wag = 0.3; o.sway = 0.35; o.tph = frame * 0.25; o.flap = 0.2 + Math.sin(frame * 0.3) * 0.1; o.blush = true; lookViewer = true; break;
      case 'barLaser': {
        var charging = M.t < 55;
        o.head = -0.42; o.bigEye = charging ? 1 : 1.25; o.eyes = charging && M.t > 10 ? 'shut' : 'open'; o.open = charging ? 0.15 : 0.9;
        o.flap = charging ? Math.sin(frame * 0.9) * 0.12 : 0.3; o.sway = 0.3; o.tph = frame * 0.3; o.gy = -0.25;
        if (charging) tilt = Math.sin(frame * 1.7) * 0.03 * (M.t / 55);
        lookViewer = true; break;
      }
      case 'smash':
        o.hang = 'cling'; o.bigEye = 1.12; o.open = wp.shake > 0 ? 0.6 : 0.15; o.eyes = wp.shake > 0 ? 'shut' : 'open';
        o.wag = 0.3; o.sway = 0.4; o.tph = frame * 0.3; o.flap = 0.25 + Math.sin(frame * 0.4) * 0.1; lookViewer = true; break;
      case 'cling':
        o.hang = 'cling'; o.eyes = Math.floor(frame / 50) % 4 === 0 ? 'happy' : 'open'; o.open = 0.45; o.bigEye = 1.1;
        o.wag = 0.25; o.sway = 0.35; o.tph = frame * 0.2; o.flap = 0.2 + Math.sin(frame * 0.3) * 0.1; lookViewer = true; break;
      case 'eat':
        if (M.eat) {
          var et = M.eat.t;
          o.hold = et >= 16 && M.eat.bites < 3;
          if (et > 26 && et < 80) { var ph2 = ((et - 26) % 18) / 18; o.open = ph2 < 0.5 ? ph2 * 1.6 : (1 - ph2) * 1.6; o.head = 0.2 * o.open; }
          o.eyes = et > 30 && et < 80 && Math.floor(et / 9) % 3 === 0 ? 'happy' : o.eyes;
          o.flap = Math.sin(frame * 0.3) * 0.12; o.wag = 0.2; o.tph = frame * 0.2;
        }
        break;
      case 'dance': tilt = Math.sin(frame * 0.22) * 0.25; bob = Math.abs(Math.sin(frame * 0.22)) * 6; o.wag = 0.35; o.sway = 0.4; o.tph = frame * 0.44; o.flap = Math.sin(frame * 0.44) * 0.2; o.eyes = 'happy'; o.open = 0.5; o.roll = Math.sin(frame * 0.22) * 0.12; break;
      case 'sleep': o.eyes = 'shut'; o.open = 0; sy *= 0.9; o.curl = 1; o.flap = Math.sin(frame * 0.03) * 0.04; o.head = 0.28; o.hx = -0.08; o.hy = 0.42; o.wag = 0; o.sway = 0; break;
      case 'happy': o.eyes = 'happy'; o.open = 0.7; bob = Math.abs(Math.sin(frame * 0.3)) * 4; o.flap = Math.sin(frame * 0.5) * 0.25; o.wag = 0.3; o.sway = 0.35; o.tph = frame * 0.3; o.waveArm = M.wave; lookViewer = true; break;
      case 'curious': o.head = -0.12; o.roll = -0.28; o.bigEye = 1.18; o.flap = 0.12; break;
      case 'stand': o.flap = Math.sin(frame * 0.1) * 0.1; o.head = Math.sin(frame * 0.03) * 0.15; o.roll = Math.sin(frame * 0.025) * 0.08; break;
      case 'yawn': var yv = Math.sin(Math.PI * (1 - M.t / 90)); o.head = -0.28 * yv; o.open = 0.9 * yv; if (yv > 0.3) o.eyes = 'shut'; break;
      case 'wag': o.sway = 0.55; o.wag = 0.2; o.tph = frame * 0.35; break;
      case 'front': o.flap = Math.sin(frame * 0.07) * 0.08; if (M.t < 60 && M.t > 30) o.eyes = 'happy'; lookViewer = true; break;
      case 'stretch': {
        var sp3 = Math.sin(Math.PI * (1 - M.t / 110));
        o.stretch = sp3; o.head = -0.3 * sp3; o.open = 0.7 * Math.max(0, sp3 - 0.3); o.eyes = sp3 > 0.5 ? 'shut' : o.eyes; o.tlift = 0.3 * sp3;
        break;
      }
      case 'scratch': o.scratch = 1; o.head = 0.25; o.roll = 0.22; o.eyes = 'happy'; o.flap = Math.sin(frame * 0.9) * 0.1; break;
      case 'sniffUp':
        o.head = -0.3 + Math.sin(frame * 0.06) * 0.22 + Math.sin(frame * 1.6) * 0.025;
        o.eyes = Math.floor(frame / 16) % 3 === 0 ? 'shut' : 'open';
        o.open = Math.abs(Math.sin(frame * 1.6)) * 0.08; o.flap = Math.sin(frame * 0.12) * 0.15; tilt = Math.sin(frame * 0.06) * 0.04;
        break;
      case 'swim': {
        // corpo allungato che segue la direzione, coda che ondeggia, zampe raccolte, branchie all'indietro
        var sv = Math.hypot(M.svx || 0, M.svy || 0);
        tilt = clamp((M.svy || 0) * 0.35, -0.6, 0.6) * f;
        o.swim = 1; o.tph = M.walkPh * 2; o.wag = 0.3 + sv * 0.12; o.sway = 0.35; o.tlift = -0.3; o.tbend = -0.05;
        o.flap = 0.25 + Math.sin(M.walkPh * 2 + 1) * 0.12; o.head = Math.sin(M.walkPh * 2) * 0.05;
        if (M.swy < waterTop() + R * 1.2) o.open = 0.15; // a galla prende aria
        break;
      }
      case 'watch': o.head = -0.22 + Math.sin(frame * 0.02) * 0.05; o.flap = Math.sin(frame * 0.05) * 0.06; o.sway = 0.2 + (Math.sin(frame * 0.013) > 0.8 ? 0.3 : 0); o.tph = frame * 0.08; break;
      case 'sniff': o.head = 0.5 + Math.sin(frame * 0.6) * 0.05; o.ph = frame * 0.1; o.gait = 0.3; o.sway = 0.25; o.tph = frame * 0.15; break;
      case 'shake': tilt = Math.sin(frame * 1.3) * 0.22; o.flap = Math.sin(frame * 1.3) * 0.35; o.wag = 0.4; o.sway = 0.5; o.tph = frame * 1.3; o.eyes = 'shut'; o.open = 0.2; o.roll = Math.sin(frame * 1.3) * 0.15; break;
      case 'turn': o.flap = 0.1; o.sway = 0.3; break;
      case 'bye': o.eyes = 'happy'; o.open = 0.4; o.flap = Math.sin(frame * 0.5) * 0.25; lookViewer = true; break;
      case 'fight': {
        if (!F) break;
        var fn = F.n, at = fn.act, fp = fn.actT;
        if (fn.climb) { o.gait = 1; o.ph = M.walkPh; bob = Math.abs(Math.sin(M.walkPh)) * 1.3; o.tph = M.walkPh; o.wag = 0.18; o.sway = 0.18; o.bigEye = 1.1; if (fn.hurt > 0) o.eyes = 'shut'; break; }
        // in guardia: acquattato, coda alta, branchie tese
        o.yaw = 0.18; o.bigEye = 1.12; o.crouch = 0.35; o.rise = fn.rise; o.flap = 0.14 + Math.sin(frame * 0.2) * 0.08;
        o.wag = 0.25; o.sway = 0.3; o.tph = frame * 0.25; o.tlift = -0.15; o.head = -0.06;
        if (fn.walk) { o.gait = 1.2; o.ph = M.walkPh; bob = Math.abs(Math.sin(M.walkPh)) * 2; o.tph = M.walkPh; }
        if (fn.air) { o.air = 1; o.crouch = 0; o.open = Math.max(o.open, 0.3); o.tlift = 0.2; }
        if (at === 'bite') { if (fp < 8) { o.crouch = 1; o.wiggle = 0.6; } else { o.pounce = fn.air ? 1 : 0; o.open = fp < 22 ? 0.95 : 0.3; o.head = -0.12; } }
        else if (at === 'tail') { o.yaw = 0.18 + clamp(fp / 34, 0, 1) * Math.PI * 2; o.wag = 0.6; o.sway = 0.7; o.tph = frame * 0.6; o.tlift = 0.25; o.eyes = 'shut'; o.crouch = 0.2; }
        else if (at === 'pounce') {
          if (!fn.air) { o.crouch = 1; o.wiggle = 1; o.bigEye = 1.25; o.tlift = -0.3; }
          else { o.pounce = 1; o.pitch = clamp(fn.vy * 0.05, -0.35, 0.35); o.open = 0.7; o.bigEye = 1.25; o.tlift = -0.25; o.flap = 0.35; }
        }
        else if (at === 'water') { o.crouch = 0; o.open = fp < 12 ? 0.05 : 0.85; o.head = -0.08; o.bigEye = fp < 12 ? 1 : 1.2; if (fp < 12) o.eyes = 'shut'; o.flap = 0.3; }
        else if (at === 'bubble') { o.open = Math.max(0.05, Math.sin(fp * 0.5)) * 0.7; o.head = -0.05; }
        else if (at === 'laser') {
          var chg = fp < 45;
          o.crouch = 0; o.head = -0.2; o.eyes = chg && fp > 8 ? 'shut' : 'open'; o.open = chg ? 0.12 : 0.9; o.bigEye = chg ? 1 : 1.3;
          o.flap = chg ? Math.sin(frame * 0.9) * 0.15 : 0.35; if (chg) tilt = Math.sin(frame * 1.7) * 0.03 * fp / 45;
        }
        else if (at === 'win') { o.eyes = 'happy'; o.open = 0.7; o.crouch = 0; o.waveArm = true; o.yaw = 0.9; o.flap = Math.sin(frame * 0.5) * 0.25; o.wag = 0.35; lookViewer = true; }
        else if (at === 'ko') { o.curl = 1; o.eyes = 'shut'; o.open = 0.3; o.wag = 0; o.sway = 0; o.flap = 0; o.head = 0.28; o.hx = -0.08; o.hy = 0.42; o.crouch = 0; o.rise = 0; }
        if (fn.hurt > 0 && at !== 'ko') { o.eyes = 'shut'; o.open = 0.4; tilt = -0.28 * fn.hurt / 18; o.flap = -0.2; o.crouch = 0.1; }
        if (F.phase === 'enter' || F.phase === 'ready') { o.bigEye = 1.2; o.flap = 0.25 + Math.sin(frame * 0.3) * 0.08; }
        break;
      }
    }
    if (M.mode === 'idle' && !vert && Math.sin(frame * 0.013) > 0.97) o.eyes = 'happy';

    if (o.hang) {
      // appeso: per la collottola (vista di fronte) o aggrappato al puntatore con le zampine (di 3/4)
      o.yaw = o.hangYaw != null ? o.hangYaw : o.hang === 'scruff' ? Math.PI / 2 : 0.55;
      var Rh = rig(o), an = o.hang === 'scruff' ? Rh.nape : Rh.hands;
      M.drawn = { ang: 0, f: f, sx: 1, sy: 1, bob: 0, r: r, hang: true };
      ctx.save();
      ctx.translate(M.x, M.y); ctx.rotate(M.swing);
      ctx.save(); ctx.scale(f, 1); ctx.translate(-an[0], -an[1]);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      Rh.draw();
      ctx.restore();
      if (o.hang === 'scruff') pinch(r);
      ctx.restore();
      return [M.x, M.y - r * 0.4];
    }

    var Rg = rig(o);
    M.drawn = { ang: ang, f: f, sx: sx, sy: sy, bob: bob, r: r, hands: Rg.hands, top: Rg.top, nose: Rg.nose };
    // direzione dello sguardo (le pupille si spostano verso quello che guarda)
    var lx = null, ly = null;
    if (M.eat && M.eat.t < 16) { lx = M.eat.x0; ly = M.eat.y0; }
    else if (M.eat) { var hw = handsWorld(); lx = hw[0]; ly = hw[1]; }
    else if ((M.mode === 'stalk' || M.mode === 'chase' || M.mode === 'fall') && M.hunt) {
      if (M.hunt.kind === 'mouse' && mouse) { lx = mouse.cx + scrollX; ly = mouse.cy + scrollY; }
      else if (M.toy) { lx = M.toy.x; ly = M.toy.y - 6; }
      else if (M.hunt.x != null) { lx = M.hunt.x; ly = M.hunt.y; }
    } else if (M.mode === 'fight' && F && !F.s.gone) { lx = F.s.x; ly = F.s.y - 45 * SK; }
    else if (B && B.held !== 'nimblu' && (M.mode === 'ball' || B.held === 'user' || Math.abs(B.vx) + Math.abs(B.vy) > 1.5)) { lx = B.x; ly = B.y; }
    else if (M.mode === 'watch' && M.video) { var rv = rectOf(M.video); if (rv) { lx = (rv.l + rv.r) / 2; ly = (rv.t + rv.b) / 2; } }
    else if (!lookViewer && mouse && performance.now() - mouse.at < 4000) { lx = mouse.cx + scrollX; ly = mouse.cy + scrollY; }
    if (lx != null) {
      var ew = toWorld(Rg.eye[0], Rg.eye[1]), vx = lx - ew[0], vy = ly - ew[1], c = Math.cos(-ang), sn = Math.sin(-ang);
      var lvx = (vx * c - vy * sn) * f, lvy = vx * sn + vy * c, lm = Math.hypot(lvx, lvy) || 1;
      o.gx = lvx / lm * 0.24; o.gy = lvy / lm * 0.2;
    }

    // ombra a terra
    if (!vert && M.att && M.att.k !== 'water' && M.att.k !== 'cover' && !M.zang && !(M.zoom && /^(glass|leapwall|bonk)$/.test(M.zoom.sub))) {
      ctx.fillStyle = 'rgba(40,60,100,.14)';
      ctx.beginPath();
      ctx.ellipse(M.x - f * r * 0.35 * Math.cos(o.yaw), M.y - 1, r * (1.5 * Math.abs(Math.cos(o.yaw)) + 0.95 * Math.abs(Math.sin(o.yaw))), r * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(M.x, M.y); ctx.rotate(ang); ctx.translate(0, -bob);
    ctx.translate(0, -r * 0.7); ctx.rotate(tilt + M.rot); ctx.translate(0, r * 0.7);
    ctx.scale(f * sx, sy);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    Rg.draw();
    ctx.restore();

    if (o.hold && M.eat) heldLetter(handsWorld(), r);
    // lettera che vola dal testo alle zampine
    if (M.eat && M.eat.t < 16) {
      var pp = Math.min(1, M.eat.t / 16), e2 = pp * pp, hwv = handsWorld();
      ctx.save();
      ctx.translate(M.eat.x0 + (hwv[0] - M.eat.x0) * e2, M.eat.y0 + (hwv[1] - M.eat.y0) * e2 - Math.sin(pp * Math.PI) * 14);
      ctx.rotate(pp * Math.PI * 2);
      ctx.font = M.eat.font; ctx.fillStyle = M.eat.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(M.eat.ch, 0, 0);
      ctx.restore();
    }
    return toWorld(Rg.top[0], Rg.top[1] - r * 0.1);
  }
  function drawParts() {
    parts.forEach(function (q) {
      var a = Math.max(0, q.life);
      if (q.k === 'dust') ellipse(q.x, q.y, 2.5, 2.5, 'rgba(120,140,170,' + a * 0.6 + ')');
      else if (q.k === 'bub') {
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * a) + ')'; ctx.stroke();
        ellipse(q.x - q.r * 0.35, q.y - q.r * 0.35, q.r * 0.3, q.r * 0.3, 'rgba(255,255,255,' + (0.9 * a) + ')');
      } else if (q.k === 'ripple') {
        var rr = (1 - a) * 34 + 6;
        ctx.beginPath(); ctx.ellipse(q.x, q.y, rr, rr * 0.22, 0, 0, Math.PI * 2);
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * a) + ')'; ctx.stroke();
      }
      else if (q.k === 'drop') {
        ctx.globalAlpha = a;
        ellipse(q.x, q.y, 2.2, 2.8, '#9cc8f0');
        ellipse(q.x - 0.6, q.y - 0.8, 0.7, 0.7, '#fff');
        ctx.globalAlpha = 1;
      } else if (q.k === 'spark') {
        ctx.globalAlpha = a; ctx.strokeStyle = q.col; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 2, q.y - q.vy * 2); ctx.stroke(); ctx.globalAlpha = 1;
      } else if (q.k === 'smoke') {
        ellipse(q.x, q.y, q.r, q.r * 0.85, 'rgba(120,120,130,' + (0.35 * a) + ')');
      } else if (q.k === 'crumb') {
        ctx.globalAlpha = a; ctx.fillStyle = q.col || '#3c4664'; ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3); ctx.globalAlpha = 1;
      } else {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 ' + (q.grow ? 12 + (1 - a) * 10 : 18) + 'px system-ui,sans-serif';
        ctx.fillStyle = q.col;
        ctx.fillText(q.ch, q.x, q.y);
        ctx.restore();
      }
    });
  }
  // Fumetto come elemento a sé, sempre in primo piano. Con il menu aperto il testo va in cima al menu.
  // Il testo intero è già presente (la parte non ancora "scritta" è invisibile), così il fumetto non cambia misura.
  var bubbleShown = '';
  function drawBubble(anchor) {
    if (M.thinking) M.say = ['·', '· ·', '· · ·'][Math.floor(frame / 12) % 3];
    var talking = M.sayT > 0 && !!M.say;
    var said = menu.querySelector('.said');
    if (said) {
      var inMenu = talking && menuOpen;
      if (said.hidden === inMenu) said.hidden = !inMenu;
      if (inMenu && said.textContent !== '💬 ' + M.say) said.textContent = '💬 ' + M.say;
    }
    if (!talking || menuOpen) { if (bubble.style.display !== 'none') bubble.style.display = 'none'; return; }
    var n = Math.min(M.say.length, Math.floor((frame - M.sayStart) * 0.9) + 1);
    var key = M.say + '|' + n;
    if (key !== bubbleShown) {
      bubbleShown = key;
      bubble.textContent = '';
      bubble.appendChild(document.createTextNode(M.say.slice(0, n)));
      if (n < M.say.length) { var rest = document.createElement('span'); rest.className = 'rest'; rest.textContent = M.say.slice(n); bubble.appendChild(rest); }
    }
    bubble.style.display = 'block';
    bubble.style.opacity = Math.min(1, M.sayT / 15);
    var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    var ax = anchor[0] - scrollX, ay = anchor[1] - scrollY;
    // se sopra non c'è spazio va sotto il personaggio, con la punta in su
    var below = ay - bh - 14 < 6, by;
    if (below) { var hb = hitBox(); by = Math.min(H - bh - 6, hb.t + hb.h + 12); }
    else by = Math.min(ay - bh - 12, H - bh - 30);
    var bx = clamp(ax - bw / 2, 6, W - bw - 6);
    if (bubble.classList.contains('below') !== below) bubble.classList.toggle('below', below);
    bubble.style.setProperty('--tx', clamp(ax - bx, 14, bw - 14) + 'px');
    bubble.style.transform = 'translate(' + Math.round(bx) + 'px,' + Math.round(by) + 'px)';
  }
  // area cliccabile attorno al personaggio (in orizzontale o sulla parete)
  function hitBox() {
    var s = scale(), long = 3.4 * R * s, tall = 2.4 * R * s, sx = M.x - scrollX, sy = M.y - scrollY;
    if (M.mode === 'drag') return { l: sx - R * s, t: sy - 0.3 * R * s, w: 2 * R * s, h: 3.6 * R * s };
    if ((M.zs || 1) > 1.3) { var zb = R * s * M.zs; return { l: sx - zb * 1.3, t: sy - zb * 2.8, w: zb * 2.6, h: zb * 2.8 }; }
    if (M.dot) return { l: M.dot[0] - scrollX - 16, t: M.dot[1] - scrollY - 16, w: 32, h: 32 };
    if (M.att && M.att.k === 'cover' && M.att.r) {
      var ca = M.att;
      if (ca.how === 'top') return { l: sx - 1.1 * R * s, t: sy - 1.5 * R * s, w: 2.2 * R * s, h: 1.5 * R * s };
      if (ca.how === 'climb') return { l: sx - 1.1 * R * s, t: sy - 1.3 * R * s, w: 2.2 * R * s, h: 3.8 * R * s };
      if (ca.how === 'side') { var ex = (ca.side < 0 ? ca.r.l : ca.r.r) - scrollX; return { l: ca.side < 0 ? ex - 1.7 * R * s : ex, t: sy - 2.6 * R * s, w: 1.7 * R * s, h: 2.6 * R * s }; }
    }
    if (M.mode === 'cling' || M.mode === 'smash' || M.mode === 'barEat') return { l: sx - 1.3 * R * s, t: sy + 0.5 * R * s, w: 2.6 * R * s, h: 2.6 * R * s }; // lascia libera la punta del puntatore
    if (isVert()) {
      var n = norm();
      return { l: n > 0 ? sx : sx - tall, t: sy - long / 2, w: tall, h: long };
    }
    if (M.vb > 0.5 || M.rise > 0.5) return { l: sx - 1.2 * R * s, t: sy - 3 * R * s, w: 2.4 * R * s, h: 3 * R * s };
    return { l: sx - long / 2 - M.face * R * s * 0.35, t: sy - tall, w: long, h: tall };
  }
  function placeMenu() {
    var mw = 272, mh = menu.offsetHeight || 300, b = hitBox();
    var top = b.t - mh - 10;
    if (top < 8) top = b.t + b.h + 10;
    menu.style.left = clamp(b.l + b.w / 2 - mw / 2, 8, W - mw - 8) + 'px';
    menu.style.top = clamp(top, 8, H - mh - 8) + 'px';
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    var shk = Math.max((F && F.shake) || 0, M.gshake || 0);
    if (shk > 0) ctx.translate((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk);
    ctx.translate(-scrollX, -scrollY);
    drawFocus();
    drawWpCracks();
    drawParts();
    drawToy();
    var cov = coverClip();
    if (cov) {
      ctx.save(); ctx.beginPath(); ctx.rect(scrollX - 60, scrollY - 60, W + 120, H + 120);
      if (ctx.roundRect && cov.rad) ctx.roundRect(cov.l, cov.t, cov.w, cov.h, cov.rad); else ctx.rect(cov.l, cov.t, cov.w, cov.h);
      ctx.clip('evenodd');
    }
    if (F) drawFightBack();
    if (B && !B.held) drawBall();
    var blink = F && F.n.inv > 0 && M.mode === 'fight' && frame % 6 < 3;
    if (blink) ctx.globalAlpha = 0.45;
    var anchor = drawMascot();
    ctx.globalAlpha = 1;
    if (cov) ctx.restore();
    if (F) drawFightFront();
    if (B && B.held) drawBall();
    drawZoomExtras();
    drawCoverExtras();
    drawWpFx();
    drawBubble(anchor);
    ctx.restore();
    if (F) drawFightHud();
    placeFightUI();
    placeBallGrab();
    var b = hitBox();
    grab.style.left = b.l + 'px'; grab.style.top = b.t + 'px';
    grab.style.width = b.w + 'px'; grab.style.height = b.h + 'px';
    var gt = M.dot ? 'Nimblu è nascosto qui: cliccami per farlo uscire' : 'Cliccami o trascinami';
    if (grab.title !== gt) grab.title = gt;
    if (menuOpen) placeMenu();
  }

  // ---------- controllo UX e conversione ----------
  // Regole automatiche (niente IA): cose che non funzionano, che non si vedono bene, accessibilità
  // e consigli per la conversione. Ogni voce può indicare uno o più elementi della pagina.
  var ux = { list: null, at: 0, lcp: 0, cls: 0, failed: [], hinted: false, lastPoint: -99999, focus: null, focusUntil: 0, cursor: {} };
  try {
    new PerformanceObserver(function (l) { var e = l.getEntries(); if (e.length) ux.lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput) ux.cls += e.value; }); }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  function onResErr(e) { var t = e.target; if (t && t.tagName && /^(IMG|SCRIPT|LINK|VIDEO|SOURCE|IFRAME)$/.test(t.tagName)) ux.failed.push(t); }
  document.addEventListener('error', onResErr, true);

  var CTA_RE = /(contatt|prenot|acquist|compra|iscriv|richied|prova grat|scarica|registr|inizia|chiama|ordina|carrello|preventivo|abbonat|candid|scopri|book|buy|sign ?up|get started|contact|shop|order|subscribe|download|try)/i;
  var GENERIC_RE = /^(clicca qui|qui|click here|here|leggi di più|leggi tutto|scopri di più|more|read more|learn more|invia|submit|ok|vai)$/i;
  var TRUST_RE = /(recension|testimonian|dicono di noi|clienti soddisfatti|stelle|★|garanzi|certificat|pagamenti sicuri|reso gratuit|spedizione gratuit|trustpilot|reviews?|rating|premi|award)/i;

  // elementi esclusi dal controllo: i nostri, quelli dell'omino e la barra di WordPress (la vede solo chi è loggato)
  function uxOurs(el) { return el.closest('[data-mascot],[data-sm],[data-sm-dead],#wpadminbar'); }
  function visibleBox(el, cs) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    cs = cs || getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.1) return null;
    return r;
  }
  function parseColor(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    var a = [c.r, c.g, c.b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  // colore di sfondo effettivo risalendo gli antenati (null se c'è un'immagine di sfondo: non si può calcolare)
  function bgOf(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      var c = parseColor(cs.backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  function contrast(fg, bg) {
    if (fg.a < 1) fg = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    var a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  function ownText(el) {
    var t = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.data;
    return t.trim();
  }
  // nome accessibile: testo visibile, poi aria-label / aria-labelledby / title / value
  // (ogni fonte va ripulita dagli spazi prima di passare alla successiva: i bottoni con sola icona
  // hanno spesso solo "a capo" nel testo, che prima nascondeva l'aria-label)
  function label(el) {
    var by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(function (id) { var x = id && document.getElementById(id); return x ? x.textContent : ''; }).join(' ');
    var src = [el.innerText, el.textContent, el.getAttribute('aria-label'), by, el.getAttribute('title'), el.value], t = '';
    for (var i = 0; i < src.length && !t; i++) t = String(src[i] || '').trim();
    t = t.replace(/\s+/g, ' ');
    return t.length > 40 ? t.slice(0, 40) + '…' : t;
  }
  function fileName(u) { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()) || u; } catch (e) { return u; } }

  function audit() {
    var out = [];
    // ogni controllo vale w punti (quanto conta) e ne prende una parte p (0-1): di base dipende dalla gravità
    var cur = { cat: 'Altro', w: 5 };
    function chk(cat, w) { cur = { cat: cat, w: w }; }
    function add(sev, title, detail, els, p) { out.push({ sev: sev, title: title, detail: detail, els: (els || []).filter(Boolean), cat: cur.cat, w: cur.w, p: p != null ? clamp(p, 0, 1) : PTS[sev] }); }
    var all = document.body.querySelectorAll('*'), n = Math.min(all.length, 4000), vh = innerHeight, vw = innerWidth;
    var lowC = [], small = [], tiny = [], emptyBtn = [], deadLinks = [], worst = 99;
    var ctas = [], ctasFold = [], genericCta = [];
    for (var i = 0; i < n; i++) {
      var el = all[i];
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path|BR)$/.test(el.tagName) || el.ownerSVGElement || uxOurs(el)) continue;
      var cs = getComputedStyle(el), r = visibleBox(el, cs);
      if (!r) continue;
      var tag = el.tagName, txt = ownText(el), fs = parseFloat(cs.fontSize) || 16;
      if (txt.length > 1) {
        if (fs < 12 && txt.length > 3) small.push(el);
        var fg = parseColor(cs.color), bg = bgOf(el);
        if (fg && bg) {
          var cr = contrast(fg, bg), large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
          if (cr < (large ? 3 : 4.5)) { lowC.push(el); if (cr < worst) worst = cr; }
        }
      }
      var isBtn = tag === 'BUTTON' || el.getAttribute('role') === 'button' || (tag === 'INPUT' && /^(submit|button)$/.test(el.type));
      if (tag === 'A' || isBtn) {
        var lb = label(el), hasImg = el.querySelector('img[alt]:not([alt=""]),svg[aria-label],[aria-label]');
        if (!lb && !hasImg) emptyBtn.push(el);
        if (tag === 'A' && !isBtn) {
          var href = el.getAttribute('href');
          if (href === null || href === '#' || /^javascript:\s*(void|;|$)/i.test(href)) deadLinks.push(el);
        }
        var inText = tag === 'A' && el.parentElement && /^(P|LI|SPAN|TD|LABEL)$/.test(el.parentElement.tagName) && ownText(el.parentElement).length > 20;
        if (!inText && (r.width < 24 || r.height < 24)) tiny.push(el);
        var filled = parseColor(cs.backgroundColor);
        if (lb && (CTA_RE.test(lb) || (isBtn && filled && filled.a > 0.5))) {
          ctas.push(el);
          if (r.top + scrollY < vh) ctasFold.push(el);
          if (GENERIC_RE.test(lb)) genericCta.push(el);
        }
      }
    }

    // --- cose che non funzionano ---
    var broken = [].filter.call(document.images, function (im) { return im.complete && im.naturalWidth === 0 && (im.currentSrc || im.src) && !uxOurs(im); });
    ux.failed.forEach(function (t) { if (broken.indexOf(t) < 0 && t.tagName === 'IMG') broken.push(t); });
    chk('Funziona', 15); if (broken.length) add('error', broken.length === 1 ? 'Un\'immagine non si carica' : broken.length + ' immagini non si caricano', 'Al loro posto c\'è un riquadro vuoto: controlla il percorso del file (' + fileName(broken[0].currentSrc || broken[0].src) + ').', broken); else add('ok', 'Tutte le immagini si caricano', 'Nessuna immagine rotta.');
    var res = [];
    try { res = performance.getEntriesByType('resource').filter(function (e) { return e.responseStatus >= 400; }); } catch (e) {}
    chk('Funziona', 10); if (res.length) add('error', res.length === 1 ? 'Un file risponde con errore' : res.length + ' file rispondono con errore', res.slice(0, 3).map(function (e) { return fileName(e.name) + ' (' + e.responseStatus + ')'; }).join(', ') + '. Se è uno script o un foglio di stile, parte della pagina potrebbe non funzionare.'); else add('ok', 'Nessun file in errore', 'Script, fogli di stile e immagini rispondono tutti.');
    chk('Funziona', 12); if (root.scrollWidth > vw + 2) {
      var culprit = null;
      for (var j = 0; j < n; j++) { var e2 = all[j]; if (uxOurs(e2)) continue; var rr = e2.getBoundingClientRect(); if (rr.width && rr.right > vw + 2 && rr.width < vw * 1.5) culprit = e2; }
      add('error', 'La pagina scorre di lato', 'Qualcosa è più largo dello schermo (' + root.scrollWidth + ' px su ' + vw + '): su telefono si vede tagliato e ci si sposta per sbaglio.', [culprit]);
    } else add('ok', 'Niente scroll laterale', 'La pagina sta nella larghezza dello schermo.');
    var overlays = [].filter.call(n ? all : [], function (el) {
      if (uxOurs(el)) return false;
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) return false;
      var r = el.getBoundingClientRect();
      return r.width * r.height > vw * vh * 0.4;
    });
    chk('Funziona', 8); if (overlays.length) add('warn', 'Un popup o un livello copre la pagina', 'Occupa gran parte dello schermo: se appare subito, molti chiudono la pagina prima di leggerla. Meglio mostrarlo dopo un po\' o allo scroll.', overlays.slice(0, 1)); else add('ok', 'Nessun livello copre la pagina', 'Niente popup a tutto schermo all\'apertura.');
    chk('Funziona', 6); if (deadLinks.length) add('warn', deadLinks.length + (deadLinks.length === 1 ? ' link non porta' : ' link non portano') + ' da nessuna parte', 'Hanno href vuoto o "#": se non aprono niente, chi clicca pensa che il sito sia rotto. Esempio: «' + (label(deadLinks[0]) || 'senza testo') + '».', deadLinks, Math.max(0.1, 0.6 - deadLinks.length * 0.05)); else add('ok', 'I link portano da qualche parte', 'Nessun link vuoto o con "#".');
    chk('Funziona', 6); if (/lorem ipsum/i.test(document.body.innerText || '')) add('error', 'C\'è ancora testo segnaposto', 'Ho trovato "lorem ipsum": va sostituito con il testo vero prima della pubblicazione.'); else add('ok', 'Nessun testo segnaposto', 'Niente "lorem ipsum".');
    chk('Funziona', 10); if (!document.querySelector('meta[name="viewport"]')) add('error', 'Manca il meta viewport', 'Senza <meta name="viewport"> su telefono la pagina appare rimpicciolita e illeggibile.'); else add('ok', 'Pronta per il telefono', 'C\'è il meta viewport.');

    // --- cose che non si vedono bene ---
    chk('Leggibilità', 12); if (lowC.length) add('warn', lowC.length + (lowC.length === 1 ? ' testo si legge' : ' testi si leggono') + ' con fatica', 'Contrasto troppo basso con lo sfondo (il peggiore è ' + worst.toFixed(1) + ':1, servono almeno 4,5:1). Scurisci il testo o schiarisci lo sfondo.', lowC, Math.max(0.1, 0.8 - lowC.length * 0.04)); else add('ok', 'Testi ben leggibili', 'Nessun problema di contrasto tra testo e sfondo.');
    chk('Leggibilità', 6); if (small.length) add('warn', small.length + (small.length === 1 ? ' testo è troppo piccolo' : ' testi sono troppo piccoli'), 'Sotto i 12 px su telefono si legge male. Esempio: «' + label(small[0]) + '».', small, Math.max(0.1, 0.8 - small.length * 0.05)); else add('ok', 'Testi abbastanza grandi', 'Niente sotto i 12 px.');
    chk('Leggibilità', 8); if (tiny.length) add('warn', tiny.length + (tiny.length === 1 ? ' bottone o link è' : ' bottoni o link sono') + ' troppo piccoli da toccare', 'Servono almeno 24×24 px (meglio 44) per il dito. Esempio: «' + (label(tiny[0]) || tiny[0].tagName.toLowerCase()) + '».', tiny, Math.max(0.1, 0.8 - tiny.length * 0.05)); else add('ok', 'Bottoni comodi da toccare', 'Tutti almeno 24×24 px.');
    var nav = null;
    try { nav = performance.getEntriesByType('navigation')[0]; } catch (e) {}
    var loadS = nav && nav.loadEventEnd > 0 ? nav.loadEventEnd / 1000 : 0;
    chk('Velocità', 12); if (ux.lcp > 2500) add('warn', 'Il contenuto principale arriva tardi', 'L\'elemento più grande compare dopo ' + (ux.lcp / 1000).toFixed(1) + ' s (bene sotto 2,5 s): comprimi le immagini in alto e rimanda gli script.', null, ux.lcp > 4000 ? 0.1 : 0.45);
    else if (loadS > 4) add('warn', 'La pagina è lenta a caricare', 'Caricamento completo in ' + loadS.toFixed(1) + ' s: oltre i 3 secondi molti se ne vanno.'); else add('ok', ux.lcp ? 'Contenuto principale veloce' : 'Caricamento veloce', ux.lcp ? 'Compare in ' + (ux.lcp / 1000).toFixed(1) + ' s (bene sotto 2,5 s).' : loadS ? 'Pagina pronta in ' + loadS.toFixed(1) + ' s.' : 'Nessun rallentamento misurato.');
    chk('Velocità', 8); if (ux.cls > 0.1) add('warn', 'La pagina "salta" mentre carica', 'Gli elementi si spostano (CLS ' + ux.cls.toFixed(2) + ', bene sotto 0,1): dai dimensioni fisse a immagini e banner.', null, ux.cls > 0.25 ? 0.1 : 0.45); else add('ok', 'Pagina stabile mentre carica', 'CLS ' + ux.cls.toFixed(2) + ' (bene sotto 0,1).');
    var heavy = [];
    try { heavy = performance.getEntriesByType('resource').filter(function (e) { return e.initiatorType === 'img' && e.transferSize > 400000; }); } catch (e) {}
    var oversized = [].filter.call(document.images, function (im) { var r = im.getBoundingClientRect(); return im.naturalWidth > 1400 && r.width > 0 && im.naturalWidth > r.width * 2.5 && !uxOurs(im); });
    chk('Velocità', 6); if (heavy.length || oversized.length) add('tip', 'Immagini più pesanti del necessario', heavy.length ? heavy.length + ' immagini superano i 400 KB (es. ' + fileName(heavy[0].name) + '): usa WebP e dimensioni adatte.' : 'Alcune immagini sono molto più grandi di come vengono mostrate: ridimensionale per velocizzare la pagina.', oversized); else if (document.images.length) add('ok', 'Immagini leggere', 'Nessuna immagine troppo pesante.');

    // --- accessibilità ---
    var noAlt = [].filter.call(document.images, function (im) { var r = im.getBoundingClientRect(); return !im.hasAttribute('alt') && r.width > 40 && !uxOurs(im); });
    chk('Accessibilità', 10); if (noAlt.length) add('warn', noAlt.length + (noAlt.length === 1 ? ' immagine senza' : ' immagini senza') + ' testo alternativo', 'Chi usa uno screen reader non sa cosa rappresentano, e Google nemmeno: aggiungi l\'attributo alt.', noAlt, Math.max(0, 1 - noAlt.length / Math.max(1, [].filter.call(document.images, function (im) { return im.getBoundingClientRect().width > 40 && !uxOurs(im); }).length)) * 0.8); else if (document.images.length) add('ok', 'Immagini descritte', 'Tutte le immagini hanno il testo alternativo.');
    chk('Accessibilità', 8); if (emptyBtn.length) add('warn', emptyBtn.length + (emptyBtn.length === 1 ? ' bottone o link senza' : ' bottoni o link senza') + ' testo', 'Hanno solo un\'icona e nessuna etichetta: aggiungi aria-label per dire cosa fanno.', emptyBtn, Math.max(0.1, 0.6 - emptyBtn.length * 0.08)); else add('ok', 'Bottoni e link con un nome', 'Tutti hanno un testo o un\'etichetta.');
    var fields = [].filter.call(document.querySelectorAll('input,select,textarea'), function (f) { return !uxOurs(f) && !/^(hidden|submit|button|reset|image)$/.test(f.type) && visibleBox(f); });
    var unlabeled = fields.filter(function (f) { return !(f.labels && f.labels.length) && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby'); });
    chk('Accessibilità', 8); if (unlabeled.length) add('warn', unlabeled.length + (unlabeled.length === 1 ? ' campo del form senza' : ' campi del form senza') + ' etichetta', 'Usano solo il placeholder, che sparisce quando si scrive: aggiungi un <label> visibile.', unlabeled, Math.max(0, 1 - unlabeled.length / fields.length) * 0.7); else if (fields.length) add('ok', 'Campi del form con etichetta', 'Ogni campo dice cosa scriverci.');
    var h1 = [].filter.call(document.querySelectorAll('h1'), function (h) { return visibleBox(h); });
    chk('Accessibilità', 6); if (!h1.length) add('warn', 'Manca il titolo principale (H1)', 'Serve un titolo H1 che dica subito di cosa parla la pagina: aiuta chi legge, gli screen reader e la SEO.');
    else if (h1.length > 1) add('tip', 'Ci sono ' + h1.length + ' titoli H1', 'Di solito ne basta uno: gli altri possono diventare H2.', h1); else add('ok', 'C\'è un titolo principale (H1)', 'Uno solo, come deve essere.');

    // --- conversione ---
    chk('Conversione', 15); if (!ctas.length) add('warn', 'Non trovo una call to action', 'Non vedo un bottone che chieda di fare qualcosa (contattare, prenotare, acquistare...). Ogni pagina dovrebbe avere un\'azione principale chiara.', null, 0);
    else if (!ctasFold.length) add('warn', 'La call to action non si vede subito', 'Il primo bottone d\'azione («' + label(ctas[0]) + '») è sotto la prima schermata: portane uno in alto, vicino al titolo.', [ctas[0]]);
    else add('ok', 'Call to action visibile subito', '«' + label(ctasFold[0]) + '» si vede senza scorrere.', [ctasFold[0]]);
    var distinct = [];
    ctasFold.forEach(function (c) { var l = label(c).toLowerCase(); if (distinct.indexOf(l) < 0) distinct.push(l); });
    chk('Conversione', 5); if (distinct.length > 3) add('tip', distinct.length + ' azioni diverse nella prima schermata', 'Troppe scelte rallentano la decisione: metti in evidenza un\'azione principale e rendi le altre secondarie.', ctasFold); else if (ctasFold.length) add('ok', 'Un\'azione principale chiara', 'Nella prima schermata le scelte sono poche.');
    chk('Conversione', 5); if (genericCta.length) add('tip', 'Testo del bottone troppo generico', '«' + label(genericCta[0]) + '» non dice cosa succede: meglio verbo + beneficio, es. «Prenota la visita gratuita».', genericCta); else if (ctas.length) add('ok', 'Testi dei bottoni chiari', 'Dicono cosa succede cliccando.');
    chk('Conversione', 4); ctasFold.slice(0, 1).forEach(function (c) {
      var r = c.getBoundingClientRect();
      if (r.height && r.height < 40) add('tip', 'Il bottone principale è piccolo', '«' + label(c) + '» è alto ' + Math.round(r.height) + ' px: almeno 44 px lo rendono più facile da cliccare e più evidente.', [c]); else add('ok', 'Bottone principale ben visibile', 'Alto ' + Math.round(r.height) + ' px.', [c]);
    });
    if (h1.length) {
      var hr = h1[0].getBoundingClientRect();
      chk('Conversione', 6); if (hr.top + scrollY > vh) add('tip', 'Il titolo è sotto la prima schermata', 'Chi arriva deve capire in 5 secondi cosa offri: porta il titolo in alto.', [h1[0]]); else add('ok', 'Titolo visibile subito', 'Si vede senza scorrere.', [h1[0]]);
      var ht = (h1[0].innerText || '').trim();
      chk('Conversione', 3); if (ht.length > 80) add('tip', 'Titolo molto lungo', 'Il titolo ha ' + ht.length + ' caratteri: sotto i 60-70 si legge al volo. Sposta i dettagli nel sottotitolo.', [h1[0]]); else add('ok', 'Titolo conciso', ht.length + ' caratteri.');
    }
    chk('Conversione', 5); [].forEach.call(document.querySelectorAll('form'), function (f) {
      if (uxOurs(f)) return;
      var k = [].filter.call(f.querySelectorAll('input,select,textarea'), function (x) { return !/^(hidden|submit|button|reset|image|checkbox|radio)$/.test(x.type) && visibleBox(x); }).length;
      if (k > 6) add('tip', 'Form lungo (' + k + ' campi)', 'Ogni campo in più fa perdere contatti: chiedi solo l\'essenziale e il resto dopo.', [f]);
    });
    if ([].some.call(document.querySelectorAll('form'), function (f) { return !uxOurs(f) && visibleBox(f); }) && !out.some(function (f) { return /^Form lungo/.test(f.title); })) add('ok', 'Form brevi', 'Chiedono solo il necessario.');
    var body = document.body.innerText || '';
    chk('Conversione', 8); if (!TRUST_RE.test(body)) add('tip', 'Mancano segnali di fiducia', 'Non trovo recensioni, testimonianze o garanzie: la prova sociale vicino alla call to action aumenta le conversioni.', null, 0.3); else add('ok', 'Segnali di fiducia presenti', 'Ho trovato recensioni, garanzie o certificazioni.');
    chk('Conversione', 6); if (!document.querySelector('a[href^="tel:"],a[href^="mailto:"]') && !/contatt|contact/i.test(body)) add('tip', 'Contatti difficili da trovare', 'Non vedo telefono, email o una pagina contatti: rendili raggiungibili in un clic.', null, 0.3); else add('ok', 'Contatti facili da trovare', 'Telefono, email o pagina contatti a portata di clic.');
    var navLinks = [].filter.call(document.querySelectorAll('nav a, header a'), function (a) { return !uxOurs(a); });
    chk('Conversione', 3); if (navLinks.length > 9) add('tip', 'Menu con ' + navLinks.length + ' voci', 'Tante voci distraggono dall\'azione principale: raggruppale o riducile.'); else if (navLinks.length) add('ok', 'Menu essenziale', navLinks.length + ' voci.');


    var order = { error: 0, warn: 1, tip: 2, ok: 3 };
    out.sort(function (a, b) { return order[a.sev] - order[b.sev]; });
    ux.list = out; ux.at = Date.now(); ux.ctas = ctas; ux.ctasFold = ctasFold;
    return out;
  }
  function uxCount(sev) { return (ux.list || []).filter(function (f) { return f.sev === sev; }).length; }
  // Punteggio come nei report di Google: ogni controllo vale w punti e ne prende w·p; il voto è la percentuale dei punti
  // presi sul totale (anche per categoria). Contano sia i problemi sia i controlli superati.
  var PTS = { error: 0, warn: 0.35, tip: 0.7, ok: 1 };
  var CATS = {
    ux: [['Funziona', '🧰'], ['Leggibilità', '👀'], ['Velocità', '⚡'], ['Accessibilità', '♿'], ['Conversione', '🎯']],
    seo: [['Google', '🔎'], ['Titoli', '🔠'], ['Testi', '📝'], ['Immagini e link', '🖼️'], ['Tecnica', '⚙️'], ['Social e dati', '🔗']],
    a11y: [['Immagini', '🖼️'], ['Link e bottoni', '🔗'], ['Moduli', '📝'], ['Struttura', '🧭'], ['Video e frame', '🎬'], ['Tastiera', '⌨️']]
  };
  function scoreOf(list, cat) {
    var tot = 0, got = 0;
    (list || []).forEach(function (f) { if (cat && f.cat !== cat) return; tot += f.w || 0; got += (f.w || 0) * (f.p != null ? f.p : PTS[f.sev]); });
    return tot ? Math.round(100 * got / tot) : 100;
  }
  function scoreCol(sc) { return sc >= 80 ? '#2f9e6a' : sc >= 55 ? '#e08a1e' : '#d64545'; }
  // punteggi per categoria, dalla più debole
  function catScores(tab) {
    var list = tabList(tab);
    return CATS[tab].filter(function (c) { return (list || []).some(function (f) { return f.cat === c[0]; }); })
      .map(function (c) { return { name: c[0], icon: c[1], sc: scoreOf(list, c[0]) }; });
  }
  function uxScore() { return scoreOf(ux.list); }
  function tabList(tab) { return (tab === 'seo' ? seo.list : tab === 'a11y' ? a11y.list : ux.list) || []; }

  // ---------- controllo SEO ----------
  // Regole fisse (niente IA) su quello che leggono i motori di ricerca: titolo e meta description (con l'anteprima del
  // risultato su Google), H1-H6 e la loro gerarchia, testi (lunghezza, paragrafi, leggibilità con l'indice Gulpease,
  // parole più usate e dove compaiono), immagini (alt e nomi dei file), link, indicazioni per Google (noindex,
  // canonical, lingua, hreflang, https, indirizzo), condivisione social (Open Graph) e dati strutturati (schema.org).
  var seo = { list: null, info: null };
  var STOPW = {};
  ('a ad al alla alle allo agli ai anche ancora che chi ci ce come con così cosa da dal dalla dalle dallo dai dagli dei del della delle dello degli di dove e è ed era fa fra gli ha hai hanno ho i il in io la le lei li lo loro lui ma me mi mia mio ne nei nel nella nelle nello negli noi non o oppure per perché più può qua qual quale quali quando quanto quella quelle quello quelli questa queste questo questi qui se sei si sia siamo siete sono su sua sue sui sul sulla sulle sullo suo suoi te ti tra tu tua tue tuo tuoi un una uno vi voi ogni molto molti molte tutto tutti tutte tutta nostro nostra nostri nostre vostro vostra essere avere fare può puoi possono deve devono anni anno così inoltre dopo prima sempre solo senza circa già mentre the and for with you your our are this that from have has not but all can will its it of to in on at by an as be is or we us me my they them their more one two new about').split(' ').forEach(function (w) { STOPW[w] = 1; });
  function seoWords(t) { return (String(t || '').toLowerCase().match(/[a-zà-öø-ÿ0-9][a-zà-öø-ÿ0-9'’-]*/g) || []); }
  function seoAudit() {
    var out = [], info = {};
    // ogni controllo vale w punti (quanto conta) e ne prende una parte p (0-1): di base dipende dalla gravità
    var cur = { cat: 'Altro', w: 5 };
    function chk(cat, w) { cur = { cat: cat, w: w }; }
    function add(sev, title, detail, els, p) { out.push({ sev: sev, title: title, detail: detail, els: (els || []).filter(Boolean), cat: cur.cat, w: cur.w, p: p != null ? clamp(p, 0, 1) : PTS[sev] }); }
    function vis(el) { return !uxOurs(el) && visibleBox(el); }
    function all(sel) { return [].filter.call(document.querySelectorAll(sel), vis); }
    function txt(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }
    function metaC(sel) { var m = document.querySelector(sel); return m ? (m.getAttribute('content') || '').trim() : null; }
    function has(hay, w) { return (' ' + seoWords(hay).join(' ') + ' ').indexOf(' ' + w + ' ') >= 0; }

    // --- titolo e descrizione (quello che si vede nei risultati di Google) ---
    var title = (document.title || '').replace(/\s+/g, ' ').trim(), desc = metaC('meta[name="description" i]');
    info.title = title; info.desc = desc || '';
    chk('Google', 15); if (!title) add('error', 'Manca il titolo della pagina (<title>)', 'È la riga blu nei risultati di Google: senza, Google ne inventa uno. Scrivine uno di 50-60 caratteri con la parola chiave all\'inizio.');
    else if (title.length < 30) add('warn', 'Titolo della pagina corto (' + title.length + ' caratteri)', '«' + title + '»: tra 50 e 60 caratteri c\'è spazio per la parola chiave, il luogo e il nome del brand.');
    else if (title.length > 65) add('warn', 'Titolo della pagina lungo (' + title.length + ' caratteri)', 'Google lo taglia dopo circa 60 caratteri: metti le parole importanti all\'inizio. Adesso si vede «' + title.slice(0, 58) + '…».');
    else add('ok', 'Titolo della pagina di buona lunghezza', '«' + title + '» (' + title.length + ' caratteri).');
    chk('Google', 12); if (desc == null || !desc) add('warn', 'Manca la meta description', 'È il testo sotto il titolo nei risultati di Google: scrivine una di 140-160 caratteri con la parola chiave e un invito a cliccare (es. «Scopri…», «Prenota…»).', null, 0);
    else if (desc.length < 70) add('warn', 'Meta description corta (' + desc.length + ' caratteri)', '«' + desc + '»: arriva a 140-160 caratteri spiegando cosa trova chi clicca e perché sceglierti.');
    else if (desc.length > 165) add('tip', 'Meta description lunga (' + desc.length + ' caratteri)', 'Google la taglia intorno ai 155-160 caratteri: la parte importante va all\'inizio.');
    else add('ok', 'Meta description presente', desc.length + ' caratteri, lunghezza giusta.');
    chk('Google', 3); if (title && desc && desc.toLowerCase() === title.toLowerCase()) add('tip', 'Description uguale al titolo', 'Sono due spazi diversi: il titolo dice cos\'è, la description convince a cliccare.'); else if (title && desc) add('ok', 'Titolo e description diversi', 'Ognuno fa il suo lavoro.');

    // --- titoli H1-H6 ---
    var hs = all('h1,h2,h3,h4,h5,h6'), h1s = hs.filter(function (h) { return h.tagName === 'H1'; });
    var counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, skips = [], empty = [], longH = [], seen = {}, dup = [], prev = 0;
    info.outline = hs.slice(0, 60).map(function (h) {
      var lv = +h.tagName[1], t = txt(h), skip = prev && lv > prev + 1;
      counts[lv]++;
      if (skip) skips.push(h);
      if (!t) empty.push(h);
      if (t.length > 110) longH.push(h);
      var k = t.toLowerCase();
      if (k && seen[k]) dup.push(h); seen[k] = 1;
      prev = lv;
      return { lv: lv, t: t, el: h, skip: !!skip };
    });
    info.counts = counts;
    chk('Titoli', 15); if (!h1s.length) add('error', 'Manca l\'H1', 'Il titolo principale H1 dice a Google di cosa parla la pagina: ce ne vuole uno, con la parola chiave.');
    else if (h1s.length > 1) add('warn', 'Ci sono ' + h1s.length + ' H1', 'Meglio un solo H1 per pagina: gli altri trasformali in H2.', h1s);
    else {
      var h1t = txt(h1s[0]);
      if (!h1t) add('warn', 'L\'H1 non ha testo', 'Probabilmente contiene solo un\'immagine o un logo: Google non capisce il titolo. Usa un testo vero.', h1s);
      else if (h1t.length > 70) add('tip', 'H1 lungo (' + h1t.length + ' caratteri)', 'Un titolo breve e chiaro funziona meglio: i dettagli nel sottotitolo.', h1s);
      else add('ok', 'Un solo H1', '«' + shortTxt(h1t, 80) + '».', h1s);
    }
    var firstH = info.outline[0];
    chk('Titoli', 3); if (h1s.length && firstH && firstH.lv !== 1) add('tip', 'Ci sono titoli prima dell\'H1', 'Il primo titolo della pagina è un H' + firstH.lv + ' («' + shortTxt(firstH.t, 40) + '»): di solito l\'H1 viene prima di tutto.', [firstH.el]); else if (h1s.length) add('ok', 'L\'H1 viene per primo', 'La pagina si apre con il titolo principale.');
    chk('Titoli', 8); if (skips.length) add('warn', skips.length + (skips.length === 1 ? ' titolo salta' : ' titoli saltano') + ' un livello', 'Es. un ' + skips[0].tagName + ' («' + shortTxt(txt(skips[0]), 40) + '») dopo un titolo di due livelli sopra. La gerarchia va in ordine: H1 → H2 → H3. Spesso si sceglie il livello per la grandezza: meglio sceglierlo per l\'importanza e cambiare la grandezza con lo stile.', skips, Math.max(0.1, 0.6 - skips.length * 0.1)); else if (hs.length) add('ok', 'Gerarchia dei titoli in ordine', 'H1 → H2 → H3 senza salti.');
    chk('Titoli', 5); if (empty.length) add('warn', empty.length + (empty.length === 1 ? ' titolo vuoto' : ' titoli vuoti'), 'Ci sono tag H senza testo: o li riempi o li togli.', empty); else if (hs.length) add('ok', 'Nessun titolo vuoto', 'Tutti i titoli hanno un testo.');
    chk('Titoli', 3); if (dup.length) add('tip', 'Titoli ripetuti', '«' + shortTxt(txt(dup[0]), 50) + '» compare più volte: titoli diversi aiutano Google a capire le sezioni.', dup); else if (hs.length > 1) add('ok', 'Titoli tutti diversi', 'Ogni sezione ha il suo titolo.');
    chk('Titoli', 3); if (longH.length) add('tip', 'Titoli troppo lunghi', 'Alcuni titoli sono paragrafi interi: un titolo dovrebbe stare sotto le 10-12 parole.', longH); else if (hs.length) add('ok', 'Titoli brevi', 'Nessun titolo è un paragrafo intero.');

    // --- testi ---
    // il testo vero della pagina: titoli, paragrafi, elenchi, citazioni (non menu, footer, bottoni o link isolati)
    var blocks = all('h1,h2,h3,h4,h5,h6,p,li,blockquote,td,dd,figcaption').filter(function (el) {
      return !el.closest('nav,footer,header,aside,[role=navigation],[role=contentinfo],button,form') && !el.querySelector('p,li,blockquote,h1,h2,h3,h4,h5,h6');
    });
    var text = blocks.map(txt).join('. ').replace(/\s+/g, ' ').trim();
    if (seoWords(text).length < 60) { var main = document.querySelector('main,article,[role=main]'); text = ((main && vis(main) ? main : document.body).innerText || '').replace(/\s+/g, ' ').trim(); }
    var words = seoWords(text), nw = words.length;
    info.words = nw;
    chk('Testi', 12); if (nw < 300) add('warn', 'Poco testo (' + nw + ' parole)', 'Le pagine con meno di 300 parole faticano a posizionarsi: aggiungi contenuti utili per chi cerca (descrizione, vantaggi, domande frequenti).', null, Math.min(0.7, nw / 300 * 0.7));
    else add('ok', 'Quantità di testo', 'Circa ' + nw + ' parole.');
    var ps = all('p').filter(function (p) { return !p.closest('nav,footer,header'); });
    var longP = ps.filter(function (p) { return seoWords(p.innerText).length > 120; });
    chk('Testi', 5); if (longP.length) add('tip', longP.length + (longP.length === 1 ? ' paragrafo lungo' : ' paragrafi lunghi'), 'Sopra le 120 parole il testo diventa un muro: spezzalo in paragrafi più corti o in elenchi puntati.', longP); else if (ps.length) add('ok', 'Paragrafi di lunghezza giusta', 'Nessun muro di testo.');
    // leggibilità: indice Gulpease (pensato per l'italiano): 89 + (300·frasi − 10·lettere) / parole
    var lang = (root.getAttribute('lang') || '').toLowerCase(), itWords = words.filter(function (w) { return /^(il|la|di|che|e|per|con|una|del|della|sono)$/.test(w); }).length;
    var italian = /^it/.test(lang) || (!lang && itWords > nw * 0.04);
    // solo i paragrafi veri: titoli ed elenchi sono frasi corte e falserebbero l'indice
    var ptext = blocks.filter(function (el) { return /^(P|BLOCKQUOTE|DD)$/.test(el.tagName) && seoWords(txt(el)).length >= 8; }).map(function (el) { return txt(el).replace(/[^.!?…]$/, '$&.'); }).join(' ');
    var pw = seoWords(ptext).length;
    if (italian && pw >= 80) {
      var sentences = Math.max(1, (ptext.match(/[.!?…]+(\s|$)/g) || []).length), letters = (ptext.match(/[a-zà-öø-ÿ]/gi) || []).length;
      var gul = Math.round(89 + (300 * sentences - 10 * letters) / pw), perSent = Math.round(pw / sentences);
      info.gulpease = gul; info.perSent = perSent;
      chk('Testi', 8); if (gul < 40) add('warn', 'Testo difficile da leggere (Gulpease ' + gul + ')', 'Frasi lunghe (in media ' + perSent + ' parole) e parole lunghe. Accorcia le frasi (sotto le 20 parole) e preferisci parole semplici: chi legge resta di più, e Google lo nota.');
      else if (gul < 55) add('tip', 'Testo un po\' impegnativo (Gulpease ' + gul + ')', 'Comprensibile per chi ha un diploma; per tutti conviene accorciare qualche frase (media ' + perSent + ' parole per frase).');
      else add('ok', 'Testo scorrevole (Gulpease ' + gul + ')', 'Frasi di ' + perSent + ' parole in media: si legge bene.');
    }
    // parole più usate (escluse le parole vuote) e dove compaiono
    var freq = {}, bi = {};
    words.forEach(function (w, i) {
      if (w.length < 4 || STOPW[w] || /^\d/.test(w)) return;
      freq[w] = (freq[w] || 0) + 1;
      var n2 = words[i + 1];
      if (n2 && n2.length > 3 && !STOPW[n2] && !/^\d/.test(n2)) { var b2 = w + ' ' + n2; bi[b2] = (bi[b2] || 0) + 1; }
    });
    var top = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 10);
    var topBi = Object.keys(bi).filter(function (k) { return bi[k] >= 3; }).sort(function (a, b) { return bi[b] - bi[a]; }).slice(0, 4);
    var h1text = h1s.length ? txt(h1s[0]) : '', slug = decodeURIComponent(location.pathname).replace(/[-_/]+/g, ' ');
    info.keywords = top.map(function (w) { return { w: w, n: freq[w], inTitle: has(title, w), inH1: has(h1text, w), inDesc: has(desc, w) }; });
    info.phrases = topBi.map(function (k) { return { w: k, n: bi[k] }; });
    if (top.length && nw >= 150) {
      var kw = top[0], where = [], miss = [];
      [['titolo', title], ['H1', h1text], ['description', desc || ''], ['indirizzo', slug], ['inizio del testo', words.slice(0, 100).join(' ')]].forEach(function (p) { (has(p[1], kw) ? where : miss).push(p[0]); });
      info.kw = kw;
      chk('Testi', 12); if (miss.length >= 3) add('warn', 'La parola più usata non è dove conta', '«' + kw + '» compare ' + freq[kw] + ' volte nel testo ma manca in: ' + miss.join(', ') + '. Se è la parola chiave della pagina, mettila nel titolo, nell\'H1 e nella description; se non lo è, chiediti qual è la parola che le persone cercano davvero.');
      else if (miss.length) add('tip', 'Parola chiave: «' + kw + '»', 'È la più usata (' + freq[kw] + ' volte) e c\'è in: ' + where.join(', ') + '. Manca in: ' + miss.join(', ') + '.', null, 0.4 + where.length / 5 * 0.6);
      else add('ok', 'Parola chiave coerente', '«' + kw + '» è nel titolo, nell\'H1, nella description, nell\'indirizzo e all\'inizio del testo.');
      var dens = freq[kw] / nw;
      chk('Testi', 5); if (nw > 200 && dens > 0.035) add('warn', 'Parola ripetuta troppo («' + kw + '»)', 'Compare nel ' + (dens * 100).toFixed(1) + '% delle parole: oltre il 3% sembra forzato. Usa sinonimi e varianti.'); else if (nw > 200) add('ok', 'Nessuna parola ripetuta troppo', '«' + kw + '» è nel ' + (dens * 100).toFixed(1) + '% delle parole: naturale.');
    }

    // --- immagini ---
    var imgs = [].filter.call(document.images, function (im) { return !uxOurs(im) && im.getBoundingClientRect().width > 40; });
    var noAlt = imgs.filter(function (im) { return !im.hasAttribute('alt'); }), longAlt = imgs.filter(function (im) { return (im.getAttribute('alt') || '').length > 125; });
    var badName = imgs.filter(function (im) { var f = fileName(im.currentSrc || im.src || '').toLowerCase(); return /^(img|image|dsc|dscn|dcim|photo|foto|pic|screenshot|screen shot|schermata|whatsapp|pexels|unsplash|untitled|senza titolo|download|copia)[-_ ]?\d*/.test(f) || /^[\d_-]+\.(jpe?g|png|webp|gif|avif)$/.test(f) || /^[a-f0-9]{16,}\./.test(f); });
    info.imgs = imgs.length; info.noAlt = noAlt.length;
    chk('Immagini e link', 10); if (noAlt.length) add('warn', noAlt.length + (noAlt.length === 1 ? ' immagine senza alt' : ' immagini senza alt'), 'Google non vede le immagini: legge l\'alt. Descrivi cosa mostrano in poche parole (es. «Soggiorno luminoso con vista sul parco»), anche per comparire in Google Immagini.', noAlt, imgs.length ? Math.max(0, 1 - noAlt.length / imgs.length) * 0.8 : 0);
    else if (imgs.length) add('ok', 'Tutte le immagini hanno l\'alt', imgs.length + ' immagini controllate.');
    chk('Immagini e link', 3); if (longAlt.length) add('tip', 'Alt troppo lunghi', 'Oltre i 125 caratteri gli screen reader li tagliano: descrizioni brevi e concrete.', longAlt); else if (imgs.length) add('ok', 'Alt di lunghezza giusta', 'Descrizioni brevi e leggibili.');
    chk('Immagini e link', 4); if (badName.length) add('tip', 'Nomi dei file poco descrittivi', 'Es. «' + fileName(badName[0].currentSrc || badName[0].src) + '»: un nome come «appartamento-bilocale-milano.webp» aiuta Google Immagini.', badName, Math.max(0.2, 1 - badName.length / Math.max(1, imgs.length))); else if (imgs.length) add('ok', 'Nomi dei file descrittivi', 'Nessun IMG_1234 o simili.');

    // --- link ---
    var links = [].filter.call(document.querySelectorAll('a[href]'), function (a) { return !uxOurs(a) && !/^(#|javascript:|mailto:|tel:)/i.test(a.getAttribute('href') || ''); });
    var internal = 0, external = 0, nofollow = 0, genericL = [];
    links.forEach(function (a) {
      try { var u = new URL(a.href, location.href); if (u.hostname === location.hostname) internal++; else external++; } catch (e) {}
      if (/nofollow/i.test(a.getAttribute('rel') || '')) nofollow++;
      var lt = (a.innerText || '').trim();
      if (GENERIC_RE.test(lt) && vis(a)) genericL.push(a);
    });
    info.links = { internal: internal, external: external, nofollow: nofollow };
    chk('Immagini e link', 6); if (internal < 3 && nw > 200) add('tip', 'Pochi link interni (' + internal + ')', 'I link verso altre pagine del sito aiutano Google a scoprirle e chi legge a restare: collega le pagine che parlano di argomenti vicini.'); else if (nw > 200) add('ok', 'Link interni presenti (' + internal + ')', 'Collegano le pagine del sito.');
    chk('Immagini e link', 4); if (genericL.length) add('tip', 'Testo dei link generico', '«' + shortTxt(genericL[0].innerText, 30) + '» non dice dove porta: usa parole che descrivono la pagina di arrivo (es. «vedi le planimetrie»).', genericL); else if (links.length) add('ok', 'Testi dei link chiari', 'Dicono dove portano.');

    // --- indicazioni per Google ---
    var robots = ((metaC('meta[name="robots" i]') || '') + ' ' + (metaC('meta[name="googlebot" i]') || '')).toLowerCase();
    info.robots = robots.trim();
    chk('Tecnica', 25); if (/noindex/.test(robots)) add('error', 'La pagina chiede a Google di NON comparire (noindex)', 'C\'è un meta robots "noindex": va bene per staging, bozze o pagine di ringraziamento, ma se questa pagina deve farsi trovare va tolto.');
    else if (/nofollow/.test(robots)) add('warn', 'Meta robots "nofollow"', 'Google non segue i link di questa pagina: di solito non serve.'); else add('ok', 'Google può indicizzare la pagina', 'Nessun noindex nel meta robots.');
    var canon = document.querySelector('link[rel="canonical" i]'), canonHref = canon ? canon.href : '';
    info.canonical = canonHref;
    chk('Tecnica', 6); if (!canon) add('tip', 'Manca il link canonical', 'Indica a Google qual è l\'indirizzo "ufficiale" della pagina (utile se ci sono versioni con parametri o duplicati).');
    else {
      var here = location.origin + location.pathname, cu = '';
      try { var cuu = new URL(canonHref); cu = cuu.origin + cuu.pathname; } catch (e) {}
      if (cu && cu.replace(/\/$/, '') !== here.replace(/\/$/, '')) add('warn', 'Il canonical punta a un\'altra pagina', 'Dice a Google di considerare «' + shortTxt(canonHref, 70) + '» al posto di questa: verifica che sia voluto, altrimenti questa pagina non verrà mostrata.'); else add('ok', 'Canonical corretto', 'Punta a questa pagina.');
    }
    chk('Tecnica', 5); if (!lang) add('warn', 'Manca la lingua della pagina', 'Aggiungi lang="it" al tag <html>: aiuta Google e gli screen reader.'); else add('ok', 'Lingua della pagina indicata', 'lang="' + lang + '".');
    var alts = document.querySelectorAll('link[rel="alternate" i][hreflang]').length;
    info.hreflang = alts;
    chk('Tecnica', 15); if (location.protocol === 'http:' && !/^(localhost|127\.)/.test(location.hostname)) add('error', 'La pagina non è in HTTPS', 'Google penalizza i siti senza HTTPS e il browser li segna come "non sicuri".'); else if (location.protocol === 'https:') add('ok', 'Pagina in HTTPS', 'Connessione sicura.');
    var path = decodeURIComponent(location.pathname);
    chk('Tecnica', 3); if (path.length > 90 || /[A-Z]/.test(path) || /_/.test(path) || location.search.split('&').length > 3) add('tip', 'Indirizzo poco pulito', 'Indirizzi brevi, in minuscolo, con trattini e senza troppi parametri si leggono meglio e si condividono meglio (es. /appartamenti-milano-centro/).'); else add('ok', 'Indirizzo pulito', path + ' si legge bene.');
    chk('Tecnica', 3); if (!document.querySelector('link[rel~="icon" i]')) add('tip', 'Manca la favicon', 'L\'iconcina compare anche nei risultati di Google sul telefono: rende il sito riconoscibile.'); else add('ok', 'Favicon presente', 'L\'iconcina del sito c\'è.');

    // --- condivisione e dati strutturati ---
    var ogMiss = [['og:title', 'titolo'], ['og:description', 'descrizione'], ['og:image', 'immagine']].filter(function (p) { return !metaC('meta[property="' + p[0] + '"]'); }).map(function (p) { return p[1]; });
    info.og = 3 - ogMiss.length;
    chk('Social e dati', 6); if (ogMiss.length) add('tip', 'Anteprima social incompleta', 'Mancano i tag Open Graph per ' + ogMiss.join(', ') + ': quando qualcuno condivide la pagina su WhatsApp, Facebook o LinkedIn l\'anteprima viene peggio.', null, (3 - ogMiss.length) / 3 * 0.8); else add('ok', 'Anteprima social completa', 'Titolo, descrizione e immagine Open Graph ci sono.');
    var types = [];
    [].forEach.call(document.querySelectorAll('script[type="application/ld+json"]'), function (sc) {
      try {
        (function walk(o) {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) { o.forEach(walk); return; }
          if (o['@type']) [].concat(o['@type']).forEach(function (t) { if (types.indexOf(t) < 0) types.push(t); });
          if (o['@graph']) walk(o['@graph']);
        })(JSON.parse(sc.textContent));
      } catch (e) {}
    });
    if (document.querySelector('[itemscope][itemtype]')) types.push('microdati');
    info.schema = types;
    chk('Social e dati', 8); if (!types.length) add('tip', 'Nessun dato strutturato', 'Con i dati strutturati (JSON-LD di schema.org: LocalBusiness, RealEstateListing, FAQPage, BreadcrumbList...) Google può mostrare risultati più ricchi, con stelle, domande o indirizzo.', null, 0.3);
    else add('ok', 'Dati strutturati presenti', types.slice(0, 6).join(', ') + '.');

    var order = { error: 0, warn: 1, tip: 2, ok: 3 };
    out.sort(function (a, b) { return order[a.sev] - order[b.sev]; });
    seo.list = out; seo.info = info;
    return out;
  }
  function seoScore() { return scoreOf(seo.list); }
  // anteprima del risultato su Google: indirizzo, titolo (tagliato a ~60 caratteri), description (~158)
  function serpHtml() {
    var i = seo.info || {}, host = location.hostname.replace(/^www\./, ''), crumbs = decodeURIComponent(location.pathname).split('/').filter(Boolean).slice(0, 3);
    var t = i.title || '(senza titolo: Google ne sceglierà uno)', d = i.desc || '';
    if (t.length > 60) t = t.slice(0, 58).replace(/\s+\S*$/, '') + ' …';
    var dd = d ? (d.length > 158 ? d.slice(0, 155).replace(/\s+\S*$/, '') + ' …' : d) : '';
    return '<div class="serp"><div class="su">' + esc(host) + (crumbs.length ? ' › ' + esc(crumbs.join(' › ')) : '') + '</div>' +
      '<div class="st">' + esc(t) + '</div>' + (dd ? '<div class="sd">' + esc(dd) + '</div>' : '<div class="sd none">Nessuna description: Google mostrerà un pezzo di testo della pagina a caso.</div>') + '</div>';
  }
  function renderSeo() {
    var i = seo.info || {}, c = i.counts || {}, html = '';
    var gl = i.gulpease != null ? (i.gulpease >= 60 ? 'facile' : i.gulpease >= 40 ? 'media' : 'difficile') : '';
    html += '<div class="chips">' +
      '<span>' + (i.words || 0) + ' parole</span>' +
      (i.gulpease != null ? '<span title="Indice di leggibilità Gulpease (0-100): sopra 60 è facile">Leggibilità ' + i.gulpease + ' · ' + gl + '</span>' : '') +
      '<span>H1 ' + (c[1] || 0) + ' · H2 ' + (c[2] || 0) + ' · H3 ' + (c[3] || 0) + '</span>' +
      '<span>Link interni ' + ((i.links || {}).internal || 0) + ' · esterni ' + ((i.links || {}).external || 0) + '</span>' +
      '<span>Immagini ' + (i.imgs || 0) + (i.noAlt ? ' · ' + i.noAlt + ' senza alt' : '') + '</span>' +
      '<span>Schema: ' + ((i.schema || []).length ? esc(i.schema.slice(0, 3).join(', ')) : 'no') + '</span>' +
      '</div>';
    if ((i.keywords || []).length) {
      html += '<h4>Parole più usate</h4><div class="kw">' + i.keywords.map(function (k) {
        return '<span title="' + (k.inTitle ? '✓ nel titolo' : '✗ non nel titolo') + ' · ' + (k.inH1 ? '✓ nell\'H1' : '✗ non nell\'H1') + ' · ' + (k.inDesc ? '✓ nella description' : '✗ non nella description') + '">' + esc(k.w) + ' <b>' + k.n + '</b>' + (k.inTitle || k.inH1 ? ' ✓' : '') + '</span>';
      }).join('') + '</div>';
      if ((i.phrases || []).length) html += '<div class="kw ph">' + i.phrases.map(function (p) { return '<span>«' + esc(p.w) + '» <b>' + p.n + '</b></span>'; }).join('') + '</div>';
      html += '<p class="sub">✓ = è anche nel titolo o nell\'H1. Passa sopra una parola per i dettagli.</p>';
    }
    if ((i.outline || []).length) {
      html += '<h4>Struttura dei titoli</h4><ul class="ol">';
      i.outline.forEach(function (h, k) {
        html += '<li><button type="button" data-h="' + k + '" style="padding-left:' + (6 + (h.lv - 1) * 12) + 'px"><span class="lv lv' + h.lv + '">H' + h.lv + '</span><span class="ht">' + (h.t ? esc(shortTxt(h.t, 70)) : '<i>(vuoto)</i>') + (h.skip ? ' <em title="Salta un livello">⚠</em>' : '') + '</span></button></li>';
      });
      html += '</ul>';
    }
    return html;
  }
  // riassunto per l'AI
  function seoBrief() {
    var i = seo.info || {}, c = i.counts || {};
    return [
      'title «' + shortTxt(i.title, 90) + '» (' + (i.title || '').length + ' caratteri)',
      'meta description ' + (i.desc ? '«' + shortTxt(i.desc, 170) + '» (' + i.desc.length + ' caratteri)' : 'assente'),
      'titoli: H1 ' + (c[1] || 0) + ', H2 ' + (c[2] || 0) + ', H3 ' + (c[3] || 0),
      (i.words || 0) + ' parole' + (i.gulpease != null ? ', leggibilità Gulpease ' + i.gulpease + ' (frasi di ' + i.perSent + ' parole in media)' : ''),
      'parole più usate: ' + (i.keywords || []).slice(0, 6).map(function (k) { return k.w + ' (' + k.n + ')'; }).join(', '),
      'immagini ' + (i.imgs || 0) + ' (' + (i.noAlt || 0) + ' senza alt)',
      'link interni ' + ((i.links || {}).internal || 0) + ', esterni ' + ((i.links || {}).external || 0),
      'canonical ' + (i.canonical ? 'presente' : 'assente') + ', robots «' + (i.robots || 'nessuno') + '»',
      'Open Graph ' + (i.og || 0) + '/3, dati strutturati: ' + ((i.schema || []).join(', ') || 'nessuno')
    ].join('; ');
  }

  // ---------- per chi non vede ----------
  // Chi è cieco o ipovedente usa uno screen reader: un programma che legge la pagina ad alta voce e si muove tra titoli,
  // zone, link, bottoni e campi. Per lui contano i testi che descrivono: l'alt delle immagini, il nome di link e bottoni
  // (anche quelli fatti solo di icone), le etichette dei campi, il titolo dei frame, la lingua della pagina, i titoli e
  // le zone (main, nav). Nimblu non legge la pagina: la controlla con i punteggi e per ogni problema dice come
  // sistemarlo, con il testo già pronto (alt, aria-label, label, title) ricavato da quello che c'è intorno: didascalia,
  // titolo della card, indirizzo del link, nome del file. Sono proposte da controllare, non verità.
  var a11y = { list: null, inv: null, flat: [] };
  function srHidden(el) { return !!el.closest('[aria-hidden="true"],[hidden],[inert]'); }
  // nome accessibile (versione semplificata dell'algoritmo dei browser)
  function accName(el) {
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var t = by.split(/\s+/).map(function (id) { var e = document.getElementById(id); return e ? (e.innerText || e.textContent || '') : ''; }).join(' ').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    var al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    var tag = el.tagName;
    if (tag === 'IMG' || (tag === 'INPUT' && el.type === 'image')) return (el.getAttribute('alt') || '').trim();
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) {
      if (/^(submit|button|reset)$/.test(el.type)) return (el.value || '').trim();
      if (el.labels && el.labels.length) return [].map.call(el.labels, function (l) { return (l.innerText || l.textContent || '').trim(); }).join(' ').trim();
      return (el.getAttribute('title') || '').trim();
    }
    if (tag === 'IFRAME' || tag === 'VIDEO') return (el.getAttribute('title') || '').trim();
    var txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!txt) {
      var im = el.querySelector('img[alt]');
      if (im && im.alt.trim()) txt = im.alt.trim();
      else { var sv = el.querySelector('svg[aria-label],svg title'); if (sv) txt = (sv.getAttribute('aria-label') || sv.textContent || '').trim(); }
    }
    return txt || (el.getAttribute('title') || '').trim();
  }

  // --- testi proposti, ricavati dal contesto ---
  function capFirst(t) { t = String(t || '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  function siteName() {
    var m = document.querySelector('meta[property="og:site_name"]');
    return shortTxt((m && m.content) || (document.title || '').split(/\s+[|–—\-·:]\s+/)[0] || location.hostname.replace(/^www\./, ''), 40);
  }
  // un testo breve lì vicino: didascalia, poi il titolo della card, poi la prima riga di testo (mai il "Scopri di più")
  function nearText(el) {
    var fig = el.closest('figure'), fc = fig && fig.querySelector('figcaption');
    if (fc && (fc.innerText || '').trim()) return shortTxt(fc.innerText, 90);
    function ok(c) {
      if (c.contains(el) || el.contains(c) || uxOurs(c) || !visibleBox(c)) return '';
      var t = (c.innerText || '').replace(/\s+/g, ' ').trim();
      return t.length >= 3 && t.length <= 120 && !GENERIC_RE.test(t) && /[a-zà-ÿ]{3}/i.test(t) ? t.replace(/[.:;,]+$/, '') : '';
    }
    var p = el.parentElement;
    for (var up = 0; p && up < 4 && p !== document.body && p !== root; up++, p = p.parentElement) {
      if (up && p.querySelectorAll('img').length > 3) break;   // contenitore con tante immagini: il testo potrebbe essere di un'altra
      var hs = p.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'), i, t;
      for (i = 0; i < hs.length; i++) if ((t = ok(hs[i]))) return shortTxt(t, 90);
      var cs = p.querySelectorAll('figcaption,strong,b,p,span,a,li,div');
      for (i = 0; i < cs.length; i++) if (!cs[i].querySelector('p,div,ul,ol,h1,h2,h3,h4,h5,h6,img') && (t = ok(cs[i]))) return shortTxt(t, 90);
    }
    return '';
  }
  // parole utili nel nome del file o nell'indirizzo ("terrazzo-vista-milano-1024x683.jpg" → "Terrazzo vista milano")
  var JUNKW = /^(img|dsc|dscn|dji|pxl|image|images|photo|foto|screenshot|schermata|copy|copia|scaled|min|thumb|web|final|def|large|small|medium|hero|banner|bg|background|jpg|jpeg|png|webp|avif|svg|gif|wp|content|uploads|index|html|php|page|pagina|www|http|https|com|it)$/i;
  function wordsOf(s) {
    var w = String(s || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]?\d{2,4}x\d{2,4}/g, ' ').split(/[-_\s.+%,]+/)
      .filter(function (x) { return /^[a-zà-ÿ]{3,}$/i.test(x) && !JUNKW.test(x); });
    return w.length >= 2 ? capFirst(w.join(' ').toLowerCase()) : '';
  }
  function urlWords(href) {
    try { var u = new URL(href, location.href); } catch (e) { return ''; }
    if (u.origin !== location.origin) return capFirst(u.hostname.replace(/^www\./, ''));
    var seg = u.pathname.split('/').filter(Boolean).pop() || '';
    var w = wordsOf(decodeURIComponent(seg));
    return w || (seg && /^[a-zà-ÿ]{4,}$/i.test(seg) ? capFirst(seg) : '');
  }
  function dq(t) { return String(t).replace(/"/g, '\''); }
  function altFor(im) {
    var meta = (im.currentSrc || im.src || '') + ' ' + im.className + ' ' + im.id + ' ' + (im.parentElement ? im.parentElement.className : '');
    var hd = im.closest('header,[role="banner"]'), link = im.closest('a[href]');
    if (/logo/i.test(meta) || (hd && hd.querySelector('img') === im)) {
      var home = link && /^\/?$|^#?$/.test(new URL(link.href, location.href).pathname.replace(/\/$/, ''));
      return home ? siteName() + ' – home page' : 'Logo ' + siteName();
    }
    var t = (im.getAttribute('title') || '').trim() || nearText(im) || wordsOf(fileName(im.currentSrc || im.src)) || (link ? urlWords(link.href) : '');
    return t ? dq(shortTxt(t, 120)) : '';
  }
  var SOCIAL = [[/instagram/, 'Instagram'], [/facebook|fb\.com/, 'Facebook'], [/linkedin/, 'LinkedIn'], [/youtube|youtu\.be/, 'YouTube'], [/tiktok/, 'TikTok'],
    [/twitter|\/\/(www\.)?x\.com/, 'X (Twitter)'], [/wa\.me|whatsapp/, 'WhatsApp'], [/pinterest/, 'Pinterest'], [/t\.me\/|telegram/, 'Telegram'], [/spotify/, 'Spotify'],
    [/threads\.net/, 'Threads'], [/maps\.google|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo/, 'Indicazioni su Google Maps']];
  var ICONW = [[/hamburger|burger|menu-toggle|nav-toggle|navbar-toggler|offcanvas|\bmenu\b/, 'Apri il menu'], [/close|chiudi|dismiss/, 'Chiudi'], [/search|cerca/, 'Cerca'],
    [/\bnext\b|-next|arrow-right|chevron-right|angle-right|avanti/, 'Successiva'], [/\bprev\b|-prev|arrow-left|chevron-left|angle-left|precedente|indietro/, 'Precedente'],
    [/\bplay\b|-play|play-btn/, 'Riproduci il video'], [/pause/, 'Metti in pausa'], [/\bcart\b|carrello|basket/, 'Carrello'], [/account|\buser\b|login|profil/, 'Il tuo account'],
    [/share|condividi/, 'Condividi'], [/back-to-top|to-top|scroll-?top|torna-su/, 'Torna su'], [/download|scarica/, 'Scarica'], [/fa-phone|icon-phone|\bphone\b|chiama/, 'Chiama'],
    [/envelope|icon-mail|\bmail\b/, 'Scrivici'], [/heart|wish|preferit/, 'Aggiungi ai preferiti'], [/\blang\b|language|lingua|wpml/, 'Cambia lingua']];
  var SYMW = { '☰': 'Apri il menu', '≡': 'Apri il menu', '×': 'Chiudi', '✕': 'Chiudi', '✖': 'Chiudi', '✗': 'Chiudi', 'x': 'Chiudi', 'X': 'Chiudi', '🔍': 'Cerca', '🔎': 'Cerca',
    '→': 'Successiva', '›': 'Successiva', '»': 'Successiva', '>': 'Successiva', '❯': 'Successiva', '←': 'Precedente', '‹': 'Precedente', '«': 'Precedente', '<': 'Precedente', '❮': 'Precedente',
    '▶': 'Riproduci', '►': 'Riproduci', '↑': 'Torna su', '+': 'Apri', '♥': 'Aggiungi ai preferiti', '❤': 'Aggiungi ai preferiti', '♡': 'Aggiungi ai preferiti' };
  function nameFor(c) {
    var href = (c.getAttribute('href') || '').toLowerCase(), i;
    if (/^tel:/.test(href)) return 'Chiama il ' + decodeURIComponent(href.slice(4)).replace(/\s+/g, ' ');
    if (/^mailto:/.test(href)) return 'Scrivi a ' + decodeURIComponent(href.slice(7).split('?')[0]);
    for (i = 0; i < SOCIAL.length; i++) if (SOCIAL[i][0].test(href)) return SOCIAL[i][1];
    var sym = (c.innerText || c.value || '').trim();
    if (SYMW[sym]) return SYMW[sym];
    var meta = [c.getAttribute('class') || '', c.id, c.getAttribute('data-icon') || ''].concat([].map.call(c.querySelectorAll('[class],use'), function (x) {
      return (x.getAttribute('class') || '') + ' ' + (x.getAttribute('href') || x.getAttribute('xlink:href') || '');
    })).join(' ').toLowerCase();
    for (i = 0; i < SOCIAL.length; i++) if (SOCIAL[i][0].test(meta)) return SOCIAL[i][1];
    for (i = 0; i < ICONW.length; i++) if (ICONW[i][0].test(meta)) return ICONW[i][1];
    if (c.tagName === 'A' && c.href) {
      var u = new URL(c.href, location.href);
      if (u.origin === location.origin && /^\/?$/.test(u.pathname)) return siteName() + ' – home page';
      return urlWords(c.href);
    }
    return '';
  }
  var FIELDW = [[/cognome|last.?name|family|surname/, 'Cognome'], [/mail/, 'Email'], [/tel|phone|cell|mobile/, 'Telefono'], [/messag|message|richiest|note|comment/, 'Messaggio'],
    [/citt|city|comune/, 'Città'], [/\bcap\b|zip|postal/, 'CAP'], [/azienda|company|societ/, 'Azienda'], [/privacy|consens|gdpr|accept|informativa/, 'Accetto l\'informativa privacy'],
    [/newsletter/, 'Iscriviti alla newsletter'], [/nome|first.?name|given|your-name|\bname\b/, 'Nome'], [/search|cerca|\bs\b/, 'Cerca']];
  function labelFor(f) {
    var ph = (f.placeholder || '').replace(/\s*\*+\s*$/, '').replace(/^(es\.?|ex\.?|e\.g\.)\s*/i, '').trim();
    if (ph && ph.length < 50) return dq(capFirst(ph));
    var meta = ((f.name || '') + ' ' + (f.id || '') + ' ' + (f.getAttribute('autocomplete') || '') + ' ' + f.type).toLowerCase();
    for (var i = 0; i < FIELDW.length; i++) if (FIELDW[i][0].test(meta)) return FIELDW[i][1];
    if (f.tagName === 'TEXTAREA') return 'Messaggio';
    if (f.tagName === 'SELECT' && f.options[0] && !f.options[0].value) return dq(capFirst(f.options[0].text.replace(/^[-–\s]*(seleziona|scegli|select)\s*/i, '').replace(/[-–\s.…]+$/, ''))) || '';
    return { email: 'Email', tel: 'Telefono', url: 'Sito web', date: 'Data', number: 'Numero', password: 'Password' }[f.type] || '';
  }
  function titleFor(fr) {
    var s = (fr.getAttribute('src') || fr.getAttribute('data-src') || '').toLowerCase();
    var M2 = [[/google\.[a-z.]+\/maps|maps\.google/, 'Mappa Google'], [/youtube|youtu\.be/, 'Video YouTube'], [/vimeo/, 'Video Vimeo'], [/matterport/, 'Visita virtuale 3D'],
      [/calendly/, 'Prenotazione appuntamento (Calendly)'], [/instagram/, 'Post Instagram'], [/facebook/, 'Contenuto Facebook'], [/hubspot|hsforms/, 'Modulo HubSpot'],
      [/typeform/, 'Modulo Typeform'], [/spotify/, 'Player Spotify'], [/openstreetmap/, 'Mappa OpenStreetMap']];
    for (var i = 0; i < M2.length; i++) if (M2[i][0].test(s)) return M2[i][1];
    return '';
  }
  function guessLang() {
    var it = 0, en = 0;
    seoWords((document.body.innerText || '').slice(0, 6000)).forEach(function (x) {
      if (/^(il|lo|la|gli|le|di|che|per|con|una|sono|della|nel|anche|più|del|dei)$/.test(x)) it++;
      else if (/^(the|and|of|to|is|for|with|that|this|are|you|your)$/.test(x)) en++;
    });
    return en > it * 1.5 ? 'en' : 'it';
  }
  // dove si cambia, sui siti più comuni
  function platformOf() {
    return {
      wp: !!document.querySelector('link[href*="/wp-content/"],script[src*="/wp-content/"],img[src*="/wp-content/"],meta[name="generator"][content^="WordPress"]'),
      el: !!document.querySelector('[data-elementor-type],.elementor'),
      cf7: !!document.querySelector('.wpcf7')
    };
  }

  function a11yAudit() {
    var out = [], inv = { imgs: [], ctrls: [], fields: [], media: [] }, pf = platformOf();
    var cur = { cat: 'Altro', w: 5 };
    function chk(cat, w) { cur = { cat: cat, w: w }; }
    // o = { fix(el) → testo pronto per quell'elemento, code: testo pronto per tutta la pagina, where: dove si cambia }
    function add(sev, title, detail, els, p, o) {
      o = o || {};
      els = (els || []).filter(Boolean);
      out.push({ sev: sev, title: title, detail: detail, els: els, cat: cur.cat, w: cur.w, p: p != null ? clamp(p, 0, 1) : PTS[sev],
        sug: o.fix ? els.map(function (el) { try { return o.fix(el) || ''; } catch (e) { return ''; } }) : null, code: o.code || '', where: o.where || '' });
    }
    function vis(el) { return !uxOurs(el) && visibleBox(el); }
    function all(sel) { return [].filter.call(document.querySelectorAll(sel), vis); }
    function part(n, tot) { return tot ? Math.max(0, 1 - n / tot) : 1; }
    function altCode(im) { var t = altFor(im); return t ? 'alt="' + t + '"' : ''; }
    var W_ALT = pf.wp ? 'In WordPress: Media → Libreria → clicca l\'immagine → «Testo alternativo»' + (pf.el ? ' (Elementor usa quello della libreria).' : '.') : '';
    var W_LINK = pf.el ? 'In Elementor: nelle opzioni del link (l\'ingranaggio accanto all\'URL) → «Attributi personalizzati» → aria-label|testo.' : '';

    // --- immagini: quelle che dicono qualcosa hanno bisogno di una descrizione (alt), quelle decorative di alt="" ---
    var imgs = all('img').filter(function (im) { var r = im.getBoundingClientRect(); return r.width > 16 && r.height > 16; });
    var missing = [], fileAlt = [], generic = [], redundant = [], longAlt = [], decoBig = [], byAlt = {};
    imgs.forEach(function (im) {
      var has = im.hasAttribute('alt'), alt = (im.getAttribute('alt') || '').trim(), r = im.getBoundingClientRect(), link = im.closest('a[href],button');
      var hidden = srHidden(im) || /^(presentation|none)$/.test(im.getAttribute('role') || '');
      var it = { el: im, alt: has ? alt : null, src: im.currentSrc || im.src, hidden: hidden, link: !!link };
      inv.imgs.push(it);
      if (hidden) return;
      if (!has) { missing.push(im); it.sug = altFor(im); return; }
      if (!alt) { if (link && !accName(link)) { missing.push(im); it.sug = altFor(im); } else if (r.width * r.height > 300 * 200) decoBig.push(im); return; }
      if (/\.(jpe?g|png|gif|webp|svg|avif)\b/i.test(alt) || /^(img|dsc|dscn|image|photo|foto|screenshot|schermata)[-_ ]?\d+/i.test(alt)) fileAlt.push(im);
      else if (/^(immagine|image|foto|photo|picture|img|logo|icona|icon|banner|grafica|graphic|senza titolo|untitled|placeholder|\d+)$/i.test(alt)) generic.push(im);
      else if (/^(immagine|foto|fotografia|image|picture|photo)\s+(di|del|della|dello|dei|delle|degli|of)\b/i.test(alt)) redundant.push(im);
      if (alt.length > 150) longAlt.push(im);
      var k = alt.toLowerCase();
      (byAlt[k] = byAlt[k] || []).push(im);
    });
    var dupAlt = [];
    Object.keys(byAlt).forEach(function (k) {
      var g = byAlt[k], srcs = {};
      g.forEach(function (im) { srcs[im.currentSrc || im.src] = 1; });
      if (g.length >= 3 && Object.keys(srcs).length >= 3) dupAlt = dupAlt.concat(g);
    });
    var described = imgs.filter(function (im) { return !srHidden(im); }), nd = described.length;
    chk('Immagini', 15);
    if (missing.length) add(missing.length > nd / 2 ? 'error' : 'warn', 'Descrivi ' + (missing.length === 1 ? 'l\'immagine che non ha' : 'le ' + missing.length + ' immagini che non hanno') + ' una descrizione', 'Oggi chi non vede sente solo «immagine» o il nome del file. Scrivi nell\'alt cosa mostra, come lo diresti al telefono (es. «Terrazzo con vista sui tetti di Milano»); se è solo decorativa, metti alt="" vuoto.', missing, part(missing.length, nd) * 0.8, { fix: altCode, where: W_ALT });
    else if (nd) add('ok', 'Ogni immagine ha la sua descrizione', nd + ' immagini con alt (o segnate come decorative).');
    chk('Immagini', 6);
    if (fileAlt.length) add('warn', 'Sostituisci i nomi di file con una descrizione', 'Es. «' + shortTxt(fileAlt[0].alt, 40) + '»: lo screen reader legge il nome del file, che non dice niente. Scrivi cosa si vede.', fileAlt, part(fileAlt.length, nd) * 0.6, { fix: altCode, where: W_ALT });
    else if (nd) add('ok', 'Nessun nome di file come descrizione', 'Le descrizioni sono parole vere.');
    chk('Immagini', 5);
    if (generic.length) add('warn', 'Rendi concrete le descrizioni generiche', '«' + shortTxt(generic[0].alt, 30) + '» non dice niente a chi non vede: scrivi cosa c\'è, chi, dove.', generic, part(generic.length, nd) * 0.6, { fix: altCode, where: W_ALT });
    else if (nd) add('ok', 'Descrizioni concrete', 'Nessun alt tipo «immagine» o «foto».');
    chk('Immagini', 3);
    if (redundant.length) add('tip', 'Togli «immagine di» dalle descrizioni', 'Lo screen reader dice già che è un\'immagine: parti direttamente dal contenuto.', redundant, null, {
      fix: function (im) { return 'alt="' + dq(capFirst(im.alt.trim().replace(/^(immagine|foto|fotografia|image|picture|photo)\s+(di|del|della|dello|dei|delle|degli|of)\s+/i, '').replace(/^(uno|una|un|il|lo|la|gli|le|i|the|an|a)\s+|^l['’]/i, ''))) + '"'; }, where: W_ALT });
    else if (nd) add('ok', 'Descrizioni senza giri di parole', 'Nessun «immagine di…» ripetuto.');
    chk('Immagini', 3);
    if (longAlt.length) add('tip', 'Accorcia le descrizioni troppo lunghe', 'Oltre i 150 caratteri sono faticose da ascoltare: tieni l\'essenziale e sposta i dettagli in una didascalia o nel testo vicino.', longAlt, null, {
      fix: function (im) { var a = im.alt.trim(), s = (/^.{30,140}?[.!?](\s|$)/.exec(a) || [])[0]; return 'alt="' + dq((s || a.slice(0, 130).replace(/\s+\S*$/, '')).trim().replace(/[.,;:]$/, '')) + '"'; }, where: W_ALT });
    else if (nd) add('ok', 'Descrizioni di lunghezza giusta', 'Brevi e chiare.');
    chk('Immagini', 4);
    if (dupAlt.length) add('tip', 'Dai una descrizione diversa a ogni immagine', '«' + shortTxt(dupAlt[0].alt, 40) + '» è usata per ' + dupAlt.length + ' immagini diverse: chi ascolta pensa che siano uguali.', dupAlt, null, { fix: altCode, where: W_ALT });
    else if (nd > 2) add('ok', 'Descrizioni tutte diverse', 'Ogni immagine ha la sua.');
    chk('Immagini', 4);
    if (decoBig.length) add('tip', 'Controlla le immagini grandi segnate come decorative', 'Hanno alt="" vuoto e lo screen reader le salta: va bene se sono solo sfondo, ma se mostrano qualcosa (un appartamento, un prodotto) descrivile.', decoBig, null, { fix: altCode, where: W_ALT });
    var svgs = all('svg[role="img"]').filter(function (sv) { return !srHidden(sv) && !accName(sv); });
    chk('Immagini', 4);
    if (svgs.length) add('warn', 'Dai un nome alle grafiche SVG', 'Sono segnate come immagini (role="img") ma senza nome: chi non vede non sa cosa sono.', svgs, null, { fix: function (sv) { var t = nearText(sv); return t ? 'aria-label="' + dq(t) + '"' : ''; } });

    // --- link e bottoni: devono dire dove portano o cosa fanno, anche quando sono solo un'icona ---
    var ctrls = all('a[href],button,[role="button"],[role="link"],input[type="submit"],input[type="button"],input[type="image"],summary').filter(function (c) { return !srHidden(c); });
    var noName = [], symbols = [], vague = {}, newTab = [];
    ctrls.forEach(function (c) {
      var name = accName(c), vtxt = (c.innerText || '').replace(/\s+/g, ' ').trim();
      if (!name) noName.push(c);
      else if (!/[a-zà-ÿ0-9]/i.test(name)) symbols.push(c);
      if (!vtxt || vtxt !== name) inv.ctrls.push({ el: c, name: name, visible: vtxt, sug: name ? '' : nameFor(c) });
      if (name && c.tagName === 'A' && GENERIC_RE.test(name)) { var vk = name.toLowerCase(); vague[vk] = vague[vk] || { hrefs: {}, els: [] }; vague[vk].hrefs[c.href] = 1; vague[vk].els.push(c); }
      if (c.tagName === 'A' && c.target === '_blank' && !/nuov[ao] (scheda|finestra)|new (tab|window)|si apre/i.test(name)) newTab.push(c);
    });
    var vagueEls = [];
    Object.keys(vague).forEach(function (k) { if (Object.keys(vague[k].hrefs).length > 1) vagueEls = vagueEls.concat(vague[k].els); });
    function nameCode(c) { var t = nameFor(c); return t ? 'aria-label="' + dq(t) + '"' : ''; }
    chk('Link e bottoni', 15);
    if (noName.length) add('error', 'Dai un nome ' + (noName.length === 1 ? 'all\'icona' : 'alle ' + noName.length + ' icone') + ' senza testo', 'Oggi lo screen reader dice solo «link» o «pulsante», senza dire dove porta: di solito sono social, menu, frecce del carosello, chiudi. Aggiungi un aria-label che lo dica.', noName, part(noName.length, ctrls.length) * 0.6, { fix: nameCode, where: W_LINK });
    else if (ctrls.length) add('ok', 'Tutti i link e bottoni hanno un nome', ctrls.length + ' controllati.');
    chk('Link e bottoni', 5);
    if (symbols.length) add('warn', 'Usa parole al posto dei simboli', '«' + accName(symbols[0]) + '» viene letto come un simbolo o saltato: dai al bottone un nome fatto di parole.', symbols, null, { fix: nameCode, where: W_LINK });
    else if (ctrls.length) add('ok', 'Nomi fatti di parole', 'Nessun bottone che si chiama solo «→» o «×».');
    chk('Link e bottoni', 6);
    if (vagueEls.length) add('warn', 'Rendi riconoscibili i «' + shortTxt(accName(vagueEls[0]), 24) + '»', 'Più link hanno lo stesso testo ma vanno in pagine diverse: chi scorre l\'elenco dei link sente «' + shortTxt(accName(vagueEls[0]), 24) + '» ' + vagueEls.length + ' volte. Aggiungi di cosa si parla.', vagueEls, null, {
      fix: function (c) { var t = nearText(c) || urlWords(c.href); return t ? 'aria-label="' + dq(accName(c) + ': ' + t) + '"' : ''; }, where: W_LINK });
    else if (ctrls.length) add('ok', 'Link distinguibili', 'Nessun «leggi di più» ripetuto verso pagine diverse.');
    chk('Link e bottoni', 3);
    if (newTab.length) add('tip', 'Avvisa quando un link apre una nuova scheda', 'Chi non vede si ritrova in un\'altra scheda senza saperlo e il tasto «indietro» non funziona più.', newTab, null, {
      fix: function (c) { var t = accName(c) || nameFor(c); return t ? 'aria-label="' + dq(t) + ' (si apre in una nuova scheda)"' : ''; }, where: W_LINK });
    else if (ctrls.length) add('ok', 'Nessuna nuova scheda a sorpresa', 'I link che aprono nuove schede lo dicono (o non ce ne sono).');

    // --- moduli ---
    var fields = all('input,select,textarea').filter(function (f) { return !/^(hidden|submit|button|reset|image)$/.test(f.type) && !srHidden(f); });
    var noLabel = [], phOnly = [];
    fields.forEach(function (f) {
      var name = accName(f);
      inv.fields.push({ el: f, name: name, ph: f.placeholder || '', sug: name ? '' : labelFor(f), type: f.tagName === 'SELECT' ? 'menu a tendina' : f.tagName === 'TEXTAREA' ? 'area di testo' : { checkbox: 'casella', radio: 'opzione', email: 'email', tel: 'telefono' }[f.type] || 'testo' });
      if (!name) (f.placeholder ? phOnly : noLabel).push(f);
    });
    function labelCode(f) {
      var t = labelFor(f);
      if (!t) return '';
      if (f.closest('.wpcf7') && f.name) {
        var tag = f.tagName === 'TEXTAREA' ? 'textarea' : f.tagName === 'SELECT' ? 'select' : /^(email|tel|url|number|date)$/.test(f.type) ? f.type : 'text';
        return '<label> ' + t + ' [' + tag + (f.required || f.getAttribute('aria-required') === 'true' ? '*' : '') + ' ' + f.name + '] </label>';
      }
      return f.id ? '<label for="' + f.id + '">' + t + '</label>' : 'aria-label="' + t + '"';
    }
    chk('Moduli', 12);
    if (noLabel.length || phOnly.length) add(noLabel.length ? 'error' : 'warn', 'Aggiungi l\'etichetta a ' + (noLabel.length + phOnly.length === 1 ? '1 campo' : (noLabel.length + phOnly.length) + ' campi'), noLabel.length ? 'Chi non vede sente solo «campo di testo» senza sapere cosa scriverci.' + (phOnly.length ? ' Il testo segnaposto (placeholder) non basta: molti screen reader non lo leggono e sparisce scrivendo.' : '') : 'Il testo segnaposto (placeholder) non basta: molti screen reader non lo leggono e sparisce scrivendo.', noLabel.concat(phOnly), part(noLabel.length + phOnly.length * 0.5, fields.length) * 0.7, {
      fix: labelCode, where: pf.cf7 ? 'In Contact Form 7: nel modulo racchiudi ogni campo in un <label> con il suo testo, come negli esempi.' : pf.el ? 'In Elementor: nel widget Modulo compila l\'«Etichetta» di ogni campo.' : '' });
    else if (fields.length) add('ok', 'Ogni campo ha la sua etichetta', fields.length + ' campi controllati.');
    var req = fields.filter(function (f) { var lb = f.labels && f.labels[0] ? f.labels[0].innerText || '' : ''; return /\*/.test(lb) && !f.required && f.getAttribute('aria-required') !== 'true'; });
    chk('Moduli', 4);
    if (req.length) add('tip', 'Segna i campi obbligatori in modo che si senta', 'L\'asterisco spesso non viene letto: chi non vede scopre che il campo era obbligatorio solo dopo l\'errore.', req, null, {
      fix: function (f) { return f.closest('.wpcf7') && f.name ? '[' + (f.tagName === 'TEXTAREA' ? 'textarea' : /^(email|tel|url)$/.test(f.type) ? f.type : 'text') + '* ' + f.name + ']' : 'required'; }, where: pf.cf7 ? 'In Contact Form 7 basta l\'asterisco nel tag del campo, es. [text* your-name].' : '' });
    else if (fields.length) add('ok', 'Campi obbligatori riconoscibili', 'Segnati in modo che lo screen reader li annunci.');

    // --- struttura: titolo, lingua, titoli e zone per orientarsi ---
    var lang = root.getAttribute('lang');
    chk('Struttura', 8);
    if (!lang) add('warn', 'Indica la lingua della pagina', 'Senza, lo screen reader non sa con che voce leggere e rischia di pronunciare l\'italiano con l\'accento inglese.', [], null, {
      code: '<html lang="' + guessLang() + '">', where: pf.wp ? 'In WordPress la mette il tema (in header.php: <html <?php language_attributes(); ?>>) in base a Impostazioni → Generali → Lingua del sito.' : '' });
    else add('ok', 'Lingua della pagina indicata', 'lang="' + lang + '": la voce giusta.');
    chk('Struttura', 6);
    var h1s = all('h1');
    if (!(document.title || '').trim()) add('error', 'Dai un titolo alla pagina', 'È la prima cosa che lo screen reader legge aprendo la pagina (e il nome della scheda).', [], null, { code: '<title>' + (h1s[0] ? shortTxt(h1s[0].innerText, 50) + ' | ' : '') + siteName() + '</title>' });
    else add('ok', 'La pagina ha un titolo', '«' + shortTxt(document.title, 60) + '».');
    var heads = all('h1,h2,h3,h4,h5,h6,[role="heading"]').filter(function (h) { return !srHidden(h); });
    chk('Struttura', 10);
    if (!heads.length) add('error', 'Trasforma i titoli delle sezioni in veri titoli (H1, H2…)', 'Chi non vede salta da un titolo all\'altro per capire com\'è fatta la pagina: senza titoli deve ascoltarla tutta. Il titolo principale va in H1, quelli delle sezioni in H2.');
    else if (heads.length < 3 && (document.body.innerText || '').length > 2500) add('warn', 'Dividi il testo in sezioni con dei titoli', 'Ci sono solo ' + heads.length + ' titoli per tanto testo: aggiungi H2 e H3 per farlo scorrere più facilmente.', heads, 0.5);
    else add('ok', 'Titoli per orientarsi', heads.length + ' titoli (H1-H6).');
    var hjump = [], hprev = 0;
    heads.forEach(function (h) { var lv = +(h.tagName.charAt(1) || h.getAttribute('aria-level') || 2); if (hprev && lv > hprev + 1) hjump.push({ el: h, a: hprev, b: lv }); hprev = lv; });
    chk('Struttura', 4);
    if (hjump.length) add('tip', 'Metti in ordine i livelli dei titoli', 'Es. da H' + hjump[0].a + ' si passa a H' + hjump[0].b + ': chi ascolta pensa di essersi perso una sezione. Scendi di un livello alla volta (H1 → H2 → H3); se ti serve solo la dimensione, cambiala con lo stile.', hjump.map(function (j) { return j.el; }), null, {
      fix: function (h) { var j = hjump.filter(function (x) { return x.el === h; })[0]; return j ? '<h' + (j.a + 1) + '>' + shortTxt(h.innerText, 50) + '</h' + (j.a + 1) + '>' : ''; },
      where: pf.el ? 'In Elementor: nel widget Titolo → «Tag HTML».' : '' });
    else if (heads.length > 1) add('ok', 'Titoli in ordine', 'I livelli scendono uno alla volta.');
    chk('Struttura', 6);
    if (!document.querySelector('main,[role="main"]')) add('warn', 'Racchiudi il contenuto in <main>', 'Con la zona principale chi usa lo screen reader salta il menu e va dritto al contenuto con un tasto.', [], null, {
      code: '<main id="contenuto"> … </main>', where: pf.el ? 'In Elementor: nel contenitore che racchiude la pagina → Layout → «Tag HTML»: main.' : '' });
    else add('ok', 'Zona principale indicata', 'C\'è <main>: si salta subito al contenuto.');
    chk('Struttura', 3);
    var skipL = [].slice.call(document.querySelectorAll('a[href^="#"]'), 0, 8).filter(function (a) { return /salta|vai al contenuto|skip/i.test(a.textContent || a.getAttribute('aria-label') || ''); });
    if (!skipL.length) add('tip', 'Aggiungi il link «Salta al contenuto»', 'Un link all\'inizio, visibile solo quando ci si arriva col tasto Tab, evita di riascoltare tutto il menu a ogni pagina.', [], null, {
      code: '<a class="skip-link" href="#contenuto">Salta al contenuto</a>' });
    else add('ok', 'C\'è «Salta al contenuto»', 'Si evita di riascoltare il menu.');

    // --- video e frame ---
    var frames = all('iframe').filter(function (f) { return !srHidden(f); });
    frames.forEach(function (f) { var n = accName(f); inv.media.push({ el: f, kind: 'frame', name: n, sug: n ? '' : titleFor(f) }); });
    var noTitle = frames.filter(function (f) { return !accName(f); });
    chk('Video e frame', 6);
    if (noTitle.length) add('warn', 'Dai un titolo ' + (noTitle.length === 1 ? 'al frame' : 'ai ' + noTitle.length + ' frame'), 'Mappe, video di YouTube e moduli esterni sono «finestre» dentro la pagina: senza title si sente solo «frame» e chi non vede non sa se entrarci.', noTitle, null, {
      fix: function (f) { var t = titleFor(f); return t ? 'title="' + t + '"' : ''; } });
    else if (frames.length) add('ok', 'Frame con il titolo', frames.length + ' frame descritti.');
    var vids = all('video').filter(function (v) { return !srHidden(v) && !(v.muted && v.loop && !v.controls); });
    vids.forEach(function (v) { inv.media.push({ el: v, kind: 'video', name: accName(v), caps: !!v.querySelector('track[kind="captions"],track[kind="subtitles"]') }); });
    var noCaps = vids.filter(function (v) { return !v.querySelector('track[kind="captions"],track[kind="subtitles"]'); });
    chk('Video e frame', 6);
    if (noCaps.length) add('tip', 'Racconta i video anche a parole', 'Per chi non vede serve una frase nel testo vicino che dica cosa mostra il video (e per chi non sente, i sottotitoli).', noCaps, null, {
      fix: function () { return '<track kind="captions" src="sottotitoli-it.vtt" srclang="it" label="Italiano">'; } });
    else if (vids.length) add('ok', 'Video con sottotitoli', 'Comprensibili anche senza audio.');
    var autoSound = all('video[autoplay],audio[autoplay]').filter(function (m) { return !m.muted; });
    chk('Video e frame', 5);
    if (autoSound.length) add('warn', 'Non far partire l\'audio da solo', 'Copre la voce dello screen reader: chi non vede non riesce a usare la pagina finché non trova lo stop.', autoSound, null, { fix: function () { return 'muted'; } });

    // --- tastiera: chi non vede non usa il mouse ---
    var posTab = all('[tabindex]').filter(function (el) { return +el.getAttribute('tabindex') > 0; });
    chk('Tastiera', 5);
    if (posTab.length) add('warn', 'Lascia l\'ordine naturale del tasto Tab', 'tabindex maggiore di 0 cambia l\'ordine in cui si passa da un elemento all\'altro: chi usa la tastiera salta qua e là.', posTab, null, { fix: function () { return 'tabindex="0"'; } });
    else add('ok', 'Ordine di tabulazione naturale', 'Si segue l\'ordine della pagina.');
    var fakeBtn = all('[role="button"],[onclick]').filter(function (el) { return !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName) && !el.hasAttribute('tabindex'); });
    chk('Tastiera', 8);
    if (fakeBtn.length) add('warn', (fakeBtn.length === 1 ? 'Trasforma il finto bottone in un bottone vero' : 'Trasforma i ' + fakeBtn.length + ' finti bottoni in bottoni veri'), 'Sono div o span che funzionano col clic ma non col tasto Tab: chi non vede non li trova e non li può premere.', fakeBtn, null, {
      fix: function (el) { return '<button type="button">' + shortTxt(el.innerText || accName(el) || nameFor(el), 40) + '</button>'; } });
    else add('ok', 'Cliccabili raggiungibili da tastiera', 'Nessun finto bottone.');
    var hidFocus = [].filter.call(document.querySelectorAll('[aria-hidden="true"] a[href],[aria-hidden="true"] button,[aria-hidden="true"] input'), function (el) { return !uxOurs(el) && visibleBox(el) && el.tabIndex >= 0; });
    chk('Tastiera', 4);
    if (hidFocus.length) add('warn', 'Togli dal tasto Tab gli elementi nascosti allo screen reader', 'Sono dentro aria-hidden="true" ma ci si arriva col Tab: chi non vede finisce su qualcosa che per lui «non esiste». Se sono copie (es. slide duplicate del carosello) toglile dal Tab, altrimenti togli aria-hidden.', hidFocus, null, { fix: function () { return 'tabindex="-1"'; } });

    var order = { error: 0, warn: 1, tip: 2, ok: 3 };
    out.sort(function (a, b) { return order[a.sev] - order[b.sev]; });
    a11y.list = out; a11y.inv = inv;
    return out;
  }
  function a11yScore() { return scoreOf(a11y.list); }
  function a11yGain(f) { return Math.round((f.w || 0) * (1 - (f.p != null ? f.p : PTS[f.sev]))); }
  // i consigli, dal più importante (quello che fa guadagnare più punti), ognuno con gli esempi pronti
  function a11yAdviceHtml(L) {
    var sel = (ux.cat || {}).a11y, items0 = sel ? L.filter(function (f) { return f.cat === sel; }) : L;
    var todo = items0.filter(function (f) { return f.sev !== 'ok'; }).sort(function (a, b) { return a11yGain(b) - a11yGain(a); }), ok = items0.filter(function (f) { return f.sev === 'ok'; });
    var html = '';
    if (todo.length) {
      html += '<h4>Come migliorare, dal più importante (' + todo.length + ')</h4><p class="sub">Con il testo già pronto, ricavato dalla pagina: controllalo prima di usarlo. Clicca un esempio per vederlo nella pagina e copiarlo.</p><ol class="adv">';
      todo.forEach(function (f, n) {
        var i = L.indexOf(f), rows = '';
        if (f.sug) {
          f.els.slice(0, 4).forEach(function (el, k) {
            var s = f.sug[k];
            rows += '<li><button type="button" data-g="' + i + ':' + k + '">' + elThumb(el) + '<span><span class="el">' + esc(elDesc(el)) + '</span>' +
              (s ? '<code>' + esc(s) + '</code>' : '<i class="nog">Non so indovinarlo: scrivilo tu</i>') + '</span></button></li>';
          });
          if (f.els.length > 4) rows += '<li class="more">+ altri ' + (f.els.length - 4) + ': clicca il titolo per vederli uno per uno</li>';
        } else if (f.code) rows += '<li><button type="button" data-c="' + i + '"><span class="th ic">📋</span><span><span class="el">Da aggiungere alla pagina</span><code>' + esc(f.code) + '</code></span></button></li>';
        html += '<li class="ad"><button type="button" class="fl" data-y="' + i + '"><span class="dot" style="background:' + SEV[f.sev].c + '"></span><span class="t">' + (n + 1) + '. ' + esc(f.title) + (f.els.length ? ' ↗' : '') + '</span>' +
          '<span class="gain" title="punti che guadagni sistemandolo">+' + a11yGain(f) + '</span></button><p class="why">' + esc(f.detail) + '</p>' +
          (rows ? '<ul class="sg">' + rows + '</ul>' : '') + (f.where ? '<p class="wh">💡 ' + esc(f.where) + '</p>' : '') + '</li>';
      });
      html += '</ol>';
    } else html += '<p class="sub">' + (sel ? 'In «' + esc(sel) + '» non c\'è niente da sistemare. 👍' : 'Niente da sistemare: chi non vede può usare la pagina senza problemi. 👍') + '</p>';
    if (ok.length) html += '<details' + (sel ? ' open' : '') + '><summary>' + SEV.ok.h + ' (' + ok.length + ')</summary><ul>' + ok.map(function (f) {
      return '<li><button type="button" class="fl" data-y="' + L.indexOf(f) + '"><span class="dot" style="background:' + SEV.ok.c + '"></span><span class="t">' + esc(f.title) + '</span><span class="pt">' + (f.w || 0) + '/' + (f.w || 0) + '</span><small>' + esc(f.detail) + '</small></button></li>';
    }).join('') + '</ul></details>';
    return html;
  }
  function elThumb(el) {
    if (el.tagName === 'IMG') return '<img class="th" src="' + esc(el.currentSrc || el.src || '') + '" alt="" loading="lazy">';
    return '<span class="th ic">' + ({ A: '🔗', BUTTON: '🔘', INPUT: '✏️', TEXTAREA: '✏️', SELECT: '✏️', IFRAME: '🪟', VIDEO: '🎬', AUDIO: '🔈' }[el.tagName] || (/^H\d$/.test(el.tagName) ? el.tagName : '▫️')) + '</span>';
  }
  function elDesc(el) {
    var tag = el.tagName, t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (tag === 'IMG') return fileName(el.currentSrc || el.src) + (el.getAttribute('alt') ? ' · ora: «' + shortTxt(el.alt, 40) + '»' : '');
    if (tag === 'A') { var h = el.getAttribute('href') || ''; return (t ? '«' + shortTxt(t, 30) + '»' : 'icona') + ' → ' + shortTxt(h.replace(/^https?:\/\/(www\.)?/, ''), 40); }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return 'campo ' + (el.placeholder ? '«' + shortTxt(el.placeholder, 30) + '»' : el.name || el.type || tag.toLowerCase());
    if (tag === 'IFRAME') return 'frame ' + shortTxt((el.getAttribute('src') || '').replace(/^https?:\/\/(www\.)?/, ''), 45);
    return t ? '«' + shortTxt(t, 45) + '»' : tag.toLowerCase();
  }
  // tutti i testi che descrivono: immagini con il loro alt, icone e bottoni con il nome nascosto, campi, frame e video
  function a11yInvHtml() {
    var inv = a11y.inv || { imgs: [], ctrls: [], fields: [], media: [] }, html = '';
    a11y.flat = [];
    function row(el, thumb, label) { var k = a11y.flat.push(el) - 1; return '<li><button type="button" class="iv" data-v="' + k + '">' + thumb + '<span class="ivt">' + label + '</span></button></li>'; }
    function prop(s, pre) { return s ? ' <small>proposta: ' + esc(pre + s) + '</small>' : ''; }
    html += '<h4>Tutti i testi che descrivono</h4><p class="sub">Quello che sente chi usa lo screen reader al posto di immagini, icone e campi, con una proposta dove manca.</p>';
    var shownImgs = inv.imgs.filter(function (i) { return !i.hidden; }), miss = shownImgs.filter(function (i) { return i.alt === null; }).length;
    html += '<details class="inv"><summary>🖼️ Immagini (' + shownImgs.length + ')' + (miss ? ' · ' + miss + ' senza descrizione' : '') + '</summary><ul>' + shownImgs.slice(0, 80).map(function (i) {
      var lab = i.alt === null ? '<b class="no">❌ Nessuna descrizione</b>' + prop(i.sug, '') : i.alt === '' ? '<i class="deco">Decorativa (alt vuoto): lo screen reader la salta</i>' : '«' + esc(shortTxt(i.alt, 140)) + '»';
      return row(i.el, '<img class="th" src="' + esc(i.src || '') + '" alt="" loading="lazy">', lab + (i.link ? ' <em class="lk">link</em>' : ''));
    }).join('') + '</ul></details>';
    if (inv.ctrls.length) html += '<details class="inv"><summary>🔗 Icone, link e bottoni con il nome nascosto (' + inv.ctrls.length + ')</summary><ul>' + inv.ctrls.slice(0, 60).map(function (c) {
      return row(c.el, '<span class="th ic">' + (c.el.tagName === 'A' ? '🔗' : '🔘') + '</span>', c.name ? '«' + esc(shortTxt(c.name, 100)) + '»' + (c.visible ? ' <small>sullo schermo: «' + esc(shortTxt(c.visible, 40)) + '»</small>' : ' <small>solo icona</small>') : '<b class="no">❌ Senza nome</b>' + prop(c.sug, ''));
    }).join('') + '</ul></details>';
    if (inv.fields.length) html += '<details class="inv"><summary>📝 Campi dei moduli (' + inv.fields.length + ')</summary><ul>' + inv.fields.map(function (f) {
      return row(f.el, '<span class="th ic">✏️</span>', (f.name ? '«' + esc(shortTxt(f.name, 80)) + '»' : '<b class="no">❌ Senza etichetta</b>' + prop(f.sug, '')) + ' <small>' + esc(f.type) + '</small>');
    }).join('') + '</ul></details>';
    if (inv.media.length) html += '<details class="inv"><summary>🎬 Frame e video (' + inv.media.length + ')</summary><ul>' + inv.media.map(function (m) {
      return row(m.el, '<span class="th ic">' + (m.kind === 'video' ? '🎬' : '🪟') + '</span>', (m.name ? '«' + esc(shortTxt(m.name, 80)) + '»' : '<b class="no">❌ Senza titolo</b>' + prop(m.sug, '')) + (m.kind === 'video' ? ' <small>' + (m.caps ? 'con sottotitoli' : 'senza sottotitoli') + '</small>' : ''));
    }).join('') + '</ul></details>';
    return html;
  }

  // pannello del report
  var uxPanel = mk('div');
  uxPanel.id = '__nimblu_ux';
  css.textContent +=
    '#__nimblu_ux{position:fixed;top:16px;z-index:' + Z + ';width:340px;max-width:calc(100vw - 32px);max-height:72vh;overflow:auto;display:none;background:#f5f8fd;color:#22314f;border:2px solid #2d3e63;border-radius:14px;box-shadow:0 12px 34px rgba(30,45,80,.28);font:500 13px/1.45 system-ui,-apple-system,sans-serif;padding:12px 12px 8px;text-align:left;letter-spacing:0;text-transform:none}' +
    '#__nimblu_ux *{box-sizing:border-box;letter-spacing:0;text-transform:none}' +
    '#__nimblu_ux .hd{display:flex;align-items:center;gap:10px;margin:0 0 4px}' +
    '#__nimblu_ux .hd b{font:700 15px/1.2 system-ui,-apple-system,sans-serif;flex:1}' +
    '#__nimblu_ux .score{font:700 13px/1 system-ui,sans-serif;padding:5px 8px;border-radius:999px;color:#fff}' +
    '#__nimblu_ux .sub{margin:0 0 10px;font-size:11.5px;color:#5b6f96}' +
    '#__nimblu_ux h4{margin:10px 0 4px;font:700 11px/1.3 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#5b6f96}' +
    '#__nimblu_ux ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}' +
    '#__nimblu_ux button{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:10px 1fr;gap:2px 8px;width:100%;padding:7px 8px;border-radius:9px;background:#fff;border:1px solid #dbe4f3}' +
    '#__nimblu_ux button:hover{border-color:#4f74b3}' +
    '#__nimblu_ux button:focus-visible{outline:2px solid #4f74b3}' +
    '#__nimblu_ux .dot{width:10px;height:10px;border-radius:50%;margin-top:4px}' +
    '#__nimblu_ux .t{font:600 13px/1.35 system-ui,-apple-system,sans-serif;color:#22314f}' +
    '#__nimblu_ux small{grid-column:2;font:500 12px/1.4 system-ui,sans-serif;color:#4a5d82}' +
    '#__nimblu_ux .x{display:block;width:auto;padding:4px 8px;background:transparent;border:0;font:600 16px/1 system-ui,sans-serif;color:#5b6f96}' +
    '#__nimblu_ux .re{display:block;width:auto;margin:10px 0 2px;padding:6px 10px;background:#e2eaf7;border:0;font:600 12px/1.2 system-ui,sans-serif;color:#22314f}' +
    '#__nimblu_ux .ask{display:block;width:100%;margin:0 0 8px;padding:8px 10px;background:#4f74b3;border:0;color:#fff;text-align:center;font:700 13px/1.2 system-ui,-apple-system,sans-serif}' +
    '#__nimblu_ux .ask:hover{background:#3d5f99}' +
    '#__nimblu_ux .ai{background:#fbf7ff;border:1.5px solid #c9b8ef;border-radius:12px;padding:8px;margin:0 0 6px}' +
    '#__nimblu_ux .ai h4{margin:0 0 6px;color:#6a4fb3}' +
    '#__nimblu_ux .ai .q{margin:0 0 6px;font-size:11.5px;color:#5b6f96}' +
    '#__nimblu_ux .n{width:20px;height:20px;border-radius:50%;background:#6a4fb3;color:#fff;font:700 11px/20px system-ui,sans-serif;text-align:center}' +
    '#__nimblu_ux .ai button{grid-template-columns:20px 1fr}' +
    '#__nimblu_ux .how{grid-column:2;font:600 12px/1.4 system-ui,sans-serif;color:#22314f}' +
    '#__nimblu_ux .tabs{display:grid;grid-template-columns:.8fr .9fr 1.3fr;gap:4px;padding:3px;background:#e2eaf7;border-radius:11px;margin:4px 0 8px}' +
    '#__nimblu_ux .tabs button{display:flex;align-items:center;justify-content:center;gap:6px;grid-template-columns:none;padding:6px 4px;border:0;background:transparent;font:700 12px/1.2 system-ui,-apple-system,sans-serif;color:#22314f}' +
    '#__nimblu_ux .tabs button[aria-pressed=true]{background:#fff;box-shadow:0 1px 3px rgba(30,45,80,.15)}' +
    '#__nimblu_ux .tabs .score{padding:3px 6px;font-size:11px}' +
    '#__nimblu_ux .serp{background:#fff;border:1px solid #dbe4f3;border-radius:10px;padding:9px 10px;margin:0 0 8px;font-family:arial,sans-serif}' +
    '#__nimblu_ux .su{font:13px/1.3 arial,sans-serif;color:#4d5156;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#__nimblu_ux .st{font:18px/1.3 arial,sans-serif;color:#1a0dab;margin:2px 0}' +
    '#__nimblu_ux .sd{font:13px/1.45 arial,sans-serif;color:#4d5156}' +
    '#__nimblu_ux .sd.none{font-style:italic;color:#b05a00}' +
    '#__nimblu_ux .chips,#__nimblu_ux .kw{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}' +
    '#__nimblu_ux .chips span,#__nimblu_ux .kw span{padding:3px 7px;border-radius:999px;background:#e8eef9;font:600 11px/1.3 system-ui,sans-serif;color:#2d3e63}' +
    '#__nimblu_ux .kw span{background:#fff;border:1px solid #dbe4f3;cursor:help}' +
    '#__nimblu_ux .kw b{color:#4f74b3}' +
    '#__nimblu_ux .kw.ph span{background:#f6f1ff;border-color:#e0d4f7}' +
    '#__nimblu_ux .ol{gap:2px}' +
    '#__nimblu_ux .ol button{display:flex;align-items:center;gap:6px;padding:4px 6px;border:0;background:transparent;border-radius:6px}' +
    '#__nimblu_ux .ol button:hover{background:#fff}' +
    '#__nimblu_ux .lv{flex:none;width:22px;text-align:center;border-radius:5px;font:700 10px/16px system-ui,sans-serif;color:#fff;background:#8a9bc0}' +
    '#__nimblu_ux .lv1{background:#2d3e63}#__nimblu_ux .lv2{background:#4f74b3}#__nimblu_ux .lv3{background:#7f9bd0}' +
    '#__nimblu_ux .ht{font:500 12px/1.35 system-ui,sans-serif;color:#22314f}' +
    '#__nimblu_ux .ht em{font-style:normal;color:#e08a1e}' +
    '#__nimblu_ux .cats{display:grid;gap:3px;margin:0 0 8px}' +
    '#__nimblu_ux .cats button{display:grid;grid-template-columns:18px 98px 1fr 26px;align-items:center;gap:6px;padding:5px 7px;border:1px solid #e3eaf6;background:#fff}' +
    '#__nimblu_ux .cats button[aria-pressed=true]{border-color:#4f74b3;box-shadow:0 0 0 1px #4f74b3}' +
    '#__nimblu_ux .ci{font-size:13px;text-align:center}' +
    '#__nimblu_ux .cn{font:600 12px/1.2 system-ui,-apple-system,sans-serif;color:#22314f}' +
    '#__nimblu_ux .cb{height:7px;border-radius:4px;background:#e8eef8;overflow:hidden}' +
    '#__nimblu_ux .cb i{display:block;height:100%;border-radius:4px}' +
    '#__nimblu_ux .cats b{font:800 12px/1 system-ui,sans-serif;text-align:right}' +
    '#__nimblu_ux .fl{grid-template-columns:10px 1fr auto}' +
    '#__nimblu_ux .fl small{grid-column:2 / 4}' +
    '#__nimblu_ux .pt{align-self:start;margin-top:1px;padding:0 5px;border-radius:6px;background:#eef2f9;font:700 10.5px/1.6 system-ui,sans-serif;font-style:normal;color:#4a5d82;font-variant-numeric:tabular-nums}' +
    '#__nimblu_ux details{margin:10px 0 0}' +
    '#__nimblu_ux summary{cursor:pointer;margin:0 0 4px;font:700 11px/1.3 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#2f9e6a}' +
    '#__nimblu_ux .tabs button{padding:6px 3px;gap:4px;white-space:nowrap}' +
    '#__nimblu_ux .adv{list-style:none;margin:0;padding:0;display:grid;gap:6px}' +
    '#__nimblu_ux .ad{background:#fff;border:1px solid #dbe4f3;border-radius:10px;padding:1px 1px 8px}' +
    '#__nimblu_ux .ad>button{border:0;background:transparent}' +
    '#__nimblu_ux .gain{align-self:start;margin-top:1px;padding:0 6px;border-radius:6px;background:#e3f4ea;font:800 11px/1.6 system-ui,sans-serif;color:#1f7a4c;font-variant-numeric:tabular-nums}' +
    '#__nimblu_ux .why{margin:0 9px 6px 26px;font:500 12px/1.4 system-ui,sans-serif;color:#4a5d82}' +
    '#__nimblu_ux .sg{margin:0 7px 0 24px;gap:3px}' +
    '#__nimblu_ux .sg button{grid-template-columns:34px 1fr;align-items:center;gap:7px;padding:4px 6px;background:#f5f8fd;border:1px solid #e3eaf6}' +
    '#__nimblu_ux .sg .th{width:34px;height:26px;font-size:13px}' +
    '#__nimblu_ux .sg .el{display:block;font:500 11px/1.3 system-ui,sans-serif;color:#5b6f96;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px}' +
    '#__nimblu_ux .sg code{display:block;font:600 11.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f6b45;overflow-wrap:anywhere;white-space:normal}' +
    '#__nimblu_ux .sg .nog{display:block;font:500 11.5px/1.35 system-ui,sans-serif;color:#b05a00}' +
    '#__nimblu_ux .sg .more{font:500 11px/1.3 system-ui,sans-serif;color:#5b6f96;padding:0 4px}' +
    '#__nimblu_ux .wh{margin:6px 9px 0 26px;font:500 11.5px/1.4 system-ui,sans-serif;color:#6a4fb3}' +
    '#__nimblu_ux .iv{grid-template-columns:44px 1fr;align-items:center;gap:8px;padding:5px 6px}' +
    '#__nimblu_ux .th{width:44px;height:34px;border-radius:6px;object-fit:cover;background:#e8eef8;display:block}' +
    '#__nimblu_ux .th.ic{display:flex;align-items:center;justify-content:center;font-size:16px}' +
    '#__nimblu_ux .ivt{font:500 12px/1.35 system-ui,-apple-system,sans-serif;color:#22314f;overflow-wrap:anywhere}' +
    '#__nimblu_ux .ivt small{display:block;font-size:11px;color:#5b6f96}' +
    '#__nimblu_ux .ivt .no{color:#d64545}#__nimblu_ux .ivt .deco{color:#5b6f96}' +
    '#__nimblu_ux .ivt .lk{font-style:normal;font-size:10.5px;padding:0 4px;border-radius:4px;background:#e8eef9;color:#4f74b3}' +
    '#__nimblu_ux .inv summary{color:#22314f}' +
    '#__nimblu_ux .lnk{display:inline;padding:0;border:0;background:none;color:#4f74b3;text-decoration:underline;font:600 11.5px/1 system-ui,sans-serif}';
  var SEV = {
    error: { h: 'Da sistemare', c: '#d64545' },
    warn: { h: 'Da migliorare', c: '#e08a1e' },
    tip: { h: 'Consigli', c: '#4f74b3' },
    ok: { h: 'Va bene', c: '#2f9e6a' }
  };
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function scoreBadge(sc) { return '<span class="score" style="background:' + (sc >= 80 ? '#2f9e6a' : sc >= 55 ? '#e08a1e' : '#d64545') + '">' + sc + '</span>'; }
  function renderUx() {
    var tab = ux.tab === 'seo' || ux.tab === 'a11y' ? ux.tab : 'ux';
    var html = '<div class="hd"><b>🔍 Controllo della pagina</b><button type="button" class="x" data-ux="close" aria-label="Chiudi">✕</button></div>' +
      '<div class="tabs"><button type="button" data-tab="ux" aria-pressed="' + (tab === 'ux') + '" title="Usabilità e conversione">UX ' + scoreBadge(uxScore()) + '</button>' +
      '<button type="button" data-tab="seo" aria-pressed="' + (tab === 'seo') + '">SEO ' + scoreBadge(seoScore()) + '</button>' +
      '<button type="button" data-tab="a11y" aria-pressed="' + (tab === 'a11y') + '" title="Per chi è cieco o ipovedente e usa lo screen reader">Non vedenti ' + scoreBadge(a11yScore()) + '</button></div>';
    if (tab === 'a11y') {
      html += '<p class="sub">Chi è cieco o ipovedente usa lo <b>screen reader</b>, che gli legge la pagina: per lui conta solo quello che è scritto, anche dove non si vede. Ecco cosa cambiare.</p>' +
        (opts.ai && opts.aiPage !== false ? '<button type="button" class="ask" data-ux="ask">✨ Chiedi all\'AI altri consigli per chi non vede</button>' : '') +
        catsHtml(tab, a11y.list || []) + a11yAdviceHtml(a11y.list || []) + a11yInvHtml() +
        '<button type="button" class="re" data-ux="again">↻ Controlla di nuovo</button>';
      uxPanel.innerHTML = html;
      return;
    }
    var list = ux.list || [];
    if (ux.ai && ux.ai.tips.length) {
      html += '<div class="ai"><h4>✨ I consigli di Nimblu</h4><p class="q">Hai chiesto: «' + esc(shortTxt(ux.ai.q, 90)) + '»</p><ul>';
      ux.ai.tips.forEach(function (t, i) {
        var ref = /^P(\d+)$/.exec(t.rif || ''), f = ref && ux.aiRefs ? ux.aiRefs[+ref[1] - 1] : null;
        html += '<li><button type="button" data-ai="' + i + '"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(t.titolo) + (f && f.els.length ? ' ↗' : '') + '</span>' +
          (t.perche ? '<small>' + esc(t.perche) + '</small>' : '') + (t.come ? '<span class="how">→ ' + esc(t.come) + '</span>' : '') + '</button></li>';
      });
      html += '</ul></div>';
    }
    if (opts.ai && opts.aiPage !== false) html += '<button type="button" class="ask" data-ux="ask">✨ ' + (tab === 'seo' ? 'Chiedi all\'AI come migliorare la SEO' : ux.ai ? 'Chiedi altri consigli all\'AI' : 'Chiedi all\'AI come migliorarla') + '</button>';
    var L = tab === 'seo' ? seo.list || [] : list;
    html += catsHtml(tab, L);
    if (tab === 'seo') html += '<p class="sub">Così potrebbe comparire nei risultati di Google:</p>' + serpHtml();
    html += findingsHtml(tab, L);
    if (tab === 'seo') html += renderSeo();
    else html += '<p class="sub">Controlli automatici con regole fisse: aiutano a trovare i problemi più comuni, ma non sostituiscono un test con persone vere.</p>';
    html += '<button type="button" class="re" data-ux="again">↻ Controlla di nuovo</button>';
    uxPanel.innerHTML = html;
  }
  // barre dei punteggi per categoria (cliccandone una si vedono solo i suoi controlli)
  function catsHtml(tab, L) {
    var sel = (ux.cat || {})[tab];
    var html = '<div class="cats">' + catScores(tab).map(function (c) {
      var n = L.filter(function (f) { return f.cat === c.name; }), ok = n.filter(function (f) { return f.sev === 'ok'; }).length;
      return '<button type="button" data-cat="' + esc(c.name) + '" aria-pressed="' + (sel === c.name) + '" title="' + ok + ' controlli superati su ' + n.length + '">' +
        '<span class="ci">' + c.icon + '</span><span class="cn">' + esc(c.name) + '</span><span class="cb"><i style="width:' + c.sc + '%;background:' + scoreCol(c.sc) + '"></i></span><b style="color:' + scoreCol(c.sc) + '">' + c.sc + '</b></button>';
    }).join('') + '</div>';
    if (sel) html += '<p class="sub">Solo «' + esc(sel) + '» · <button type="button" class="lnk" data-cat="">mostra tutto</button></p>';
    return html;
  }
  // elenco dei controlli: problemi e consigli aperti, "Va bene" chiuso; accanto a ogni voce i punti presi su quelli che vale
  function findingsHtml(tab, L) {
    var sel = (ux.cat || {})[tab], items0 = sel ? L.filter(function (f) { return f.cat === sel; }) : L, html = '';
    var passed = items0.filter(function (f) { return f.sev === 'ok'; }).length;
    html += '<p class="sub">' + passed + ' controlli superati su ' + items0.length + ' · accanto a ogni voce i punti presi su quelli che vale.</p>';
    ['error', 'warn', 'tip', 'ok'].forEach(function (sev) {
      var items = items0.filter(function (f) { return f.sev === sev; });
      if (!items.length) return;
      var body = '<ul>' + items.map(function (f) {
        return '<li><button type="button" class="fl" data-' + (tab === 'seo' ? 's' : tab === 'a11y' ? 'y' : 'i') + '="' + L.indexOf(f) + '"><span class="dot" style="background:' + SEV[sev].c + '"></span>' +
          '<span class="t">' + esc(f.title) + (f.els.length ? ' ↗' : '') + '</span><span class="pt" title="punti presi su quelli che vale">' + Math.round((f.w || 0) * (f.p != null ? f.p : PTS[f.sev])) + '/' + (f.w || 0) + '</span><small>' + esc(f.detail) + '</small></button></li>';
      }).join('') + '</ul>';
      html += sev === 'ok' ? '<details' + (sel ? ' open' : '') + '><summary>' + SEV[sev].h + ' (' + items.length + ')</summary>' + body + '</details>' : '<h4>' + SEV[sev].h + ' (' + items.length + ')</h4>' + body;
    });
    return html;
  }
  function openUx(silent, tab) {
    if (tab) ux.tab = tab;
    audit(); seoAudit(); a11yAudit(); renderUx();
    uxPanel.style.display = 'block';
    var left = M.x - scrollX > W / 2;
    uxPanel.style.left = left ? '16px' : 'auto';
    uxPanel.style.right = left ? 'auto' : '16px';
    closeMenu();
    if (silent) return;
    var tk = ux.tab === 'seo' || ux.tab === 'a11y' ? ux.tab : 'ux', isSeo = tk === 'seo', sc = scoreOf(tabList(tk)), weak = catScores(tk).sort(function (a, b) { return a.sc - b.sc; })[0];
    if (tk === 'a11y') {
      var top = (a11y.list || []).filter(function (f) { return f.sev !== 'ok'; }).sort(function (a, b) { return a11yGain(b) - a11yGain(a); })[0];
      say('Per chi non vede: ' + sc + '/100. ' + (top ? 'Primo consiglio: ' + top.title.charAt(0).toLowerCase() + top.title.slice(1) + (top.sug && top.sug[0] ? ', per esempio ' + top.sug[0] : top.code ? ': ' + top.code : '') + '. Gli altri sono nel pannello, con i testi pronti.' : 'Si usa bene anche senza vederla! ♿'));
    }
    else say((isSeo ? 'SEO ' : 'UX ') + sc + '/100' + (weak && weak.sc < 80 ? ': il punto più debole è «' + weak.name + '» (' + weak.sc + '). Clicca una voce e ti porto lì.' : isSeo ? ': per la SEO la pagina è messa bene! 🔎' : ': la pagina mi sembra in ordine! 👍'));
    happy();
  }
  function closeUx() { uxPanel.style.display = 'none'; ux.focus = null; }
  // porta la pagina sull'elemento, lo evidenzia e Nimblu ci salta sopra a spiegarlo
  function pointAt(f) {
    if (!f) return;
    var k = f.els.length ? (ux.cursor[f.title] || 0) % f.els.length : -1;
    ux.cursor[f.title] = k + 1;
    var el = k >= 0 ? f.els[k] : null;
    var more = f.els.length > 1 ? ' (' + (k + 1) + ' di ' + f.els.length + ')' : '';
    if (!el) { say(f.title + ': ' + f.detail); return; }
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
    ux.focus = { el: el, sev: f.sev }; ux.focusUntil = frame + 420;
    say(f.title + more + (f.sug && f.sug[k] ? '. Prova così: ' + f.sug[k] : f.detail ? '. ' + f.detail : ''));
    later(function () {
      needRefresh = true; refresh();
      var r = rectOf(el);
      if (!r || !M.att || /^(drag|fall)$/.test(M.mode)) return;
      M.plan = []; M.follow = 0;
      if (r.r - r.l > 2 * R && r.t > scrollY + 50 && r.t < scrollY + H - 20) jumpTo(el);
      else goWall(r.l - scrollX < W / 2 ? -1 : 1, clamp(r.t - scrollY, 80, H - 40));
    }, 700);
  }
  function uxClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var a = b.getAttribute('data-ux');
    if (a === 'close') { closeUx(); return; }
    if (a === 'again') { audit(); seoAudit(); a11yAudit(); renderUx(); say('Ricontrollato!'); return; }
    var tb = b.getAttribute('data-tab');
    if (tb) { ux.tab = tb; renderUx(); return; }
    var ct = b.getAttribute('data-cat');
    if (ct != null) { var tk = ux.tab === 'seo' || ux.tab === 'a11y' ? ux.tab : 'ux'; ux.cat = ux.cat || {}; ux.cat[tk] = ct && ux.cat[tk] !== ct ? ct : null; renderUx(); return; }
    var si = b.getAttribute('data-s');
    if (si != null && seo.list) { pointAt(seo.list[+si]); return; }
    var yi = b.getAttribute('data-y');
    if (yi != null && a11y.list) { pointAt(a11y.list[+yi]); return; }
    // esempio pronto: porta sull'elemento e copia il testo
    var gi = b.getAttribute('data-g'), ci = b.getAttribute('data-c');
    if ((gi != null || ci != null) && a11y.list) {
      var gp = (gi || ci).split(':'), gf = a11y.list[+gp[0]], gk = +(gp[1] || 0), code = gf && (gi != null ? gf.sug && gf.sug[gk] : gf.code);
      if (!gf) return;
      if (gi != null && gf.els[gk]) pointAt({ title: gf.title, detail: code ? 'Prova così: ' + code : 'Qui non so indovinare il testo giusto: scrivilo tu.', els: [gf.els[gk]], sev: gf.sev });
      else say(gf.title + (code ? '. Aggiungi: ' + code : ''));
      if (code) copyText(code);
      return;
    }
    var vi = b.getAttribute('data-v');
    if (vi != null && a11y.flat[+vi]) {
      var ve = a11y.flat[+vi], vn = ve.tagName === 'IMG' ? (ve.hasAttribute('alt') ? (ve.alt.trim() ? 'Lo screen reader dice: «Immagine, ' + ve.alt.trim() + '»' : 'Decorativa: lo screen reader la salta') : 'Nessuna descrizione: lo screen reader dice «' + fileName(ve.currentSrc || ve.src) + '»') : 'Lo screen reader dice: «' + (accName(ve) || 'senza nome') + '»';
      pointAt({ title: vn, detail: '', els: [ve], sev: /Nessuna|senza nome/.test(vn) ? 'error' : 'ok' });
      return;
    }
    var hi = b.getAttribute('data-h');
    if (hi != null && seo.info && seo.info.outline[+hi]) { var oh = seo.info.outline[+hi]; pointAt({ title: 'H' + oh.lv, detail: '«' + shortTxt(oh.t, 80) + '»' + (oh.skip ? ' — salta un livello rispetto al titolo prima' : ''), els: [oh.el], sev: oh.skip ? 'warn' : 'tip' }); return; }
    if (a === 'ask' && ux.tab === 'a11y') { sendChat('Come posso rendere questa pagina più facile da usare per chi non vede e usa lo screen reader? Dammi consigli pratici, con i testi da scrivere.', true); return; }
    if (a === 'ask' && ux.tab === 'seo') { sendChat('Come posso migliorare la SEO di questa pagina? Guarda titolo, meta description, H1, H2, H3, testi, parole chiave e immagini.', true); return; }
    if (a === 'ask') { sendChat(ux.ai ? 'Dammi altri consigli per migliorare questa pagina, diversi da quelli di prima.' : 'Quali sono le cose più importanti da migliorare in questa pagina per farla convertire di più?', true); return; }
    var ai = b.getAttribute('data-ai');
    if (ai != null && ux.ai) {
      var tip = ux.ai.tips[+ai], ref = /^P(\d+)$/.exec(tip.rif || ''), f = ref && ux.aiRefs ? ux.aiRefs[+ref[1] - 1] : null;
      if (f && f.els.length) { pointAt(f); later(function () { say(tip.titolo + ': ' + tip.come); }, 1600); }
      else say(tip.titolo + ': ' + tip.come);
      return;
    }
    var i = b.getAttribute('data-i');
    if (i != null) pointAt(ux.list[+i]);
  }
  uxPanel.addEventListener('click', uxClick);
  uxPanel.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') closeUx(); });
  // copia negli appunti (serve una pagina https); se riesce Nimblu lo dice
  function copyText(t) {
    function done() { if (M.say && M.say.indexOf(t) >= 0 && M.say.indexOf('📋') < 0) M.say += ' 📋 Copiato!'; }
    // ripiego per le pagine dove gli appunti moderni non sono permessi
    function old() {
      var ta = document.createElement('textarea'), act = document.activeElement;
      ta.setAttribute('data-mascot', ''); ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) done(); } catch (e) {}
      ta.remove();
      if (act && act.focus) try { act.focus({ preventScroll: true }); } catch (e) {}
    }
    old();
    if (M.say.indexOf('📋') < 0 && navigator.clipboard) try { navigator.clipboard.writeText(t).then(done, function () {}); } catch (e) {}
  }
  // ogni tanto, da solo, segnala un problema che ha vicino
  function uxNearby() {
    if (!prefs.tips || !ux.list || frame - ux.lastPoint < 5400) return false;
    var cand = ux.list.filter(function (f) {
      if (f.sev === 'ok' || !f.els.length) return false;
      var r = rectOf(f.els[0]);
      return r && r.t > scrollY + 40 && r.b < scrollY + H - 20;
    });
    if (!cand.length) return false;
    ux.lastPoint = frame;
    var f = cand[0], el = f.els[0];
    ux.focus = { el: el, sev: f.sev }; ux.focusUntil = frame + 300;
    say('Psst: ' + f.title.charAt(0).toLowerCase() + f.title.slice(1) + '. ' + f.detail);
    curious();
    return true;
  }
  function uxAutoHint() {
    if (ux.hinted || !prefs.tips || frame < 480 || !M.att || level === 'angolo' || level === 'calmo' || M.zoom || M.ball || F) return;
    ux.hinted = true;
    audit();
    var e = uxCount('error'), w = uxCount('warn');
    if (e + w) { say('Ho dato un\'occhiata alla pagina: ' + (e + w) + (e + w === 1 ? ' cosa si può' : ' cose si possono') + ' migliorare. Cliccami e premi 🔍'); curious(); }
  }
  function drawFocus() {
    if (!ux.focus || frame > ux.focusUntil) return;
    var r = rectOf(ux.focus.el);
    if (!r) return;
    var c = SEV[ux.focus.sev] ? SEV[ux.focus.sev].c : '#4f74b3', p = 4 + Math.sin(frame * 0.15) * 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (ux.focusUntil - frame) / 30);
    ctx.lineWidth = 3; ctx.strokeStyle = c; ctx.setLineDash([8, 5]); ctx.lineDashOffset = -frame * 0.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.l - p, r.t - p, r.r - r.l + 2 * p, r.b - r.t + 2 * p, 8); else ctx.rect(r.l - p, r.t - p, r.r - r.l + 2 * p, r.b - r.t + 2 * p);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c; ctx.globalAlpha *= 0.08; ctx.fill();
    ctx.restore();
  }

  // ---------- cronologia della chat ----------
  // Tutti i messaggi scambiati con Nimblu (anche le risposte dell'AI e i suoi consigli), salvati solo in locale:
  // nell'estensione in chrome.storage (opts.history, comune a tutti i siti), altrimenti nel localStorage.
  var LOG_MAX = 300, chatLog = [], chatOpen = false;
  var logStore = opts.history || {
    get: function (cb) { var l = []; try { l = JSON.parse(localStorage.getItem('__nimblu_log') || '[]'); } catch (e) {} cb(Array.isArray(l) ? l : []); },
    add: function (e, cb) {
      logStore.get(function (l) {
        l.push(e);
        while (l.length > LOG_MAX) l.shift();
        try { localStorage.setItem('__nimblu_log', JSON.stringify(l)); } catch (x) {}
        if (cb) cb(l);
      });
    },
    clear: function (cb) { try { localStorage.removeItem('__nimblu_log'); } catch (e) {} if (cb) cb([]); }
  };
  logStore.get(function (l) { chatLog = Array.isArray(l) ? l : []; renderChatList(); });
  function pageKey() { return (location.hostname || 'file') + location.pathname.slice(0, 60); }
  function logMsg(who, text, extra) {
    var e = { t: Date.now(), who: who, text: String(text).slice(0, 2000), page: pageKey() };
    if (extra && extra.tips) e.tips = extra.tips.map(function (t) { return { titolo: t.titolo, come: t.come }; });
    chatLog.push(e);
    while (chatLog.length > LOG_MAX) chatLog.shift();
    renderChatList();
    logStore.add(e, function (l) { if (Array.isArray(l)) { chatLog = l; renderChatList(); } });
  }
  var chatPanel = mk('div');
  chatPanel.id = '__nimblu_chat';
  chatPanel.setAttribute('role', 'dialog');
  chatPanel.setAttribute('aria-label', 'Cronologia della chat con Nimblu');
  css.textContent +=
    '#__nimblu_chat{position:fixed;bottom:16px;z-index:' + Z + ';width:350px;max-width:calc(100vw - 32px);height:min(540px,75vh);display:none;flex-direction:column;background:#f5f8fd;color:#22314f;border:2px solid #2d3e63;border-radius:14px;box-shadow:0 12px 34px rgba(30,45,80,.28);font:500 13px/1.45 system-ui,-apple-system,sans-serif;text-align:left;letter-spacing:0;text-transform:none;overflow:hidden}' +
    '#__nimblu_chat.open{display:flex}' +
    '#__nimblu_chat *{box-sizing:border-box;letter-spacing:0;text-transform:none}' +
    '#__nimblu_chat .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #dbe4f3;background:#fff}' +
    '#__nimblu_chat .hd b{flex:1;font:700 15px/1.2 system-ui,-apple-system,sans-serif}' +
    '#__nimblu_chat button{all:unset;box-sizing:border-box;cursor:pointer}' +
    '#__nimblu_chat button:focus-visible{outline:2px solid #4f74b3;outline-offset:1px;border-radius:6px}' +
    '#__nimblu_chat .x{padding:2px 6px;font:600 16px/1 system-ui,sans-serif;color:#5b6f96}' +
    '#__nimblu_chat .list{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px;overscroll-behavior:contain}' +
    '#__nimblu_chat .day{align-self:center;font:600 11px/1 system-ui,sans-serif;color:#5b6f96;background:#e2eaf7;border-radius:999px;padding:4px 10px;margin:6px 0 2px}' +
    '#__nimblu_chat .m{max-width:86%;padding:7px 10px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '#__nimblu_chat .m.tu{align-self:flex-end;background:#4f74b3;color:#fff;border-bottom-right-radius:4px}' +
    '#__nimblu_chat .m.ni{align-self:flex-start;background:#fff;border:1px solid #dbe4f3;border-bottom-left-radius:4px}' +
    '#__nimblu_chat .m time{display:block;font:500 10.5px/1.2 system-ui,sans-serif;opacity:.72;margin-top:3px}' +
    '#__nimblu_chat .m ol{margin:6px 0 0;padding-left:18px;white-space:normal}' +
    '#__nimblu_chat .m li{margin:3px 0}' +
    '#__nimblu_chat .m li small{display:block;color:#4a5d82}' +
    '#__nimblu_chat .empty{margin:auto 0;text-align:center;color:#5b6f96}' +
    '#__nimblu_chat form{display:flex;gap:6px;margin:0;padding:10px 12px 6px;border-top:1px solid #dbe4f3;background:#fff}' +
    '#__nimblu_chat input{all:unset;box-sizing:border-box;flex:1;min-width:0;background:#fff;border:1.5px solid #b7c8e6;border-radius:9px;padding:7px 9px;font:500 13px/1.2 system-ui,-apple-system,sans-serif;color:#22314f;cursor:text}' +
    '#__nimblu_chat input:focus{border-color:#4f74b3}' +
    '#__nimblu_chat form button{background:#4f74b3;color:#fff;border-radius:9px;padding:7px 11px;font:600 12px/1.2 system-ui,-apple-system,sans-serif}' +
    '#__nimblu_chat .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 12px 8px;background:#fff;font:500 11px/1.3 system-ui,sans-serif;color:#5b6f96}' +
    '#__nimblu_chat .ft button{font:600 11px/1.3 system-ui,sans-serif;color:#5b6f96}' +
    '#__nimblu_chat .ft button.warn{color:#d64545}';
  chatPanel.innerHTML =
    '<div class="hd"><b>🕘 Chat con Nimblu</b><button type="button" class="x" data-ch="close" aria-label="Chiudi">✕</button></div>' +
    '<div class="list" aria-live="polite"></div>' +
    '<form><input type="text" maxlength="200" placeholder="Scrivi a Nimblu…" aria-label="Messaggio per Nimblu"><button type="submit">Invia</button></form>' +
    '<div class="ft"><span class="cnt"></span><button type="button" data-ch="clear">Cancella cronologia</button></div>';
  var chatList = chatPanel.querySelector('.list'), chatInput = chatPanel.querySelector('input'), clearArm = 0;
  function dayLabel(d) {
    var t = new Date(), y = new Date(t.getTime() - 864e5);
    if (d.toDateString() === t.toDateString()) return 'Oggi';
    if (d.toDateString() === y.toDateString()) return 'Ieri';
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  }
  function renderChatList() {
    if (!chatOpen || !chatList) return;
    var html = '', last = '', here = pageKey();
    if (!chatLog.length) html = '<p class="empty">Ancora nessun messaggio.<br>Scrivigli qualcosa qui sotto!</p>';
    chatLog.forEach(function (m) {
      var d = new Date(m.t), day = dayLabel(d);
      if (day !== last) { html += '<div class="day">' + esc(day) + '</div>'; last = day; }
      var tips = m.tips && m.tips.length ? '<ol>' + m.tips.map(function (t) { return '<li>' + esc(t.titolo) + (t.come ? '<small>' + esc(t.come) + '</small>' : '') + '</li>'; }).join('') + '</ol>' : '';
      html += '<div class="m ' + (m.who === 'tu' ? 'tu' : 'ni') + '">' + esc(m.text) + tips +
        '<time>' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + (m.page && m.page !== here ? ' · ' + esc(m.page) : '') + '</time></div>';
    });
    if (M.thinking) html += '<div class="m ni">· · ·</div>';
    chatList.innerHTML = html;
    chatList.scrollTop = chatList.scrollHeight;
    chatPanel.querySelector('.cnt').textContent = chatLog.length ? chatLog.length + (chatLog.length === 1 ? ' messaggio' : ' messaggi') + ', solo su questo computer' : '';
  }
  function openChat() {
    chatOpen = true;
    var left = M.x - scrollX > W / 2;
    chatPanel.style.left = left ? '16px' : 'auto';
    chatPanel.style.right = left ? 'auto' : '16px';
    chatPanel.classList.add('open');
    logStore.get(function (l) { if (Array.isArray(l)) chatLog = l; renderChatList(); });
    renderChatList();
    try { chatInput.focus({ preventScroll: true }); } catch (e) {}
  }
  function closeChat() { chatOpen = false; chatPanel.classList.remove('open'); }
  chatPanel.querySelector('form').addEventListener('submit', function (e) {
    e.preventDefault(); e.stopPropagation();
    var q = chatInput.value;
    chatInput.value = '';
    sendChat(q);
  });
  chatPanel.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-ch]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.getAttribute('data-ch') === 'close') { closeChat(); return; }
    // cancellare chiede conferma: un secondo clic entro 4 secondi
    if (Date.now() - clearArm > 4000) {
      clearArm = Date.now(); b.textContent = 'Sicuro? Clicca di nuovo'; b.classList.add('warn');
      later(function () { b.textContent = 'Cancella cronologia'; b.classList.remove('warn'); }, 4000);
      return;
    }
    clearArm = 0; b.textContent = 'Cancella cronologia'; b.classList.remove('warn');
    logStore.clear(function () { chatLog = []; renderChatList(); });
    say('Cronologia cancellata. Si ricomincia!');
  });
  chatPanel.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') closeChat(); });
  chatPanel.addEventListener('keyup', stopKeys);

  // ---------- continuità tra una pagina e l'altra ----------
  function snapshot() {
    var a = M.att, st = { t: Date.now(), face: M.face, full: M.full, eaten: M.eaten, sx: (M.x - scrollX) / W, sy: M.y - scrollY, k: 'other' };
    if (a && a.k === 'wall') { st.k = 'wall'; st.side = a.side; st.sy = M.wy; }
    else if (a && a.k === 'floor') st.k = 'floor';
    if (M.mode === 'sleep') { st.mode = 'sleep'; st.left = M.t; }
    else if (M.mode === 'front' || M.mode === 'sit') st.mode = M.mode;
    return st;
  }
  function saveState() { if (opts.onState && M.mode !== 'bye') opts.onState(snapshot()); }
  function restore(st) {
    M.greet = false;
    M.face = st.face === 1 ? 1 : -1;
    M.full = st.full || 0; M.eaten = st.eaten || 0; counter.textContent = M.eaten;
    var sx = clamp(+st.sx || 0.85, 0, 1);
    // se era sopra un elemento (che qui non c'è) va sulla parete vicina o sul bordo in basso
    if (st.k === 'wall' || (st.k === 'other' && (sx < 0.2 || sx > 0.8))) {
      var side = st.k === 'wall' ? (st.side < 0 ? -1 : 1) : sx < 0.5 ? -1 : 1;
      M.y = scrollY + clamp(+st.sy || H / 2, 70, H - 2);
      attachWall(side);
    } else {
      M.x = scrollX + clamp(sx * W, R, W - R);
      attachFloor();
    }
    parts.length = 0; M.squash = 0;
    if (st.mode === 'sleep' && st.left > 60) { M.mode = 'sleep'; M.t = st.left; }
    else if (st.mode === 'front' || st.mode === 'sit') front(0);
  }
  if (opts.state) restore(opts.state);
  addEventListener('pagehide', saveState);

  // un errore in un fotogramma non deve fermare Nimblu: se succede durante la rissa, la rissa si chiude
  var loopErrs = 0;
  function loopError(e) {
    if (loopErrs++ < 5 && window.console) console.warn('Nimblu:', e);
    if (F) { try { finishFight(); } catch (x) { F = null; } }
    if (M.mode === 'fight') { M.mode = 'fall'; M.att = null; M.vy = 0.5; }
  }
  function loop(now) {
    var dt = Math.max(0, Math.min(2.5, (now - last) / 16.667));
    last = now; frame++;
    try { update(dt); } catch (e) { loopError(e); }
    if (!window.__mascot) return;
    if (frame % 90 === 0) saveState();
    if (frame % 60 === 0) uxAutoHint();
    try { draw(); } catch (e) { loopError(e); }
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    removeEventListener('scroll', onScroll);
    removeEventListener('pointermove', onMove, true);
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey);
    removeEventListener('pagehide', saveState);
    document.removeEventListener('error', onResErr, true);
    document.removeEventListener('play', onPlay, true);
    removeEventListener('keydown', fightKeyDown, true);
    removeEventListener('keyup', fightKeyUp, true);
    removeEventListener('blur', fightBlur);
    removeEventListener('pointerdown', fPointerDown, true);
    removeEventListener('pointerup', fPointerUp, true);
    ['click', 'mousedown', 'mouseup', 'contextmenu', 'auxclick', 'dblclick'].forEach(function (t) { removeEventListener(t, fBlockClick, true); });
    removeEventListener('wheel', fightWheel);
    removeEventListener('touchmove', fightWheel);
    F = null;
    if (fCursor) { fCursor.remove(); fCursor = null; }
    restorePage(false);
    restoreText();
    wpAbort(); wpRestore();
    wp.shards.forEach(function (sh) { sh.el.remove(); });
    B = null;
    [cv, water, grab, foeGrab, fightBtn, ballGrab, css, menu, uxPanel, chatPanel, bubble, wp.style].forEach(function (e) { if (e) e.remove(); });
    delete window.__mascot;
  }

  window.__mascot = {
    stop: stop, M: M,
    setLevel: function (l) { setLevel(l, true); if (level === l && M.att) idle(20); },
    setPrefs: function (p) { if (typeof p.talk === 'boolean') setPref('talk', p.talk); if (typeof p.tips === 'boolean') setPref('tips', p.tips); if (typeof p.water === 'boolean') setPref('water', p.water); if (typeof p.noEat === 'boolean') setPref('noEat', p.noEat); if (typeof p.wpAuto === 'boolean') setPref('wpAuto', p.wpAuto); if (typeof p.noGlass === 'boolean') setPref('noGlass', p.noGlass); },
    // per l'app: fargli dire o fare qualcosa, o mandargli un messaggio come dalla chat
    say: function (t) { say(t); },
    act: function (n) { if (ACTIONS[n]) ACTIONS[n](); },
    chat: function (q) { input.value = q; chat({ preventDefault: function () {}, stopPropagation: function () {} }); },
    name: myName
  };
  raf = requestAnimationFrame(loop);
};
