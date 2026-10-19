// Modello linguistico integrato in Chrome (Gemini Nano, Prompt API): gira sul computer, gratis e senza chiavi.
// Usato dal service worker (background.js) oppure, se lì non è disponibile, dal documento offscreen.
(function (g) {
  var AZIONI = ['nessuna', 'balla', 'salta', 'saluta', 'siediti', 'dormi', 'gira', 'annusa', 'scrollati', 'nuota', 'mangia', 'angolo', 'controlla', 'nasconditi', 'sbircia', 'arrampicati', 'corri', 'pallina'];
  var SCHEMA = {
    type: 'object',
    properties: {
      risposta: { type: 'string' },
      ricorda: { type: 'array', items: { type: 'string' } },
      azione: { type: 'string', enum: AZIONI }
    },
    required: ['risposta', 'ricorda', 'azione']
  };
  // domande sulla pagina: oltre alla risposta breve, una lista di consigli concreti
  var TIP = {
    type: 'object',
    properties: { titolo: { type: 'string' }, perche: { type: 'string' }, come: { type: 'string' }, rif: { type: 'string' } },
    required: ['titolo', 'perche', 'come', 'rif']
  };
  var SCHEMA_PAGE = {
    type: 'object',
    properties: {
      risposta: { type: 'string' },
      consigli: { type: 'array', items: TIP },
      ricorda: { type: 'array', items: { type: 'string' } },
      azione: { type: 'string', enum: AZIONI }
    },
    required: ['risposta', 'consigli', 'ricorda', 'azione']
  };
  var base = null, baseSystem = null;

  function langOpts(l) {
    return { expectedInputs: [{ type: 'text', languages: [l] }], expectedOutputs: [{ type: 'text', languages: [l] }] };
  }
  // l'italiano potrebbe non essere tra le lingue ufficiali: in quel caso si usa l'inglese e il prompt chiede l'italiano
  async function pickLang() {
    var langs = ['it', 'en'];
    for (var i = 0; i < langs.length; i++) {
      try { if (await LanguageModel.availability(langOpts(langs[i])) === 'available') return langs[i]; } catch (e) {}
    }
    return null;
  }
  async function status() {
    if (typeof LanguageModel === 'undefined') return 'nosupport';
    var best = 'unavailable', order = ['unavailable', 'downloadable', 'downloading', 'available'];
    var langs = ['it', 'en'];
    for (var i = 0; i < langs.length; i++) {
      try {
        var a = await LanguageModel.availability(langOpts(langs[i]));
        if (order.indexOf(a) > order.indexOf(best)) best = a;
      } catch (e) {}
    }
    return best;
  }
  async function getBase(system) {
    if (base && baseSystem === system) return base;
    var l = await pickLang();
    if (!l) throw new Error('modello-non-pronto');
    var o = langOpts(l);
    o.initialPrompts = [{ role: 'system', content: system }];
    base = await LanguageModel.create(o);
    baseSystem = system;
    return base;
  }
  async function run(system, prompt, kind) {
    if (typeof LanguageModel === 'undefined') throw new Error('nosupport');
    var b = await getBase(system);
    var s = await b.clone();
    try {
      try { return await s.prompt(prompt, { responseConstraint: kind === 'pagina' ? SCHEMA_PAGE : SCHEMA }); }
      catch (e) { if (e && e.name === 'NotSupportedError') return await s.prompt(prompt); throw e; }
    } finally {
      if (s.destroy) s.destroy();
    }
  }
  g.NimbluAI = { run: run, status: status, AZIONI: AZIONI, langOpts: langOpts };
})(self);
