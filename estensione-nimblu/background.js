// Cervello di Nimblu: riceve i messaggi dalla chat sulla pagina, chiede la risposta al modello integrato
// di Chrome e tiene la memoria (ricordi sull'utente e ultimi scambi) in chrome.storage.local.
importScripts('ai-core.js');

var MAX_RICORDI = 50, MAX_STORIA = 10;
var SYSTEM = [
  'Sei Nimblu, una piccola creatura del laghetto simile a un axolotl blu con le branchie rosa, che vive sulle pagine web nel browser di chi ti scrive.',
  'Carattere: curioso, affettuoso, un po\' buffo e goloso di lettere (le mangi dalle pagine: le vocali sono dolci, le consonanti croccanti). Ti manca un po\' il tuo laghetto. Ogni tanto dici "blub".',
  'Dai del tu. Rispondi sempre in italiano, con frasi brevi: al massimo 2 frasi e meno di 200 caratteri, perché compaiono in un fumetto. Niente elenchi.',
  'Varia sempre il modo di rispondere: non ripetere le frasi già usate nella conversazione.',
  'Usa i ricordi su chi ti scrive in modo naturale, solo quando c\'entrano. Non inventare ricordi che non hai.',
  'Quando ti chiedono della pagina diventi anche un esperto di UX e conversione: consigli concreti e specifici per QUELLA pagina (cita testi, bottoni e sezioni reali), in ordine di impatto, niente frasi generiche e niente elementi inventati.',
  'Puoi anche fare delle azioni con il corpo; scegline una solo se c\'entra con il messaggio, altrimenti "nessuna".'
].join('\n');

// scheda della pagina: completa per le domande sulla pagina, ridotta per la chiacchiera
function pageBlock(g, full) {
  var l = ['Titolo: ' + (g.title || ''), 'Indirizzo: ' + (g.url || '')];
  if (g.description) l.push('Descrizione: ' + g.description);
  if (g.h1) l.push('Titolo principale (H1): ' + g.h1);
  if (full) {
    if (g.outline && g.outline.length) l.push('Sezioni (H2/H3): ' + g.outline.join(' | '));
    if (g.ctas && g.ctas.length) l.push('Bottoni e call to action: ' + g.ctas.join(' | '));
    if (g.forms) l.push('Form: ' + g.forms);
    if (g.stats) l.push('Dati: ' + g.stats);
    if (g.seo) l.push('SEO: ' + g.seo);
    l.push(g.problems && g.problems.length ? 'Problemi trovati dai controlli automatici (codice, gravità, descrizione):\n' + g.problems.join('\n') : 'I controlli automatici non hanno trovato problemi.');
  } else if (g.ux && g.ux.length) l.push('Problemi trovati dai controlli UX automatici: ' + g.ux.join('; '));
  if (g.text) l.push('Testo della pagina (inizio): ' + g.text);
  return l.join('\n');
}

function buildPrompt(msg, ricordi, storia) {
  var p = [], pagina = msg.mode === 'pagina' && msg.page;
  p.push(ricordi.length ? 'Cose che ricordi su chi ti scrive:\n' + ricordi.map(function (m) { return '- ' + m; }).join('\n') : 'Non ricordi ancora niente di chi ti scrive.');
  if (storia.length) p.push('Conversazione recente:\n' + storia.map(function (h) { return 'Utente: ' + h.u + '\nNimblu: ' + h.n; }).join('\n'));
  if (msg.page) p.push('Pagina che l\'utente sta guardando:\n' + pageBlock(msg.page, pagina));
  p.push('Nuovo messaggio dell\'utente: "' + msg.text + '"');
  if (pagina) {
    p.push('Il messaggio riguarda la pagina: rispondi da esperto di UX, conversione, SEO, GEO (farsi trovare e citare da ChatGPT, Perplexity, Gemini e dai riassunti AI di Google: risposte chiare, FAQ, dati concreti, dati strutturati, bot AI ammessi), AEO (risposte dirette nei riquadri in evidenza di Google, «Le persone chiedono anche» e assistenti vocali: domande come titoli, risposta di 40-60 parole subito sotto, elenchi numerati, tabelle, FAQPage, dati locali) e accessibilità (se si parla di non vedenti o screen reader: consigli pratici con il testo pronto da scrivere, es. l\'alt di un\'immagine o l\'aria-label di un\'icona), con la tua personalità ma in modo utile. ' +
      'Rispondi solo con un oggetto JSON con quattro campi: "risposta" (1 o 2 frasi, al massimo 220 caratteri, per il fumetto: il giudizio in breve; i dettagli vanno nei consigli), ' +
      '"consigli" (da 3 a 5 consigli in ordine di impatto sulla conversione; se la domanda chiede una cosa sola, solo quelli pertinenti; lista vuota se il messaggio non riguarda davvero la pagina. ' +
      'Ogni consiglio ha "titolo" (al massimo 60 caratteri, inizia con un verbo), "perche" (al massimo 140 caratteri), ' +
      '"come" (al massimo 180 caratteri: cosa cambiare esattamente, citando testi, bottoni o sezioni reali della pagina) e ' +
      '"rif" (il codice del problema automatico a cui si collega, per esempio "P2", oppure "" se nessuno)), ' +
      '"ricorda" (lista di fatti nuovi e duraturi sull\'utente, di solito vuota) e "azione" (una tra: ' + NimbluAI.AZIONI.join(', ') + ').');
    return p.join('\n\n');
  }
  p.push('Rispondi solo con un oggetto JSON con tre campi: "risposta" (in italiano, al massimo 2 frasi brevi, con la tua personalità, diversa dalle risposte precedenti), ' +
    '"ricorda" (lista di fatti nuovi e duraturi sull\'utente da memorizzare, per esempio nome, lavoro, gusti, progetti; lista vuota se non ce ne sono) ' +
    'e "azione" (una tra: ' + NimbluAI.AZIONI.join(', ') + ').');
  return p.join('\n\n');
}

function str(v, n) { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1) + '…' : v; }
function parse(out) {
  var d = null;
  try { d = JSON.parse(out); } catch (e) {
    var m = /\{[\s\S]*\}/.exec(out || '');
    if (m) { try { d = JSON.parse(m[0]); } catch (e2) {} }
  }
  if (!d || typeof d.risposta !== 'string') d = { risposta: String(out || '').replace(/[{}"]/g, '').trim(), ricorda: [], azione: 'nessuna' };
  d.risposta = d.risposta.trim().slice(0, 260) || 'Blub?';
  if (!Array.isArray(d.ricorda)) d.ricorda = [];
  if (NimbluAI.AZIONI.indexOf(d.azione) < 0) d.azione = 'nessuna';
  d.consigli = (Array.isArray(d.consigli) ? d.consigli : []).slice(0, 5).map(function (c) {
    c = c || {};
    var rif = /^P\d{1,2}$/.test(String(c.rif || '').trim()) ? String(c.rif).trim() : '';
    return { titolo: str(c.titolo, 80), perche: str(c.perche, 200), come: str(c.come, 260), rif: rif };
  }).filter(function (c) { return c.titolo; });
  return d;
}

// Il modello potrebbe non essere esposto nel service worker: in quel caso lo si usa da un documento offscreen.
var creatingOffscreen = null;
async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Esegue il modello linguistico integrato di Chrome per le risposte di Nimblu'
    }).catch(function (e) { if (!/single offscreen/i.test(String(e && e.message))) throw e; })
      .finally(function () { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}
async function runPrompt(prompt, kind) {
  if (typeof LanguageModel !== 'undefined') return NimbluAI.run(SYSTEM, prompt, kind);
  await ensureOffscreen();
  var r = await chrome.runtime.sendMessage({ type: 'nimblu-offscreen-run', system: SYSTEM, prompt: prompt, kind: kind });
  if (!r || r.error) throw new Error(r && r.error || 'offscreen');
  return r.out;
}

async function handleChat(msg) {
  var s = await chrome.storage.local.get(['nimbluMemories', 'nimbluChat', 'aiOn']);
  if (s.aiOn === false) return { error: 'spenta' };
  var ricordi = s.nimbluMemories || [], storia = s.nimbluChat || [];
  var pagina = msg.mode === 'pagina' && !!msg.page;
  var d = parse(await runPrompt(buildPrompt(msg, ricordi, storia), pagina ? 'pagina' : 'chat'));
  var low = ricordi.map(function (x) { return x.toLowerCase(); }), nuovi = 0;
  d.ricorda.forEach(function (f) {
    f = String(f).trim();
    if (f.length > 3 && f.length < 140 && low.indexOf(f.toLowerCase()) < 0) { ricordi.push(f); low.push(f.toLowerCase()); nuovi++; }
  });
  while (ricordi.length > MAX_RICORDI) ricordi.shift();
  // nella storia restano anche i titoli dei consigli, così si può chiedere "come faccio il secondo?"
  storia.push({ u: String(msg.text).slice(0, 300), n: d.risposta + (d.consigli.length ? ' [Consigli dati: ' + d.consigli.map(function (c, i) { return (i + 1) + ') ' + c.titolo; }).join('; ') + ']' : '') });
  while (storia.length > MAX_STORIA) storia.shift();
  await chrome.storage.local.set({ nimbluMemories: ricordi, nimbluChat: storia });
  return { reply: d.risposta, action: d.azione, remembered: nuovi, tips: pagina ? d.consigli : [] };
}

chrome.runtime.onMessage.addListener(function (msg, sender, send) {
  if (!msg || msg.type !== 'nimblu-chat') return;
  handleChat(msg).then(send, function (e) { send({ error: String(e && e.message || e) }); });
  return true;
});
