// The Logic page in MSS Logic mode: the MSS page's strip editor for tracks (logic-mss-tracks). Work item 4.2b.
// Loaded after mss-builder.js. Parts register with EsphomeMrLogicUi.registerPart
// (modes: ["mss"]), using the part ids in EsphomeMrMssBuilder.PARTS, and keep
// every word in their TEXT for the plain-words lint.
(function (global) {
  const TEXT = Object.freeze({});

  global.EsphomeMrLogicUiMssTracks = { TEXT };
})(typeof globalThis !== "undefined" ? globalThis : window);
