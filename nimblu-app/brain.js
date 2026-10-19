// Cervello di Nimblu nell'app. Tre modalità, scelte nelle impostazioni:
//  - "locale": modello aperto che gira sul telefono con WebLLM (gratis, privato, offline dopo il download unico)
//  - "gemini": API di Google con la chiave dell'utente (salvata solo sul telefono)
//  - "semplice": nessuna AI, restano le risposte già scritte di mascot.js
// Personalità fissa e memoria (ricordi + ultimi scambi) in localStorage, uguali per tutte le modalità.
(function (g) {
  var AZIONI = ['nessuna', 'balla', 'salta', 'saluta', 'siediti', 'dormi', 'gira', 'annusa', 'scrollati', 'nuota', 'mangia', 'angolo', 'nasconditi', 'sbircia', 'arrampicati', 'corri', 'pallina'];
  var MAX_RICORDI = 50, MAX_STORIA = 8, TIMEOUT = 15000;
  var SYSTEM = [
    'Sei Nimblu, una piccola creatura del laghetto simile a un axolotl blu con le branchie rosa. Vivi in un laghetto dentro un\'app sul telefono di chi ti scrive, tra ninfee con sopra delle parole.',
    'Carattere: curioso, affettuoso, un po\' buffo e goloso di lettere (mangi le parole delle ninfee: le vocali sono dolci, le consonanti croccanti). Ogni tanto dici "blub".',
    'Dai del tu. Rispondi sempre in italiano, con frasi brevi: al massimo 2 frasi e meno di 200 caratteri, perché compaiono in un fumetto. Niente elenchi.',
    'Varia sempre il modo di rispondere: non ripetere le frasi già usate nella conversazione.',
    'Usa i ricordi su chi ti scrive in modo naturale, solo quando c\'entrano. Non inventare ricordi che non hai.',
    'Puoi fare delle azioni con il corpo; scegline una solo se c\'entra con il messaggio, altrimenti "nessuna".'
  ].join('\n');

  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function key() { try { return (localStorage.getItem('__nimblu_gemini_key') || '').trim(); } catch (e) { return ''; } }
  function fail(code, detail) { var e = new Error(code); e.detail = detail || ''; return e; }

  function buildPrompt(text, ricordi, storia) {
    var p = [];
    p.push(ricordi.length ? 'Cose che ricordi su chi ti scrive:\n' + ricordi.map(function (m) { return '- ' + m; }).join('\n') : 'Non ricordi ancora niente di chi ti scrive.');
    if (storia.length) p.push('Conversazione recente:\n' + storia.map(function (h) { return 'Utente: ' + h.u + '\nNimblu: ' + h.n; }).join('\n'));
    p.push('Nuovo messaggio dell\'utente: "' + text + '"');
    p.push('Rispondi solo con un oggetto JSON con tre campi: "risposta" (in italiano, al massimo 2 frasi brevi, con la tua personalità, diversa dalle risposte precedenti), ' +
      '"ricorda" (lista di fatti nuovi e duraturi sull\'utente da memorizzare, per esempio nome, lavoro, gusti, progetti; lista vuota se non ce ne sono) ' +
      'e "azione" (una tra: ' + AZIONI.join(', ') + ').');
    return p.join('\n\n');
  }
  function parse(out) {
    var d = null;
    try { d = JSON.parse(out); } catch (e) {
      var m = /\{[\s\S]*\}/.exec(out || '');
      if (m) { try { d = JSON.parse(m[0]); } catch (e2) {} }
    }
    if (!d || typeof d.risposta !== 'string') d = { risposta: String(out || '').replace(/[{}"]/g, '').replace(/^\s*risposta\s*:\s*/i, '').trim(), ricorda: [], azione: 'nessuna' };
    d.risposta = d.risposta.trim().slice(0, 260) || 'Blub?';
    if (!Array.isArray(d.ricorda)) d.ricorda = [];
    if (AZIONI.indexOf(d.azione) < 0) d.azione = 'nessuna';
    return d;
  }

  // ---------- Gemini (online, con chiave) ----------
  var MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
  var VERTEX_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-001'];
  // chiavi di Google AI Studio ("AIza…") → Gemini API; chiavi di Vertex AI express ("AQ.…") → Vertex AI
  function endpoints(k) {
    var gem = MODELS.map(function (m) { return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', hdr: true }; });
    var vtx = VERTEX_MODELS.map(function (m) { return { url: 'https://aiplatform.googleapis.com/v1/publishers/google/models/' + m + ':generateContent?key=' + encodeURIComponent(k), hdr: false }; });
    return /^AQ\./.test(k) ? vtx.concat(gem) : gem.concat(vtx);
  }
  var SCHEMA = {
    type: 'OBJECT',
    properties: { risposta: { type: 'STRING' }, ricorda: { type: 'ARRAY', items: { type: 'STRING' } }, azione: { type: 'STRING', enum: AZIONI } },
    required: ['risposta', 'ricorda', 'azione']
  };
  // fetch con tempo massimo: se il servizio non risponde non resta bloccato
  async function fetchT(url, opts) {
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    try { opts.signal = ctrl.signal; return await fetch(url, opts); }
    catch (e) { throw fail(e && e.name === 'AbortError' ? 'timeout' : 'rete'); }
    finally { clearTimeout(t); }
  }
  async function callGemini(k, prompt, json) {
    var body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: json ? { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 1 } : { temperature: 1 }
    };
    var eps = endpoints(k), firstErr = null, netErr = null;
    for (var i = 0; i < eps.length; i++) {
      var res, hdr = { 'Content-Type': 'application/json' };
      if (eps[i].hdr) hdr['x-goog-api-key'] = k;
      try { res = await fetchT(eps[i].url, { method: 'POST', headers: hdr, body: JSON.stringify(body) }); }
      catch (e) { netErr = netErr || e; continue; }
      if (res.ok) {
        var j = await res.json(), c = j.candidates && j.candidates[0];
        var t = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
        if (t) return t;
        continue;
      }
      var tx = '', msg = '';
      try { tx = await res.text(); msg = (JSON.parse(tx).error || {}).message || ''; } catch (e) { msg = tx.slice(0, 160); }
      if (res.status === 429) throw fail('limite', msg);
      if (res.status === 404) continue;
      var code = /api[ _]?key|permission|unauthenticated|credential/i.test(tx) || res.status === 401 || res.status === 403 ? 'chiave' : 'http ' + res.status;
      if (!firstErr) firstErr = fail(code, msg);
    }
    if (firstErr) throw firstErr;
    throw netErr || fail('modello');
  }

  // ---------- Nimblu tascabile (modello aperto sul telefono con WebLLM) ----------
  var WEBLLM = 'https://esm.run/@mlc-ai/web-llm@0.2';
  // preferenze per taglia; si usa il primo modello disponibile nella versione della libreria
  var LOCAL = {
    bravo: { label: 'Più bravo', size: '≈ 0,9 GB', ids: ['Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f32_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC'] },
    leggero: { label: 'Leggero', size: '≈ 0,4 GB', ids: ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC', 'SmolLM2-360M-Instruct-q4f16_1-MLC', 'SmolLM2-360M-Instruct-q4f32_1-MLC'] }
  };
  var local = { engine: null, loading: null, progress: 0, text: '', listeners: [] };
  function notify() { local.listeners.forEach(function (f) { try { f(local.progress, local.text); } catch (e) {} }); }
  async function hasF16() {
    try { var a = await navigator.gpu.requestAdapter(); return !!(a && a.features && a.features.has('shader-f16')); } catch (e) { return false; }
  }
  async function pickLocalId(webllm, size) {
    var list = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list || []).map(function (m) { return m.model_id; });
    var f16 = await hasF16();
    var ids = LOCAL[size].ids.filter(function (id) { return f16 || id.indexOf('q4f16') < 0; });
    for (var i = 0; i < ids.length; i++) if (list.indexOf(ids[i]) >= 0) return ids[i];
    throw fail('nomodello', 'Nessun modello adatto in questa versione di WebLLM');
  }
  function loadLocal() {
    if (local.engine) return Promise.resolve(local.engine);
    if (local.loading) return local.loading;
    if (!navigator.gpu) return Promise.reject(fail('nowebgpu'));
    var size = get('__nimblu_local_size', 'bravo');
    local.progress = 0; local.text = 'Preparo il cervello…'; notify();
    local.loading = (async function () {
      var webllm = await import(WEBLLM);
      var id = await pickLocalId(webllm, size);
      var engine = await webllm.CreateMLCEngine(id, {
        initProgressCallback: function (p) { local.progress = p.progress || 0; local.text = p.text || ''; notify(); }
      });
      local.engine = engine;
      set('__nimblu_local_ready', size);
      local.progress = 1; local.text = 'Pronto'; notify();
      return engine;
    })().catch(function (e) {
      local.loading = null;
      local.text = ''; notify();
      throw e && e.message && /nowebgpu|nomodello/.test(e.message) ? e : fail('locale', String(e && e.message || e).slice(0, 180));
    });
    return local.loading;
  }
  async function callLocal(prompt) {
    var engine = await loadLocal();
    var req = {
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
      temperature: 0.9, max_tokens: 220
    };
    try {
      var r = await engine.chat.completions.create(Object.assign({ response_format: { type: 'json_object' } }, req));
      return r.choices[0].message.content;
    } catch (e) {
      var r2 = await engine.chat.completions.create(req); // alcuni modelli non supportano la modalità JSON
      return r2.choices[0].message.content;
    }
  }

  // chi ha già salvato una chiave Gemini continua a usarla; altrimenti si propone il cervello tascabile
  function mode() { return get('__nimblu_brain', key() ? 'gemini' : 'locale'); }

  g.NimbluBrain = {
    LOCAL: LOCAL,
    mode: mode,
    setMode: function (m) { set('__nimblu_brain', m); },
    key: key,
    setKey: function (k) { try { if (k) localStorage.setItem('__nimblu_gemini_key', k.trim()); else localStorage.removeItem('__nimblu_gemini_key'); } catch (e) {} },
    memories: function () { return get('__nimblu_memories', []); },
    setMemories: function (l) { set('__nimblu_memories', l); },
    forgetAll: function () { set('__nimblu_memories', []); set('__nimblu_chat', []); try { localStorage.removeItem('__nimblu_name'); } catch (e) {} },
    // tascabile
    webgpu: function () { return !!navigator.gpu; },
    localSize: function () { return get('__nimblu_local_size', 'bravo'); },
    setLocalSize: function (s) { if (LOCAL[s]) { set('__nimblu_local_size', s); if (local.engine && get('__nimblu_local_ready', '') !== s) { try { local.engine.unload(); } catch (e) {} local.engine = null; } } },
    localReady: function () { return get('__nimblu_local_ready', '') === this.localSize(); },
    localLoaded: function () { return !!local.engine; },
    localLoading: function () { return !!local.loading && !local.engine; },
    loadLocal: loadLocal,
    onProgress: function (f) { local.listeners.push(f); },
    // gemini
    test: async function (k) { await callGemini(k, 'Rispondi solo con: ok', false); return true; },

    ask: async function (text) {
      var m = mode();
      if (m === 'semplice') throw fail('spenta');
      if (m === 'gemini' && !key()) throw fail('nokey');
      if (m === 'locale' && !local.engine && !this.localReady()) throw fail('nolocal');
      var ricordi = get('__nimblu_memories', []), storia = get('__nimblu_chat', []);
      var nome = '';
      try { nome = localStorage.getItem('__nimblu_name') || ''; } catch (e) {}
      var perPrompt = ricordi.slice();
      if (nome && !perPrompt.some(function (r) { return r.toLowerCase().indexOf(nome.toLowerCase()) >= 0; })) perPrompt.unshift('Si chiama ' + nome);
      var prompt = buildPrompt(text, perPrompt, storia);
      var d = parse(m === 'gemini' ? await callGemini(key(), prompt, true) : await callLocal(prompt));
      var low = ricordi.map(function (x) { return x.toLowerCase(); }), nuovi = 0;
      d.ricorda.forEach(function (f) {
        f = String(f).trim();
        if (f.length > 3 && f.length < 140 && low.indexOf(f.toLowerCase()) < 0) { ricordi.push(f); low.push(f.toLowerCase()); nuovi++; }
      });
      while (ricordi.length > MAX_RICORDI) ricordi.shift();
      storia.push({ u: String(text).slice(0, 300), n: d.risposta });
      while (storia.length > MAX_STORIA) storia.shift();
      set('__nimblu_memories', ricordi); set('__nimblu_chat', storia);
      return { reply: d.risposta, action: d.azione, remembered: nuovi };
    }
  };

  // se il cervello tascabile è già stato scaricato, lo si prepara in sottofondo all'apertura dell'app
  if (mode() === 'locale' && g.NimbluBrain.localReady() && navigator.gpu) setTimeout(function () { loadLocal().catch(function () {}); }, 1500);
})(window);
