var $ = function (id) { return document.getElementById(id); };

// ---------- impostazioni ----------
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  var host = '';
  try {
    var u = new URL(tabs[0].url);
    if (/^(https?|file):$/.test(u.protocol)) host = u.hostname || 'file';
  } catch (e) {}
  chrome.storage.local.get(['enabled', 'disabledHosts', 'uxAuto', 'talk', 'aiOn', 'aiPage', 'noEat', 'wpAuto'], function (s) {
    var hosts = s.disabledHosts || [];
    // spento di base: acceso rimette le lettere mangiate e smette di mangiarle ovunque
    $('noEat').checked = s.noEat === true;
    $('noEat').addEventListener('change', function () { chrome.storage.local.set({ noEat: $('noEat').checked }); });
    $('wpAuto').checked = s.wpAuto === true;
    $('wpAuto').addEventListener('change', function () { chrome.storage.local.set({ wpAuto: $('wpAuto').checked }); });
    [['on', 'enabled'], ['talk', 'talk'], ['ux', 'uxAuto'], ['aiOn', 'aiOn'], ['aiPage', 'aiPage']].forEach(function (p) {
      $(p[0]).checked = s[p[1]] !== false;
      $(p[0]).addEventListener('change', function () { var o = {}; o[p[1]] = $(p[0]).checked; chrome.storage.local.set(o); });
    });
    if (!host) {
      $('siteRow').hidden = true;
      $('note').textContent = 'Chrome non permette a Nimblu di comparire su questa pagina.';
      return;
    }
    $('host').textContent = host;
    $('site').checked = hosts.indexOf(host) >= 0;
    $('site').addEventListener('change', function () {
      hosts = hosts.filter(function (h) { return h !== host; });
      if ($('site').checked) hosts.push(host);
      chrome.storage.local.set({ disabledHosts: hosts });
    });
  });
});

// ---------- rissa con l'omino ----------
$('fight').addEventListener('click', function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var t = tabs[0];
    if (!t) return;
    chrome.tabs.sendMessage(t.id, { type: 'nimblu-act', act: 'rissa' }, function (r) {
      if (chrome.runtime.lastError || !r || !r.ok) {
        $('fightNote').hidden = false;
        $('fightNote').textContent = 'Nimblu non è su questa pagina: ricaricala (o attivalo qui sopra) e riprova.';
        return;
      }
      window.close();
    });
  });
});

// ---------- intelligenza artificiale ----------
var MSG = {
  available: ['ok', 'Pronta', 'Nimblu risponde con l\'AI integrata di Chrome, sul tuo computer.'],
  downloadable: ['warn', 'Da scaricare', 'Serve un download unico del modello (qualche GB). Tieni aperto questo pannello finché non finisce.'],
  downloading: ['warn', 'Download in corso…', 'Chrome sta scaricando il modello: può richiedere qualche minuto.'],
  unavailable: ['no', 'Non disponibile', 'Chrome dice che il modello non può girare su questo computer (spazio libero, memoria o impostazioni). Nimblu userà le risposte già scritte.'],
  nosupport: ['no', 'Non supportata', 'Questa versione di Chrome non espone l\'AI integrata alle estensioni. Aggiorna Chrome all\'ultima versione.']
};
function showStatus(st, extra) {
  var m = MSG[st] || MSG.unavailable;
  $('aiDot').className = 'dot ' + m[0];
  $('aiStatus').textContent = m[1] + (extra ? ' ' + extra : '');
  $('aiInfo').textContent = m[2];
  $('aiGet').hidden = st !== 'downloadable' && st !== 'downloading';
  $('aiGet').disabled = st === 'downloading';
}
async function refreshStatus() {
  try { showStatus(await NimbluAI.status()); } catch (e) { showStatus('unavailable'); }
}
$('aiGet').addEventListener('click', async function () {
  // il download parte solo da un clic dell'utente
  $('aiGet').disabled = true;
  showStatus('downloading');
  var langs = ['it', 'en'], ok = false;
  for (var i = 0; i < langs.length && !ok; i++) {
    try {
      var o = NimbluAI.langOpts(langs[i]);
      o.monitor = function (m) {
        m.addEventListener('downloadprogress', function (e) { showStatus('downloading', Math.round((e.loaded || 0) * 100) + '%'); });
      };
      var s = await LanguageModel.create(o);
      if (s.destroy) s.destroy();
      ok = true;
    } catch (e) {}
  }
  refreshStatus();
});
refreshStatus();

// ---------- ricordi ----------
function renderMem(list) {
  var ul = $('mem');
  ul.textContent = '';
  (list || []).forEach(function (m, i) {
    var li = document.createElement('li');
    var sp = document.createElement('span'); sp.textContent = m;
    var b = document.createElement('button'); b.textContent = '×'; b.title = 'Dimentica'; b.setAttribute('aria-label', 'Dimentica: ' + m);
    b.addEventListener('click', function () {
      chrome.storage.local.get(['nimbluMemories'], function (s) {
        var l = s.nimbluMemories || []; l.splice(i, 1);
        chrome.storage.local.set({ nimbluMemories: l }, function () { renderMem(l); });
      });
    });
    li.appendChild(sp); li.appendChild(b); ul.appendChild(li);
  });
  $('memEmpty').hidden = !!(list && list.length);
  $('memClear').hidden = !(list && list.length);
}
$('memClear').addEventListener('click', function () {
  chrome.storage.local.set({ nimbluMemories: [], nimbluChat: [] }, function () { renderMem([]); });
});
chrome.storage.local.get(['nimbluMemories'], function (s) { renderMem(s.nimbluMemories); });

// ---------- cronologia della chat ----------
function renderLog(l) {
  l = l || [];
  $('logInfo').textContent = l.length ? l.length + (l.length === 1 ? ' messaggio salvato' : ' messaggi salvati') + ' su questo computer. Li rivedi dal menu di Nimblu, tasto 🕘.' : 'Ancora nessun messaggio.';
  $('logClear').hidden = !l.length;
}
$('logClear').addEventListener('click', function () {
  chrome.storage.local.set({ nimbluLog: [] }, function () { renderLog([]); });
});
chrome.storage.local.get(['nimbluLog'], function (s) { renderLog(s.nimbluLog); });
