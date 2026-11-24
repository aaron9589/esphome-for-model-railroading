// Board name suffix (field logic spec, Unique board names). Work item 1.1.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";

const {
  NAME_SUFFIX_ALPHABET,
  MAX_TYPED_NAME,
  addNameSuffix,
  generateNameSuffix,
  generateYaml,
  isNameSuffix,
  myFirstBoardPreset,
  newBoardConfig,
  newNameSuffix,
  normalizeConfig,
  parseConfigFromYaml,
  setTypedBoardName,
  typedBoardName,
  validateConfig,
} = loadModules("generator.js", "logic-yaml.js").EsphomeMr;

function withCreds(config) {
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "s3cret";
  return config;
}

test("the suffix alphabet is lowercase letters and digits without look-alikes", () => {
  assert.equal(NAME_SUFFIX_ALPHABET.length, 32);
  assert.equal(new Set(NAME_SUFFIX_ALPHABET).size, 32);
  for (const ch of "0o1l") assert.ok(!NAME_SUFFIX_ALPHABET.includes(ch), ch);
  assert.match(NAME_SUFFIX_ALPHABET, /^[a-z2-9]+$/);
});

test("a suffix is six characters from that alphabet, chosen at random", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const suffix = generateNameSuffix();
    assert.equal(suffix.length, 6);
    assert.ok(isNameSuffix(suffix), suffix);
    seen.add(suffix);
  }
  assert.ok(seen.size > 490, "suffixes repeat far too often");
  const used = new Set([...seen].join(""));
  assert.equal(used.size, 32, "every character should turn up in 3000 picks");
});

test("a new board gets a suffix on the end of its name", () => {
  const { board } = newBoardConfig();
  assert.ok(isNameSuffix(board.nameSuffix));
  assert.equal(board.name, `my-first-board-${board.nameSuffix}`);
  assert.equal(typedBoardName(board), "my-first-board");
  assert.notEqual(newBoardConfig().board.nameSuffix, board.nameSuffix);
});

test("the preset and old boards have no suffix, so their YAML is unchanged", () => {
  const config = myFirstBoardPreset();
  assert.equal(config.board.nameSuffix, undefined);
  normalizeConfig(config);
  assert.equal(config.board.nameSuffix, undefined);
  assert.equal(config.board.name, "my-first-board");
  assert.doesNotMatch(generateYaml(withCreds(config)), /nameSuffix/);
});

test("renaming keeps the suffix", () => {
  const board = { name: "kiama-north-k7m4x2", nameSuffix: "k7m4x2" };
  setTypedBoardName(board, "kiama-south");
  assert.equal(board.name, "kiama-south-k7m4x2");
  setTypedBoardName(board, "  yard  ");
  assert.equal(board.name, "yard-k7m4x2");
  assert.equal(typedBoardName(board), "yard");
  setTypedBoardName(board, "");
  assert.equal(typedBoardName(board), "");
  assert.equal(board.nameSuffix, "k7m4x2");
});

test("the suffix survives download, import and re-download", () => {
  const config = withCreds(newBoardConfig());
  const suffix = config.board.nameSuffix;
  const yaml = generateYaml(config);
  assert.match(yaml, new RegExp(`"name":"my-first-board-${suffix}","nameSuffix":"${suffix}"`));
  assert.match(yaml, new RegExp(`^  name: my-first-board-${suffix}$`, "m"));
  assert.match(yaml, new RegExp(`ssid: "my-first-board-${suffix} setup"`));
  const restored = parseConfigFromYaml(yaml);
  assert.equal(restored.board.nameSuffix, suffix);
  setTypedBoardName(restored.board, "kiama-north");
  const again = parseConfigFromYaml(generateYaml(restored));
  assert.equal(again.board.name, `kiama-north-${suffix}`);
  assert.equal(again.board.nameSuffix, suffix);
  assert.equal(generateYaml(parseConfigFromYaml(yaml)), yaml);
});

test("Add a suffix adds one, once", () => {
  const board = { name: "kiama-north" };
  addNameSuffix(board);
  const suffix = board.nameSuffix;
  assert.ok(isNameSuffix(suffix));
  assert.equal(board.name, `kiama-north-${suffix}`);
  addNameSuffix(board);
  assert.equal(board.nameSuffix, suffix);
  assert.equal(board.name, `kiama-north-${suffix}`);
});

test("New suffix keeps the typed name and changes the suffix", () => {
  const board = { name: "module-1-k7m4x2", nameSuffix: "k7m4x2" };
  newNameSuffix(board);
  assert.notEqual(board.nameSuffix, "k7m4x2");
  assert.ok(isNameSuffix(board.nameSuffix));
  assert.equal(board.name, `module-1-${board.nameSuffix}`);
});

test("importing puts a suffix the name lost back on, and drops a broken one", () => {
  const lost = { board: { name: "kiama-north", nameSuffix: "k7m4x2" }, blocks: [], points: [] };
  normalizeConfig(lost);
  assert.equal(lost.board.name, "kiama-north-k7m4x2");

  const broken = { board: { name: "kiama-north-K7M4X0", nameSuffix: "K7M4X0" }, blocks: [], points: [] };
  normalizeConfig(broken);
  assert.equal(broken.board.nameSuffix, undefined);
  assert.equal(broken.board.name, "kiama-north-K7M4X0");
});

test("the typed part can be 19 characters, not 20", () => {
  assert.equal(MAX_TYPED_NAME, 19);
  const config = withCreds(myFirstBoardPreset());
  config.board.nameSuffix = "k7m4x2";
  setTypedBoardName(config.board, "a".repeat(19));
  assert.equal(`${config.board.name} setup`.length, 32);
  assert.deepEqual([...validateConfig(config).errors], []);

  setTypedBoardName(config.board, "a".repeat(20));
  const { errors } = validateConfig(config);
  assert.ok(errors.some((error) => error.includes("20 characters before -k7m4x2") && error.includes("19")), errors.join("\n"));

  setTypedBoardName(config.board, "");
  assert.ok(validateConfig(config).errors.some((error) => error.includes("Board name is empty")));
});

test("a board that shares or runs logic without a suffix is warned", () => {
  const config = withCreds(myFirstBoardPreset());
  const warned = () => validateConfig(config).warnings.some((warning) => warning.includes("Add a suffix"));
  assert.equal(warned(), false);
  config.logic = { share: true };
  assert.equal(warned(), true);
  config.logic = { mode: "field" };
  assert.equal(warned(), true);
  addNameSuffix(config.board);
  assert.equal(warned(), false);
});

if (!process.exitCode) console.log("\nAll board name tests passed.");
