// Esegue il modello integrato di Chrome per conto del service worker, se lì non è disponibile.
chrome.runtime.onMessage.addListener(function (msg, sender, send) {
  if (!msg || msg.type !== 'nimblu-offscreen-run') return;
  NimbluAI.run(msg.system, msg.prompt, msg.kind).then(
    function (out) { send({ out: out }); },
    function (e) { send({ error: String(e && e.message || e) }); }
  );
  return true;
});
