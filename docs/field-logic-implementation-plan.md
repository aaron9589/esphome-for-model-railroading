# Logic — Implementation Plan (draft)

Builds what [field-logic-spec.md](field-logic-spec.md) (the logic engine and Field Logic) and [mss-emulation-spec.md](mss-emulation-spec.md) (MSS Logic) describe. The specs say *what*; this says *in what order, where in the code, and how we know each step is done*. Sizes are rough person-days for one developer working with agents.

## Principles for the build

- **One feature branch until the end.** All of this is built on `feature/logic`. Nothing merges to `main` until Release 5 is complete (see *Branching*). Releases are milestones on that branch: each is complete, tested and usable by testers on its own. Unfinished parts stay hidden until their release, so the branch is always in a usable state.
- **Tests first where behaviour is defined.** Each work item starts with its tests. Engine cases are **hand-written from the specs**, with expected outputs worked out by hand and reviewed, never produced by running the engine, so the engine is never its own oracle.
- **Logic mode None never changes.** Before any logic code lands, today's YAML and JMRI XML for every test fixture are saved as golden files, and every later change must keep them byte-for-byte. Changing a golden file needs `UPDATE_GOLDEN=1` and a reviewer's sign-off in the PR.
- **New code in new files.** `app.js` (1717 lines) and `generator.js` (2007 lines, with a 450-line `generateYaml`) are already large. Logic goes in new modules. Existing files gain hooks, and one call each from `generateYaml` and `generateJmriXml`.
- **Hardware before trust.** Anything that depends on ESPHome, JMRI or CATS behaviour is proven in a spike before the release that relies on it.
- **Each release ships its guide.** Principle 8 of the spec says a modeller should manage from the page and the guide alone, so a release that adds something to the page adds it to the guide too.

## Branching

- **`feature/logic`** is the long-lived branch for everything in this plan. It starts from the specs on `spec/field-logic`.
- **Each work item** has a GitHub issue (#23–#67, labelled `logic`, one milestone per release, with its model class as a label) and is built on a short branch off `feature/logic` (for example `logic/1.2-mcp23017-expanders`), merged back by a PR that passes CI and review. GitHub only auto-closes an issue from a PR into the default branch, so close the issue by hand (`gh issue close <n>`) when its PR merges into `feature/logic`. Each release ends with a tag on the branch: `logic-r0` … `logic-r5`.
- **`main` is not touched** until Release 5 is complete. Then one PR merges `feature/logic` into `main`, which is what puts the Logic page on the live configurator.
- **Keep up with `main`.** Merge `main` into `feature/logic` at least weekly, and whenever a fix lands there. If a fix on `main` changes today's YAML, the golden files are updated in that merge, with sign-off.
- **Testers** run the configurator from the branch locally (`configurator/index.html`, or `python3 -m http.server` in `configurator/`), because GitHub Pages only deploys `main`.
- **Component tags.** Boards built during development point at pre-release tags on the branch (`logic-v0.1.0`, …). Just before the final merge, `logic-v1.0.0` is tagged on `feature/logic` and `LOGIC_COMPONENT_REF` set to it, so the first `main` deploy names a tag that already exists.

## Where the code goes

| Path | What | New or changed |
|---|---|---|
| `configurator/logic.js` | The engine (the name the specs use): inputs and latches, the scan, rules, resources, layers, who wins, holds, switch, start-up, approach lighting, plant ends and pairing, Explain sentences. Pure functions, no DOM | new |
| `configurator/logic-starters.js` | Starters as pure functions: description → layers. Used by the Logic page and by the MSS builder | new |
| `configurator/logic-checker.js` | Cycle check and state exploration over the engine | new |
| `configurator/logic-yaml.js` | Logic parts of the YAML and JMRI XML: rule table, version code, blocks, shared publishes, plant ends, logic hooks on expanders | new |
| `configurator/mss-builder.js` | MSS description → built items (pure, deterministic) | new |
| `configurator/logic-ui.js` | The Logic page: mode, parts, rule cards, starters, layers view, control table, MSS steps | new |
| `configurator/logic-sim.js` | Try it: input panel, strip diagram, Run a train, pretend neighbours, multi-board wiring | new |
| `configurator/generator.js` | `CATS_ASPECTS` tags and diverging list, board name suffix, expanders, the turnout-lock emitters, the two calls into `logic-yaml.js`, logic keys in `normalizeConfig` and the config blob | changed |
| `configurator/app.js`, `index.html`, `styles.css` | Logic nav entry and section, Expanders on Sensors, name suffix on Board, rename and delete integrity | changed |
| `configurator/test/cases/*.json` | Shared engine cases: inputs in, expected outputs scan by scan. Multi-board cases wire several boards by their plant ends | new |
| `configurator/test/golden/` | Today's YAML and JMRI XML for every fixture | new |
| `configurator/test/*.test.js` | Generator, engine, checker, starters, builder and UI-label tests, each loading its modules into the `vm` context | new and changed |
| `components/mr_logic/` | ESPHome external component: `__init__.py` (schema, codegen), the ESPHome adapter, and `core/` (plain C++17, no ESPHome includes) | new |
| `engine-tests/` | CMake project that builds `core/` and replays `configurator/test/cases/*.json` | new |
| `.github/workflows/test.yml` | `npm test`; JMRI XML against `layout-4-19-2.xsd` with `xmllint`; later the CMake tests and an `esphome compile` | new |
| `.github/workflows/pages.yml` | Deploys only after `test.yml` passes | changed |
| `docs/field-logic-guide.md`, `docs/mss-logic-guide.md` | The guides, grown release by release | new |

**Pinning the component.** `generator.js` holds `LOGIC_COMPONENT_REF` (for example `logic-v1.0.0`), written into the YAML as `source: github://aaron9589/esphome-for-model-railroading@<ref>` with `components: [mr_logic]`. The tag is created **before** the PR that bumps the constant is merged, and CI fails if the ref does not exist (`git ls-remote`). Pages deploys only after tests pass, so once the work reaches `main` the live page never names a tag that is not there. A higher `min_version`, if the component needs one, is emitted only when the component is, so mode None keeps today's YAML.

## Who builds what

| Class | Use for | Why |
|---|---|---|
| **Opus** | Engine semantics and its hand-written cases, the C++ core, the adapter's start-up, boot, lock and not-known wiring, pairing, validation and the cycle check, the checker, Explain, the MSS builder, every fail-safe review | Subtle, safety-relevant logic, where a wrong edge case can show a false Clear |
| **Sonnet** | Generator emitters, codegen, UI pages, Try it, CI | Well-specified, sizeable code against clear tests |
| **Haiku** | Golden-file capture, the test-runner split, JSON scaffolding for cases, the CATS tag table, label lint tests, guide skeletons | Mechanical, checkable work |
| **Human** | Spikes on hardware, JMRI and CATS; the test track; a mock meet; reading the guides as a newcomer | Needs real equipment and judgement |

Every PR gets a code review before merge (`/code-review`). Any PR that touches the engine, the C++ core, lock emitters or expander health also gets a separate Opus review focused only on fail-safe behaviour.

## Release 0 — Groundwork (6–10 days)

No user-visible change.

| # | Work item | Class | Done when |
|---|---|---|---|
| 0.1 | **CI.** `test.yml` runs `npm test` and validates generated JMRI XML against JMRI's `layout-4-19-2.xsd` with `xmllint`, on PRs into `feature/logic` and `main` and on pushes to both. `pages.yml` deploys only after it passes (this takes effect on `main` at the final merge). (The CMake and `esphome compile` jobs are added by 2.3 and 2.4.) | Sonnet | A failing test blocks a PR |
| 0.2 | **Golden files** for every fixture, the compare test, and `UPDATE_GOLDEN=1` | Haiku | Passes on `main`, fails on any change |
| 0.3 | **Test runner** loads several `*.test.js` files and modules into `vm` | Haiku | `npm test` runs them all |
| 0.4 | **Spike A: the component** (ESP32, ESPHome 2026.11): an `mr_logic` component from a tag, with the rule table passed as a nested schema or a packed string (compare `esphome config` time on a 200-rule table), emitted as `static const` data. The 100 ms loop, and its jitter while MQTT connects. Read a `binary_sensor`; run typed scripts (`Script<bool>` for `_show`, `_throw_*`, `_latch_*`). **Decide how the component drives mast aspects and turnout locks**: typed `globals` by id, or the YAML reading the component. Moving from `is_running()` or recorded by hooks. `_show` is `mode: restart`, so confirm the scan writes only on change. Boot order against today's `on_boot` steps (-150 startup aspect, -200 point and latch moves): suppress the startup aspect when logic restores on, latch scripts wait for the start-up scan, and what "detectors settled" means with a 500 ms debounce. MQTT callbacks run on the main loop. RAM with about 40 `mqtt_subscribe` text sensors. Flash, RAM and scan time for 200 rules | Opus + Human | A written decision and numbers, added to the field logic spec |
| 0.5 | **Spike B: ESPHome behaviour.** Runtime `subscribe` / `unsubscribe` and resubscribe after a broker restart. A template `text` with `restore_value`, edited from the web server page (v2 and v3). A retained flood of about 50 topics on connect. The MCP23017 unplugged mid-run. `layout-mqtt.local` as the broker. Captive-portal Wi-Fi across a reboot and a reflash. The Owner-topic clash check. A Release waiting on the broker at connect | Human + Sonnet | Each confirmed, or the spec corrected |
| 0.6 | **Spike C: JMRI and CATS.** The Release turnout snapping back through feedback on its command topic. The switch light's echo and a retained `ON` / `OFF`. CATS Hold Only payloads (`null; Lit; Held`). A Logic-box XML file loading in PanelPro | Human | Each confirmed, or the spec corrected |

## Release 1 — Foundations, no interpreter (15–20 days)

Unique names, more sensor pins, shared state, and blocks that JMRI and CATS can use.

| # | Work item | Class | Done when |
|---|---|---|---|
| 1.1 | **Board name suffix**: six characters on new boards, kept on rename; the typed part at most 19; Add a suffix; New suffix when importing as a new board | Sonnet | The board-name tests pass; golden unchanged |
| 1.2 | **MCP23017 expanders** on the Sensors page. `gpio` versus expander-and-pin runs through pin conflict checks, dropdowns, emitters and import; bus limits per ESP32 variant; the pin budget hint | Sonnet (split: data and validation; UI; emitters) | Expander tests pass; compiles on hardware beside a PCA9685 on the same bus |
| 1.3 | **Logic page shell**: nav entry, mode selector, Settings (Share), checklist, plain-word labels. Starts on / off and the checklist's Try it step stay hidden until Release 2 | Sonnet | Mode None byte-identical to golden; label lint passes |
| 1.4 | **Share with other boards**: Online birth, will and shutdown, sensor `/State`, turnout `/Moving`, mast `/State`, the Owner topic and clash check (moved from 1.1, since only a sharing board publishes Owner). Reserved names: no `logic/` or `board/` prefix, no `/State`, `/Moving` or `/Locked` suffix. Disable MQTT makes Share an error | Sonnet | "Share on its own adds the publishes and nothing else"; the Disable MQTT tests pass |
| 1.5 | **Linked boards**, for remote sensors and turnouts only (remote masts need tags, so they come in Release 2), plus typed names; `mqtt_subscribe` with known and not known; **Refresh**, and a warning when a linked board's file has changed | Sonnet | Remote-input tests pass |
| 1.6 | **Blocks**: template binary sensors, remote members, the expander health check, JMRI XML under the new Logic tick box | Sonnet, Opus fail-safe review | Block tests pass; a block with a member on an unplugged expander reads occupied on hardware |
| 1.7 | **Reference integrity**: renaming a sensor, turnout or mast updates every reference on the Logic page; deleting one marks what used it invalid | Sonnet | Rename and delete tests pass |
| 1.8 | **Guide**: `field-logic-guide.md`, first chapter: suffixes, expanders, Share, blocks | Sonnet, Human reads | A newcomer adds a block with an optical sensor and sees it in JMRI |

## Release 2 — Field Logic (40–55 days)

The interpreter on the board and in the browser, the starters most layouts need, and enough Try it and checking to meet the spec's principles 8 and 9 at launch.

| # | Work item | Class | Done when |
|---|---|---|---|
| 2.0 | **CATS tags and diverging list** beside `CATS_ASPECTS` in `generator.js` | Haiku | All-30-aspects test passes |
| 2.1 | **Engine cases**, hand-written from every Scan, Rules, Fail safe and Block signals test in the spec, including logic-off equivalence and a Release waiting at connect | Opus writes, Haiku scaffolds the JSON | Every spec test bullet maps to a case; reviewed before 2.2 starts |
| 2.2 | **JS engine** (`logic.js`): latches, scan, plain and reserving rules, resources and waiting order, approach locking, who wins, holds and stale holds, manual release, switch, start-up scan, approach lighting (dark after who-wins), **Explain** sentences | Opus | All cases pass; Explain tests pass |
| 2.3 | **C++ core** and `engine-tests/`, replaying the same cases; CMake job in CI | Opus | Both engines pass every case |
| 2.3b | **Compact core**: the C++ core compiles the rule table once at boot into index-based arrays read straight from the JSON string in flash, and the engine refers to it instead of copying it (Spike A's numbers: the string-based core needs about 350 KB of heap for 200 rules) | Opus | Every case and the cross-check pass; a 200-rule table fits in under 32 KB of heap on the computer measure |
| 2.4 | **ESPHome adapter and codegen**: rule table, sensors, turnouts, masts and scripts bound by Spike A's decision; holds from `mqtt_subscribe`; the switch entity and light; Release buttons and turnouts (with the connect rule); Held, State and Version publishes; start-up order and the toggle-switch boot wait; expander health; Disable MQTT; `esphome compile` of the gauntlet fixture in CI on PRs touching `components/`, and weekly against the latest ESPHome | Opus leads start-up, boot, lock and not-known wiring; Sonnet does the codegen | Gauntlet example works on hardware |
| 2.5 | **Generator** (`logic-yaml.js`): rule table; version code from a canonical serialisation that leaves out display-only fields (such as `starter`); field-controlled mast handlers; virtual masts (no lamp code, `/State`, not in JMRI XML); approach lighting; JMRI XML items; Disable MQTT | Sonnet | Generator tests pass; golden unchanged for mode None |
| 2.5b | **Turnout lock emitters**: `<id>_field_locked` beside the remote lock in fascia button guards, latch scripts and the `was_locked` re-sync; the lock report without Remote lock | Sonnet, Opus fail-safe review | Lock tests pass; golden unchanged for boards without logic |
| 2.6 | **Validation and cycle check**: every bullet in the spec's Validation, in plain words, each with a link and a fix | Opus | Validation tests pass |
| 2.7 | **Logic page, Field Logic parts**, split four ways: (a) Masts (tags, diverging, stop aspect, approach lighting, virtual masts) and Buttons (on ESP or expander pins); (b) Resources and the rule-card editor (When / Only if / Then, all of / any of / not, *for*, *then* sequences, More options); (c) layers view and control table; (d) Explain on each mast, starters-first empty page, warnings and the version code on the Download page. Remote masts in Linked boards | Sonnet | UI tests pass |
| 2.8 | **Starters** in `logic-starters.js`: One-train section (gauntlet default), Lock turnouts under a train, Block signals (diverging fallback), Route signal (follow the next mast) | Sonnet; Opus for Block signals and Route signal | Each worked example passes as an engine case; callable from Node tests |
| 2.9 | **Checker**: deadlock, starvation, unreachable rules, masts stuck at Stop; random-run fallback; **Show me** | Opus | Finds the deliberate deadlock; passes the one-train section |
| 2.10 | **Try it**: input panel with "not known", mast pictures (reusing `.mini-mast`), step and real time, Show timing details, **strip diagram** for starters with a track shape, **Run a train** | Sonnet | Run a train shows each row of the tumbledown example |
| 2.11 | **Printable summary** | Sonnet | Lists every logic-set mast and every block with its pins |
| 2.12 | **Hardware acceptance**: the gauntlet over a bridge and a three-signal tumbledown on a test track, with JMRI and CATS holding a mast, and logic switched off and on | Human | The worked examples behave on track |
| 2.13 | **Guide**: Field Logic chapters, from a starter to working signals, Try it, flashing | Sonnet, Human reads | A newcomer gets the gauntlet working from the guide |

Level crossing is left out: it needs a new output type, and becomes its own small spec.

## Release 3 — Plant ends (15–20 days)

| # | Work item | Class | Done when |
|---|---|---|---|
| 3.1 | **Engine**: end Block and Mast, pass-through, no echo, `end` and empty links, and the **pairing state machine**, in JS and C++. A **multi-board case harness** wiring several engines by their ends | Opus | Plant-end and pairing cases pass in both engines, including three boards with one turned round |
| 3.2 | **Component**: runtime subscriptions (exact topics, one per end track), the `…/Link` topic (retained, and taking a new value), Link text entity, Pair button, LED, state text, the disagreeing-link check | Sonnet, Opus review | Two boards pair on hardware |
| 3.3 | **Logic page**: Plant ends part (end tracks, end sensors, first mast or pass-through, Pair and LED pins, on ESP or expander pins). Block signals and Route signal can name a plant end as the next mast; blocks can include what an end hears. Disable MQTT makes plant ends an error | Sonnet | UI and generator tests pass |
| 3.4 | **Try it**: pretend neighbours, using the multi-board harness | Sonnet | Usable |
| 3.5 | **Hardware acceptance**: three boards, the middle one turned round, paired by buttons; pull a board's power and the joint goes to Stop; meet Wi-Fi through the captive portal | Human | Behaves as one board; fails safe |
| 3.6 | **Guide**: plant ends and meets chapter | Sonnet, Human reads | A newcomer pairs two boards |

## Release 4 — MSS Logic (20–25 days)

| # | Work item | Class | Done when |
|---|---|---|---|
| 4.1 | **MSS builder** (`mss-builder.js`), using `logic-starters.js`: tracks, blocks, boundaries, junctions and routes, plant ends, Signals grid, MSS validation mapped back to the part of the description that caused it. Importing an MSS board as a linked board runs the builder | Opus | Builder tests and MSS behaviour cases pass (Appendix B rows, the User Guide sequence, junctions, Approach Diverging) |
| 4.2 | **MSS page**, split: (a) guided steps, Ends and Signals grid with approach lighting; (b) strip editor; (c) junction shapes and routes; (d) read-only built items in the layers view and control table, red-dot problems, MSS plain labels in the lint | Sonnet | Usable by someone who has not read the spec |
| 4.3 | **Convert to Field Logic** | Sonnet | Same YAML and version code before and after |
| 4.4 | **Module card** | Sonnet | Lists every sensor, signal and pin, and the pairing and Wi-Fi steps |
| 4.5 | **Checker limits**: measure on a busy junction module and a four-entrance section; write them into the spec | Opus | The open question closed |
| 4.6 | **Hardware acceptance**: a plain-track module and a turnout-junction module paired, with a CATS hold on the junction mast | Human | MSS behaviour on track |
| 4.7 | **Guide**: `mss-logic-guide.md` | Sonnet, Human reads | A newcomer builds and pairs two modules |

## Track plan — before Release 5

Setting up Field Logic with two kinds of building block, the drawing and your own pieces and rules, as the [track plan spec](field-logic-plan-spec.md) describes. Added after Release 4, from feedback on Field Logic; the old Field Logic page is rebuilt from scratch from a mock approved on 2026-11-26. Milestone *Track plan*; not yet sized.

| # | Work item | Class | Status | Done when |
|---|---|---|---|---|
| TP 0 (#135) | **Clickable mock** of the new page | Opus | approved | The spec and issues are rewritten from it |
| TP 1 (#123) | **Hide Plant ends in Field Logic** | Sonnet | merged | A Field Logic board with no ends shows none |
| TP 2 (#124) | **Stored format and builder** (`plan-builder.js`), continuous runs and turnout locking included | Opus | merged; fail-safe sign-off open | Hand-worked cases for the gauntlet, a junction, a passing siding and a diamond pass |
| TP 3 (#125) | **First grid editor** | Sonnet | merged; replaced by TP 6 | — |
| TP 4 (#139) | **Routes**, as on the prototype: controlled signals asked for in Auto by the board, or in Manual by CATS or JMRI or a signal button, with a board-wide Auto/Manual switch; set all at once, released behind the train; route locking; paired crossovers; sections removed (engine changes in JS and C++). Amended 2026-11-27; built on the first attempt, #141 | Opus | merged (#144); fail-safe signed off | The cases in the track plan spec's work table pass in both engines |
| TP 5 (#137) | **Checker on drawn plans** | Opus | built; fail-safe sign-off open | The passing siding and a station of 20 blocks, 10 signals and 8 turnouts are checked completely |
| TP 5b (#147) | **Checker explores the Auto/Manual switch and holds** | Opus | built; fail-safe sign-off open | The plan cases are checked in Auto and Manual; the passing siding, scissors and station still complete |
| TP 6 (#136) | **The new page**: steps, drawing, making hardware, protection shown, problems on the drawing | Sonnet | not started | A newcomer on an empty page has one thing to do; the TP 2 drawings can be drawn |
| TP 7 (#126) | **Pieces, rules and examples**, with the switch, lamp and turnout-lock changes on the board | Opus, Sonnet | not started | The gauntlet with a button, and an industry siding with a local panel, built from an empty page |
| TP 8 (#127) | **Try it and Run a train** on the drawing | Sonnet | not started | A meet on a crossing loop runs on the drawing |
| TP 9 (#138) | **Remove the old Field Logic page** and its keys | Sonnet | not started | No Field Logic screen but the new one is left |
| TP 10 (#128) | **New Field Logic guide** and its pictures | Sonnet, Human reads | not started | A newcomer builds the gauntlet from it |

## Release 5 — Wrap-up (5–8 days)

| # | Work item | Class | Done when |
|---|---|---|---|
| 5.1 | **Docs index**: `README.md`, `docs/README.md` and `AGENTS.md` updated for the Logic page and both modes | Sonnet | Agents and newcomers are sent to the right guide |
| 5.2 | **Newcomer read-through** of both guides on a fresh machine (the Field Logic guide after TP 10); fixes fed back into the page hints and guides | Human, Sonnet | Questions answered in the page, not in chat |
| 5.3 | **Merge to `main`**: tag `logic-v1.0.0`, set `LOGIC_COMPONENT_REF`, merge `main` in a final time, one PR from `feature/logic` into `main`, then check the live configurator after the Pages deploy | Human, Sonnet | The live page offers the Logic page, and a board downloaded from it builds |

## Milestones on the branch

What each release has on `feature/logic` that differs from the specs' end state. None of it reaches users until the final merge, but testers use each milestone:

- **Release 1** offers Field Logic with Share, Linked boards (sensors and turnouts) and Blocks only. It generates no component, no switch and no rules, and hides Starts on and the Try it step. A board saved in Release 1 gains the component and switch when downloaded again after Release 2.
- **Releases 1–2** have no plant ends; Release 3 adds them. **Releases 1–3** have no MSS Logic in the mode list.

## Order and dependencies

```
R0 groundwork ─▶ R1 foundations ─▶ R2 Field Logic ─▶ R3 plant ends ─▶ R4 MSS Logic ─▶ track plan ─▶ R5 wrap-up ─▶ merge to main
                                    (engine, checker,   (pairing,        (builder uses
                                     Try it, starters)   multi-board)     starters, Try it,
                                                                          plant ends)
```

Within a release, cases and tests come first. UI and generator work run in parallel once the cases exist. Release 2 is the biggest; its four UI parts (2.7a–d) and the checker (2.9) can be built in parallel with the C++ work.

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| JS and C++ engines drift | The browser checks something the board does not run | One set of hand-written cases, run by both in CI; the version code is shown on both sides |
| The engine becomes its own oracle | Bugs baked into the expected outputs | Cases written from the specs by hand and reviewed before the engine exists |
| The live page names a tag that does not exist yet | Boards fail to build | Tag before merge; CI checks the ref; Pages deploys only after tests |
| `esphome config` does not compile C++ | A broken component slips through | `esphome compile` on PRs touching `components/` and weekly against the latest ESPHome |
| ESPHome API churn (MQTT callback types removed in 2027.5) | The component stops compiling | Weekly build against the latest release; `min_version` emitted only with the component; the component pinned per configurator release |
| Mast and lock globals are templated in ESPHome | The adapter is awkward | Spike A decides between typed ids and the YAML reading the component |
| Rule table too big, or scans too slow | Missed deadlines; flash or RAM limits | Spike A measures 200 rules; flash `const` tables; overruns logged |
| A retained flood on connect overwhelms the board | Missed messages or a reset | Spike B measures about 50 subscriptions |
| MCP23017 failures are silent in ESPHome | Stuck inputs instead of fail safe | Health check per scan and in block lambdas; unplugged in Spike B |
| A Release sent while a board was away fires on reconnect | A section freed under a train | Ignored for 5 s after connect (now in the spec); tested in 2.1 and Spike B |
| Logic off stops matching today for field-controlled masts | Surprise behaviour with logic switched off | A logic-off equivalence case |
| The version code changes on a display-only edit, or after Convert | False "board is running different logic" | Canonical serialisation without display-only fields; Convert test |
| Golden files block unrelated fixes on `main` | Friction | `UPDATE_GOLDEN=1` with sign-off |
| Captive-portal Wi-Fi lasts only until the config changes | Surprise after a reflash | In the spec, the module card and the guide |
| `.local` broker name does not resolve on some networks | Boards cannot reach the broker | Spike B; the configurator already accepts a LAN IP |
| Checker state explosion | Slow or useless checks | Measured in 4.5: checked in parts, with inputs the rules cannot tell apart merged; a quick budget in validation and Check every combination on the Download page; random-run fallback past both (spec, Checker limits) |
| `app.js` and `generator.js` keep growing | Hard to change safely | Logic lives in new modules; existing files gain only hooks |
| `feature/logic` drifts from `main` over months | A painful final merge | Merge `main` in at least weekly; logic in new files keeps conflicts to the hooks |

## Done

The plan is done when `feature/logic` has merged into `main` and:
- every test bullet in both specs exists and passes in CI, in JS and C++ where both apply
- logic mode None produces today's YAML and JMRI XML byte-for-byte
- the spec's worked examples (gauntlet, tumbledown, three paired boards, a junction module) behave on a real test track
- someone who has wired a detector but never read the specs follows each guide to working signals, and their questions are fed back into the page and the guides
- the only open questions left are ones the specs list.

Total: roughly 100–140 person-days across the six releases, most of it in Release 2. The track plan is on top of that.
