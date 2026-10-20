// Fa comparire Nimblu su ogni pagina, salvo se è spento o nascosto per questo sito (vedi popup).
// Il livello di movimento vale per tutti i siti; posizione e stato passano da una pagina all'altra.
(function () {
  var host = location.hostname || 'file';
  var MAX_AGE = 30 * 60 * 1000; // dopo 30 minuti riparte da capo
  var lastSave = 0;
  function apply(s) {
    var off = s.enabled === false || (s.disabledHosts || []).indexOf(host) >= 0;
    if (off) { if (window.__mascot) window.__mascot.stop(); return; }
    if (!window.__mascot) {
      var st = s.nimbluState && Date.now() - s.nimbluState.t < MAX_AGE ? s.nimbluState : null;
      window.__MASCOT_SRC({
        persistent: true,
        level: s.level,
        uxAuto: s.uxAuto !== false,
        talk: s.talk !== false,
        water: s.water === true,
        noEat: s.noEat === true,
        noGlass: s.noGlass === true,
        wpAuto: s.wpAuto === true,
        onPrefs: function (p) { chrome.storage.local.set({ talk: p.talk, uxAuto: p.tips, water: p.water, noEat: p.noEat, wpAuto: p.wpAuto, noGlass: p.noGlass }); },
        aiPage: s.aiPage !== false,
        // cronologia della chat comune a tutti i siti (ultimi 300 messaggi, solo su questo computer)
        history: {
          get: function (cb) { chrome.storage.local.get(['nimbluLog'], function (r) { cb(r.nimbluLog || []); }); },
          add: function (e, cb) {
            chrome.storage.local.get(['nimbluLog'], function (r) {
              var l = r.nimbluLog || [];
              l.push(e);
              while (l.length > 300) l.shift();
              chrome.storage.local.set({ nimbluLog: l }, function () { if (cb) cb(l); });
            });
          },
          clear: function (cb) { chrome.storage.local.set({ nimbluLog: [] }, function () { if (cb) cb([]); }); }
        },
        // la chat passa dal service worker, che usa il modello integrato di Chrome
        ai: s.aiOn === false ? null : function (payload) {
          return new Promise(function (res, rej) {
            try {
              chrome.runtime.sendMessage({ type: 'nimblu-chat', text: payload.text, page: payload.page }, function (r) {
                if (chrome.runtime.lastError) return rej(chrome.runtime.lastError.message);
                if (!r || r.error) return rej((r && r.error) || 'errore');
                res(r);
              });
            } catch (e) { rej(String(e)); }
          });
        },
        state: st,
        onLevel: function (l) { chrome.storage.local.set({ level: l }); },
        onState: function (state) {
          // al massimo un salvataggio al secondo (più quello all'uscita dalla pagina)
          var now = Date.now();
          if (now - lastSave < 1000 && document.visibilityState === 'visible') return;
          lastSave = now;
          try { chrome.storage.local.set({ nimbluState: state }); } catch (e) {}
        }
      });
    } else {
      if (s.level && window.__mascot.setLevel) window.__mascot.setLevel(s.level);
      if (window.__mascot.setPrefs) window.__mascot.setPrefs({ talk: s.talk !== false, tips: s.uxAuto !== false, water: s.water === true, noEat: s.noEat === true, wpAuto: s.wpAuto === true, noGlass: s.noGlass === true });
    }
  }
  // comandi dal pannellino dell'estensione (es. "Fai entrare l'omino")
  chrome.runtime.onMessage.addListener(function (m, sender, reply) {
    if (!m || m.type !== 'nimblu-act') return;
    var ok = !!(window.__mascot && window.__mascot.act);
    if (ok) window.__mascot.act(m.act);
    reply({ ok: ok });
  });
  function load() { chrome.storage.local.get(['enabled', 'disabledHosts', 'level', 'nimbluState', 'uxAuto', 'talk', 'aiOn', 'aiPage', 'water', 'noEat', 'wpAuto', 'noGlass'], apply); }
  load();
  chrome.storage.onChanged.addListener(function (changes) {
    // lo stato salvato di continuo non deve rimettere in moto nulla
    if (changes.enabled || changes.disabledHosts || changes.level || changes.talk || changes.uxAuto || changes.water || changes.noEat || changes.wpAuto || changes.noGlass) load();
  });
})();
