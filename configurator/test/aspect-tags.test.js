// CATS aspect tags and the diverging list (field logic spec, Aspect tags).
// Work item 2.0.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const { EsphomeMr } = loadModules("generator.js");
const { ASPECT_TAGS, CATS_ASPECTS, CATS_ASPECT_TAGS, CATS_DIVERGING, catsAspectDiverging, catsAspectState, catsAspectTag } = EsphomeMr;
const plain = (value) => JSON.parse(JSON.stringify(value));

const ASPECTS_XML = path.join(configuratorDir, "..", ".jmri", "resources", "signals", "cats-masts", "aspects.xml");

// The CATS signal template, read as it is.
function templateAspects() {
  const xml = fs.readFileSync(ASPECTS_XML, "utf8");
  return [...xml.matchAll(/<aspect>([\s\S]*?)<\/aspect>/g)].map(([, body]) => {
    const field = (name) => (body.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1];
    return { name: field("name"), speed: field("speed"), speed2: field("speed2") };
  });
}

// The spec's rules, first match wins.
function tagFromSpeeds({ name, speed, speed2 }) {
  if (speed === "Stop") return "stop";
  if (speed === "Restricted" || speed === "Slow") return "restricting";
  if (speed2 === "Stop") return "approach";
  if (name.startsWith("ADV_")) return "advance";
  return "clear";
}

test("the template people download is the one the tags were checked against", () => {
  const zip = path.join(configuratorDir, "cats-signal-template.zip");
  const shipped = execFileSync("unzip", ["-p", zip, "resources/signals/cats-masts/aspects.xml"], { encoding: "utf8" });
  assert.equal(shipped, fs.readFileSync(ASPECTS_XML, "utf8"), "rebuild cats-signal-template.zip from .jmri/");
});

test("tags run from most to least restrictive", () => {
  assert.deepEqual(plain(ASPECT_TAGS), ["stop", "restricting", "approach", "advance", "clear"]);
});

test("all 30 CATS aspects: the tag the template's speeds give", () => {
  const aspects = templateAspects();
  assert.equal(aspects.length, 30);
  assert.deepEqual(aspects.map((a) => a.name).sort(), [...CATS_ASPECTS].sort(), "the template and CATS_ASPECTS list the same aspects");
  for (const aspect of aspects) {
    assert.ok(aspect.speed && aspect.speed2, `${aspect.name} has both speeds`);
    assert.equal(CATS_ASPECT_TAGS[aspect.name], tagFromSpeeds(aspect), aspect.name);
  }
  assert.deepEqual(Object.keys(CATS_ASPECT_TAGS).sort(), [...CATS_ASPECTS].sort());
});

test("the tag table matches the spec's", () => {
  const by = (tag) => plain(CATS_ASPECTS.filter((name) => CATS_ASPECT_TAGS[name] === tag).sort());
  assert.deepEqual(by("stop"), ["R291", "R292"]);
  assert.deepEqual(by("restricting"), ["C422", "C423", "C424", "R287", "R288", "RES_LIM", "RES_MED", "RES_NORM", "RES_SLO"]);
  assert.deepEqual(by("approach"), ["R281D", "R285", "R286"]);
  assert.deepEqual(by("advance"), ["ADV_LIM", "ADV_MED", "ADV_NORM", "ADV_SLO"]);
  assert.equal(by("clear").length, 12);
});

test("diverging: Limited and Medium past the signal, less Advance and Restricting", () => {
  assert.deepEqual(plain([...CATS_DIVERGING].sort()), ["C412", "C413", "C414", "C417", "R281C", "R281D", "R283", "R283A", "R283B", "R286"]);
  const speeds = new Map(templateAspects().map((a) => [a.name, a]));
  for (const name of CATS_DIVERGING) {
    assert.ok(CATS_ASPECTS.includes(name), name);
    assert.ok(["Limited", "Medium"].includes(speeds.get(name).speed), `${name} is Limited or Medium past the signal`);
    assert.ok(["approach", "clear"].includes(CATS_ASPECT_TAGS[name]), `${name} lets the train go on`);
  }
  // Plain Approach has template speed Medium, but it is not a diverging route.
  assert.equal(speeds.get("R285").speed, "Medium");
  assert.equal(catsAspectDiverging("R285"), false);
});

test("an aspect is looked up by its JMRI name, and anything else starts as stop", () => {
  assert.equal(catsAspectTag("R281"), "clear");
  assert.equal(catsAspectTag(catsAspectState("R285")), "approach", "R285; Lit; Unheld");
  assert.equal(catsAspectTag(" ADV_MED "), "advance");
  for (const custom of ["Clear", "Proceed", "", undefined, "r281", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(catsAspectTag(custom), "stop", String(custom));
    assert.equal(catsAspectDiverging(custom), false, String(custom));
  }
  assert.equal(catsAspectDiverging(catsAspectState("C417")), true);
  assert.equal(catsAspectDiverging("Clear"), false);
});

test("the lists cannot be changed by accident", () => {
  assert.ok(Object.isFrozen(CATS_ASPECT_TAGS) && Object.isFrozen(CATS_DIVERGING) && Object.isFrozen(ASPECT_TAGS));
});

if (!process.exitCode) console.log("\nAll aspect tag tests passed.");
