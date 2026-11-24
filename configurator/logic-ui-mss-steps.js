// The Logic page in MSS Logic mode: the MSS page's guided steps, Ends (logic-mss-ends) and the Signals grid with
// approach lighting (logic-mss-signals). Work item 4.2a.
// Loaded after mss-builder.js. Parts register with EsphomeMrLogicUi.registerPart
// (modes: ["mss"]), using the part ids in EsphomeMrMssBuilder.PARTS, and keep
// every word in their TEXT for the plain-words lint.
(function (global) {
  const TEXT = Object.freeze({});

  global.EsphomeMrLogicUiMssSteps = { TEXT };
})(typeof globalThis !== "undefined" ? globalThis : window);
