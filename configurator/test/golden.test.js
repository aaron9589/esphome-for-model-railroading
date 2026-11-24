// Golden files: today's YAML and JMRI XML for every fixture in test/fixtures,
// kept byte-for-byte. Logic mode None must never change them.
//
// After a deliberate change to the output, rewrite them with
//   UPDATE_GOLDEN=1 npm test
// and say why in the PR. A reviewer signs off on every golden file change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const { generateYaml, generateJmriXml, parseConfigFromYaml, validateConfig, normalizeConfig } =
  loadModules("generator.js", "logic-yaml.js").EsphomeMr;

const fixturesDir = path.join(configuratorDir, "test", "fixtures");
const goldenDir = path.join(configuratorDir, "test", "golden");
const update = process.env.UPDATE_GOLDEN === "1";

function loadFixture(file) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"));
}

// Point at the first line and column that differ, showing a little text either
// side, so a change inside the long config comment line is still readable.
function firstDifference(expected, actual) {
  const want = expected.split("\n");
  const got = actual.split("\n");
  for (let i = 0; i < Math.max(want.length, got.length); i += 1) {
    if (want[i] === got[i]) continue;
    const a = want[i] ?? "";
    const b = got[i] ?? "";
    let col = 0;
    while (col < a.length && a[col] === b[col]) col += 1;
    const from = Math.max(0, col - 40);
    const show = (text) => JSON.stringify(text.slice(from, col + 40)) + (want[i] === undefined || got[i] === undefined ? " (no line)" : "");
    return `line ${i + 1}, column ${col + 1}\n  golden:    ${show(a)}\n  generated: ${show(b)}`;
  }
  return "no line differs";
}

function checkGolden(name, actual) {
  const file = path.join(goldenDir, name);
  if (update) {
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (before !== actual) {
      fs.writeFileSync(file, actual);
      console.log(`  wrote test/golden/${name}`);
    }
    return;
  }
  assert.ok(fs.existsSync(file), `test/golden/${name} is missing; run UPDATE_GOLDEN=1 npm test`);
  const expected = fs.readFileSync(file, "utf8");
  if (expected !== actual) {
    assert.fail(`test/golden/${name} differs at ${firstDifference(expected, actual)}`);
  }
}

if (update) fs.mkdirSync(goldenDir, { recursive: true });

const fixtures = fs.readdirSync(fixturesDir).filter((file) => file.endsWith(".json")).sort();
const expectedGolden = new Set();

test("there are fixtures", () => {
  assert.ok(fixtures.length > 0);
});

for (const file of fixtures) {
  const name = file.replace(/\.json$/, "");
  expectedGolden.add(`${name}.yaml`);
  expectedGolden.add(`${name}.xml`);

  test(`${name}: fixture is a valid board`, () => {
    const config = normalizeConfig(loadFixture(file));
    assert.deepEqual([...validateConfig(config).errors], []);
  });

  test(`${name}: YAML matches the golden file`, () => {
    checkGolden(`${name}.yaml`, generateYaml(loadFixture(file)));
  });

  test(`${name}: JMRI XML matches the golden file`, () => {
    checkGolden(`${name}.xml`, generateJmriXml(normalizeConfig(loadFixture(file))).xml);
  });

  test(`${name}: importing the YAML gives the same YAML`, () => {
    const yaml = generateYaml(loadFixture(file));
    assert.equal(generateYaml(parseConfigFromYaml(yaml)), yaml);
  });
}

test("every golden file has a fixture", () => {
  const present = fs.existsSync(goldenDir) ? fs.readdirSync(goldenDir) : [];
  const orphans = present.filter((file) => /\.(yaml|xml)$/.test(file) && !expectedGolden.has(file));
  if (update) {
    for (const file of orphans) {
      fs.rmSync(path.join(goldenDir, file));
      console.log(`  removed test/golden/${file}`);
    }
    return;
  }
  assert.deepEqual(orphans, [], "golden files with no fixture; run UPDATE_GOLDEN=1 npm test");
});

if (!process.exitCode) console.log(update ? "\nGolden files updated." : "\nAll golden files match.");
