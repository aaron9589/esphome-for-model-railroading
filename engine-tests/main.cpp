// Replays configurator/test/cases/*.json against the C++ core, the same way
// configurator/test/engine-runner.js replays them against logic.js. A
// multi-board case (`boards`) runs one engine per board with the same broker
// between them as the JS runner (test/cases/README.md, Multi-board cases).
//   engine_tests <cases dir>
// Exits non-zero if any case fails.
#include <algorithm>
#include <cstdio>
#include <dirent.h>
#include <fstream>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "../components/mr_logic/logic_core.h"
#include "json.h"
#include "../components/mr_logic/logic_table.h"

using namespace logic_core;
using json::Value;

namespace {

Start to_start(const Value *v) {
  Start s;
  if (!v) return s;
  s.board = v->text("board");
  s.logic_on = v->text("logic", "on") != "off";
  s.broker_connected = v->text("broker", "connected") != "disconnected";
  if (const Value *x = v->get("links"))
    for (const auto &p : x->obj) s.links.emplace_back(p.first, p.second.str);
  if (const Value *x = v->get("sensors"))
    for (const auto &p : x->obj) s.sensors_occupied[p.first] = p.second.str == "occupied";
  if (const Value *x = v->get("turnouts"))
    for (const auto &p : x->obj) s.turnouts[p.first] = p.second.str;
  if (const Value *x = v->get("jmri"))
    for (const auto &p : x->obj) s.jmri.emplace_back(p.first, p.second.str);
  if (const Value *x = v->get("remoteLocks"))
    for (const auto &p : x->obj) s.remote_locks[p.first] = p.second.str == "locked";
  if (const Value *x = v->get("remote")) {
    for (const auto &p : x->obj) {
      RemoteStart r;
      r.board = p.first;
      if (const Value *o = p.second.get("online")) r.online = o->b ? 1 : 0;
      if (const Value *m = p.second.get("sensors"))
        for (const auto &q : m->obj) r.sensors[q.first] = q.second.str;
      if (const Value *m = p.second.get("turnouts"))
        for (const auto &q : m->obj) r.turnouts[q.first] = q.second.str;
      if (const Value *m = p.second.get("masts"))
        for (const auto &q : m->obj) r.masts[q.first] = q.second.str;
      s.remote.push_back(r);
    }
  }
  return s;
}

// An event on a plant end, in the order logic.js's endEvent reads its keys.
// One with none of them changes nothing (track -1 is no track).
Event to_end_event(const Value &v) {
  Event e;
  e.kind = Event::END_BLOCK;
  e.track = -1;
  e.name = v.text("end");
  if (v.has("pair")) {
    e.kind = Event::END_PAIR;
    e.value = v.text("pair");
  } else if (v.has("link")) {
    e.kind = Event::END_LINK;
    e.value = v.text("link");
  } else if (v.has("theirLink")) {
    e.kind = Event::END_THEIR_LINK;
    e.value = v.text("theirLink");
  } else if (const Value *o = v.get("online")) {
    e.kind = Event::END_ONLINE;
    e.flag = o->type == Value::BOOL && o->b;
  } else if (const Value *t = v.get("track")) {
    // Number.isInteger in logic.js: anything else is no track.
    const bool whole = t->type == Value::NUM && t->num >= -1e9 && t->num <= 1e9 && t->num == static_cast<double>(static_cast<int32_t>(t->num));
    if (v.has("block")) {
      e.track = whole ? static_cast<int32_t>(t->num) : -1;
      e.value = v.text("block");
    } else if (v.has("mast")) {
      e.kind = Event::END_MAST;
      e.track = whole ? static_cast<int32_t>(t->num) : -1;
      e.value = v.text("mast");
    }
  }
  return e;
}

Event to_event(const Value &v) {
  Event e;
  if (v.has("board")) {
    e.board = v.text("board");
    if (const Value *o = v.get("online")) {
      e.kind = Event::REMOTE_ONLINE;
      e.flag = o->b;
    } else if (v.has("mast")) {
      e.kind = Event::REMOTE_MAST;
      e.name = v.text("mast");
      e.value = v.text("aspect");
    } else {
      e.kind = Event::REMOTE_ITEM;
      e.item_kind = v.has("turnout") ? "turnout" : v.has("block") ? "block" : "sensor";
      e.name = v.text(e.item_kind);
      e.value = v.text("is");
    }
    return e;
  }
  if (v.has("end")) return to_end_event(v);
  if (v.has("pairing")) {
    e.kind = Event::PAIRING;
    e.value = v.text("pairing");
    return e;
  }
  struct Map {
    const char *key;
    Event::Kind kind;
    const char *value;
  };
  const Map maps[] = {
      {"sensor", Event::SENSOR, "is"},       {"button", Event::BUTTON, "is"},
      {"turnout", Event::TURNOUT, "is"},     {"remoteLock", Event::REMOTE_LOCK, "is"},
      {"jmri", Event::JMRI, "message"},      {"release", Event::RELEASE, "via"},
  };
  for (const auto &m : maps) {
    if (v.has(m.key)) {
      e.kind = m.kind;
      e.name = v.text(m.key);
      e.value = v.text(m.value);
      return e;
    }
  }
  if (v.has("logic")) {
    e.kind = Event::LOGIC;
    e.value = v.text("logic");
  } else if (v.has("broker")) {
    e.kind = Event::BROKER;
    e.value = v.text("broker");
  }
  return e;
}

Value nullable(const std::string &s) { return s.empty() ? Value() : json::str(s); }

Value to_json(const LogEvent &e) {
  using json::object;
  using json::str;
  switch (e.kind) {
    case LogEvent::STARTUP: return object({{"startup", json::boolean(true)}});
    case LogEvent::GRANT: return object({{"grant", str(e.what)}, {"rule", str(e.rule)}});
    case LogEvent::CANCEL: return object({{"cancel", str(e.what)}, {"rule", str(e.rule)}});
    case LogEvent::PASS: return object({{"pass", str(e.what)}, {"rule", nullable(e.rule)}});
    case LogEvent::RELEASE: return object({{"release", str(e.what)}, {"by", str(e.by)}});
    case LogEvent::IGNORED: return object({{"ignored", str("release")}, {"resource", str(e.what)}});
    case LogEvent::RESYNC: return object({{"resync", str(e.what)}});
    case LogEvent::PAIRING:
      if (e.by == "paired") return object({{"pairing", str(e.what)}, {"result", str(e.by)}, {"with", str(e.rule)}});
      return object({{"pairing", str(e.what)}, {"result", str(e.by)}});
    case LogEvent::DISAGREES: return object({{"disagrees", str(e.what)}, {"link", str(e.rule)}, {"theirs", str(e.by)}});
  }
  return Value();
}

Value to_json(const Write &w) {
  if (w.lock) return json::object({{"lock", json::str(w.name)}, {"on", json::boolean(w.on)}});
  return json::object({{"mast", json::str(w.name)}, {"aspect", json::str(w.aspect)}});
}

Value to_json(const Publish &p) {
  using json::object;
  using json::str;
  switch (p.kind) {
    case Publish::HELD: return object({{"resource", str(p.resource)}, {"held", str(p.value)}});
    case Publish::STATE: return object({{"resource", str(p.resource)}, {"state", str(p.value)}});
    case Publish::RELEASE: return object({{"release", str(p.resource)}, {"value", str(p.value)}});
    case Publish::PAIRING: return object({{"pairing", str(p.value)}});
    case Publish::END_LINK: return object({{"end", str(p.resource)}, {"link", str(p.value)}});
    case Publish::END_BLOCK: return object({{"end", str(p.resource)}, {"track", json::number(p.track)}, {"block", str(p.value)}});
    case Publish::END_MAST: return object({{"end", str(p.resource)}, {"track", json::number(p.track)}, {"mast", str(p.value)}});
  }
  return Value();
}

template <typename T>
Value list(const std::vector<T> &items) {
  Value v;
  v.type = Value::ARR;
  for (const auto &x : items) v.arr.push_back(to_json(x));
  return v;
}

// Compares one step's expect with a scan's outputs and the state after it.
void check_step(std::vector<std::string> *problems, const std::string &label, const Value *expect, const ScanOut &out,
                const State &s) {
  if (!expect) return;
  const std::string where = label + ": ";
  if (const Value *logic = expect->get("logic")) {
    std::string got = s.logic_on ? "on" : "off";
    if (got != logic->str) problems->push_back(where + "logic is " + got + ", expected " + logic->str);
  }
  // A link is a string, "" included; elsewhere "" is null (nothing).
  auto check_strings = [&](const char *name, const std::vector<std::pair<std::string, std::string>> &have, bool keep_empty) {
    const Value *want = expect->get(name);
    if (!want) return;
    for (const auto &p : want->obj) {
      auto it = std::find_if(have.begin(), have.end(), [&](const auto &h) { return h.first == p.first; });
      Value got = it == have.end() ? json::str("(missing)") : keep_empty ? json::str(it->second) : nullable(it->second);
      if (!json::equal(got, p.second))
        problems->push_back(where + name + " " + p.first + " is " + json::dump(got) + ", expected " + json::dump(p.second));
    }
  };
  auto check_bools = [&](const char *name, const std::vector<std::pair<std::string, bool>> &have) {
    const Value *want = expect->get(name);
    if (!want) return;
    for (const auto &p : want->obj) {
      auto it = std::find_if(have.begin(), have.end(), [&](const auto &h) { return h.first == p.first; });
      if (it == have.end() || it->second != p.second.b)
        problems->push_back(where + name + " " + p.first + " is wrong, expected " + json::dump(p.second));
    }
  };
  check_strings("masts", s.masts, false);
  check_strings("rules", s.rules, false);
  check_strings("resources", s.resources, false);
  check_strings("holders", s.holders, false);
  check_bools("locks", s.locks);
  check_bools("locked", s.locked);
  check_strings("ends", s.ends, false);
  check_strings("links", s.links, true);
  const std::pair<const char *, Value> outputs[] = {
      {"events", list(out.events)}, {"writes", list(out.writes)}, {"publishes", list(out.publishes)}};
  for (const auto &o : outputs) {
    const Value *want = expect->get(o.first);
    if (want && !json::equal(o.second, *want))
      problems->push_back(where + o.first + " " + json::dump(o.second) + ", expected " + json::dump(*want));
  }
}

std::vector<std::string> run_single_case(const Value &data) {
  std::vector<std::string> problems;
  const Value *board = data.get("board");
  const Value *steps = data.get("steps");
  if (!board || !steps) return {"the case has no board or no steps"};
  std::string table_error;
  Table table;
  if (!compile_table(json::dump(*board).c_str(), &table, &table_error)) return {"the board cannot be read: " + table_error};
  Engine engine(table, to_start(data.get("start")));
  int64_t next = 0;
  for (const auto &step : steps->arr) {
    const Value *at_value = step.get("at");
    if (!at_value) return {"a step has no at"};
    int64_t at = static_cast<int64_t>(at_value->num);
    while (next < at) {
      engine.scan();
      next++;
    }
    if (const Value *d = step.get("do"))
      for (const auto &e : d->arr) engine.event(to_event(e));
    ScanOut out = engine.scan();
    next++;
    check_step(&problems, "scan " + std::to_string(at), step.get("expect"), out, engine.state());
  }
  return problems;
}

// --- The broker between boards, as createBroker in engine-runner.js ---------

// A link's target, "<board>/<end>", as the engine reads it (README rule 24),
// or "" when the end hears no one.
std::string target(const std::string &link, const std::string &board, const std::string &end) {
  size_t at = link.rfind('/');
  if (link == "end" || at == std::string::npos || at == 0 || at == link.size() - 1 || link == board + "/" + end) return "";
  return link;
}

Value message(std::vector<std::pair<std::string, Value>> fields) { return json::object(std::move(fields)); }

class Broker {
 public:
  Broker(const std::vector<std::string> &names, const std::map<std::string, bool> &connected) : names_(names) {
    for (const auto &name : names)
      if (connected.at(name)) online_[name] = true;
  }

  // One round: each board's publishes (as JSON), the boards whose connection
  // changed, which are connected now, and each board's ends and their links.
  // Returns the events each board hears before the next round.
  std::map<std::string, std::vector<Value>> route(const std::map<std::string, Value> &publishes,
                                                  const std::set<std::string> &changed,
                                                  const std::map<std::string, bool> &connected,
                                                  const std::map<std::string, std::vector<std::pair<std::string, std::string>>> &links) {
    std::map<std::string, std::vector<Value>> messages;
    std::vector<std::string> announcements;
    for (const auto &name : names_) {
      auto it = publishes.find(name);
      if (it == publishes.end()) continue;
      for (const auto &p : it->second.arr) {
        if (p.has("pairing")) announcements.push_back(p.text("pairing"));
        if (!p.has("end")) continue;
        const std::string who = name + "/" + p.text("end");
        if (p.has("link")) {
          // An empty retained message clears the topic; subscribers still get it.
          const std::string link = p.text("link");
          retained_[who].has_link = !link.empty();
          retained_[who].link = link;
          messages[who].push_back(message({{"theirLink", json::str(link)}}));
        } else if (p.has("block")) {
          const int track = static_cast<int>(p.get("track")->num);
          const std::string block = p.text("block") == "ACTIVE" ? "occupied" : "clear";
          retained_[who].tracks[track].first = block;
          messages[who].push_back(message({{"track", json::number(track)}, {"block", json::str(block)}}));
        } else if (p.has("mast")) {
          const int track = static_cast<int>(p.get("track")->num);
          retained_[who].tracks[track].second = p.text("mast");
          messages[who].push_back(message({{"track", json::number(track)}, {"mast", json::str(p.text("mast"))}}));
        }
      }
    }
    // A board that connected or went away: its Online (birth, or will).
    std::map<std::string, bool> online_now;
    for (const auto &name : changed) {
      online_[name] = connected.at(name);
      online_now[name] = connected.at(name);
    }
    std::map<std::string, std::vector<Value>> heard;
    std::map<std::string, std::vector<std::string>> next;
    for (const auto &name : names_) {
      const auto &ends = links.at(name);
      std::vector<std::string> now;
      for (const auto &e : ends) now.push_back(target(e.second, name, e.first));
      const std::vector<std::string> &before = targets_[name];
      next[name] = now;
      auto &out = heard[name];
      if (!connected.at(name)) continue;
      for (size_t i = 0; i < ends.size(); i++) {
        const std::string &who = now[i];
        if (who.empty()) continue;
        const std::string board = who.substr(0, who.rfind('/'));
        std::vector<Value> got;
        if (changed.count(name) || i >= before.size() || before[i] != who) {
          got = replay(who);
        } else {
          if (online_now.count(board)) got.push_back(message({{"online", json::boolean(online_now[board])}}));
          for (const auto &m : messages[who]) got.push_back(m);
        }
        for (const auto &m : got) {
          Value e = message({{"end", json::str(ends[i].first)}});
          for (const auto &f : m.obj) e.obj.push_back(f);
          out.push_back(e);
        }
      }
      for (const auto &a : announcements) out.push_back(message({{"pairing", json::str(a)}}));
    }
    targets_ = next;
    return heard;
  }

 private:
  struct RetainedEnd {
    bool has_link = false;
    std::string link;
    std::map<int, std::pair<std::string, std::string>> tracks;  // block, mast; "" not yet
  };

  // Everything retained that an end subscribed to `who` hears.
  std::vector<Value> replay(const std::string &who) {
    std::vector<Value> out;
    const std::string board = who.substr(0, who.rfind('/'));
    if (online_.count(board)) out.push_back(message({{"online", json::boolean(online_[board])}}));
    auto it = retained_.find(who);
    if (it == retained_.end()) return out;
    if (it->second.has_link) out.push_back(message({{"theirLink", json::str(it->second.link)}}));
    for (const auto &t : it->second.tracks) {
      if (!t.second.first.empty()) out.push_back(message({{"track", json::number(t.first)}, {"block", json::str(t.second.first)}}));
      if (!t.second.second.empty()) out.push_back(message({{"track", json::number(t.first)}, {"mast", json::str(t.second.second)}}));
    }
    return out;
  }

  std::vector<std::string> names_;
  std::map<std::string, RetainedEnd> retained_;
  std::map<std::string, bool> online_;
  std::map<std::string, std::vector<std::string>> targets_;
};

// A multi-board case: one engine per board, in `boards` order, wired by the broker.
std::vector<std::string> run_multi_case(const Value &data) {
  const Value *boards = data.get("boards");
  const Value *steps = data.get("steps");
  if (!steps) return {"the case has no steps"};
  const Value *starts = data.get("start");
  std::vector<std::string> names;
  std::vector<std::unique_ptr<Table>> tables;
  std::vector<std::unique_ptr<Engine>> engines;
  std::map<std::string, bool> connected;
  for (const auto &b : boards->obj) {
    std::string table_error;
    tables.emplace_back(new Table());
    if (!compile_table(json::dump(b.second).c_str(), tables.back().get(), &table_error))
      return {b.first + ": the board cannot be read: " + table_error};
    Start start = to_start(starts ? starts->get(b.first) : nullptr);
    start.board = b.first;
    engines.emplace_back(new Engine(*tables.back(), start));
    names.push_back(b.first);
    connected[b.first] = start.broker_connected;
  }
  Broker broker(names, connected);
  std::map<std::string, std::vector<Value>> inbox;
  std::vector<std::string> problems;
  int64_t next = 0;
  for (const auto &step : steps->arr) {
    const Value *at_value = step.get("at");
    if (!at_value) return {"a step has no at"};
    const int64_t at = static_cast<int64_t>(at_value->num);
    const Value *dos = step.get("do");
    while (next <= at) {
      std::set<std::string> changed;
      for (size_t i = 0; i < names.size(); i++) {
        Engine &engine = *engines[i];
        for (const auto &e : inbox[names[i]]) engine.event(to_event(e));
        const Value *d = next == at && dos ? dos->get(names[i]) : nullptr;
        for (const auto &e : d ? d->arr : std::vector<Value>()) {
          engine.event(to_event(e));
          if (e.has("broker")) {
            const bool now = e.text("broker") == "connected";
            if (now != connected[names[i]]) changed.insert(names[i]);
            connected[names[i]] = now;
          }
        }
      }
      std::vector<ScanOut> outs;
      std::map<std::string, Value> publishes;
      for (size_t i = 0; i < names.size(); i++) {
        outs.push_back(engines[i]->scan());
        publishes[names[i]] = list(outs.back().publishes);
      }
      std::map<std::string, std::vector<std::pair<std::string, std::string>>> links;
      for (size_t i = 0; i < names.size(); i++) links[names[i]] = engines[i]->state().links;
      inbox = broker.route(publishes, changed, connected, links);
      if (next == at) {
        const Value *expect = step.get("expect");
        for (size_t i = 0; i < names.size(); i++) {
          check_step(&problems, names[i] + ", scan " + std::to_string(at), expect ? expect->get(names[i]) : nullptr, outs[i],
                     engines[i]->state());
        }
      }
      next++;
    }
  }
  return problems;
}

std::vector<std::string> run_case(const Value &data) {
  return data.get("boards") ? run_multi_case(data) : run_single_case(data);
}

template <typename T>
Value pairs(const std::vector<std::pair<std::string, T>> &items, Value (*make)(const T &)) {
  Value v;
  v.type = Value::OBJ;
  for (const auto &p : items) v.obj.emplace_back(p.first, make(p.second));
  return v;
}
Value from_string(const std::string &s) { return nullable(s); }
Value from_text(const std::string &s) { return json::str(s); }
Value from_bool(const bool &b) { return json::boolean(b); }

// Trace mode, for the JS-against-C++ cross-check (configurator/test/engine-diff.test.js):
// reads { board, start, scans: [[event, ...], ...] } and prints, for each scan,
// its outputs and the state after it, as one JSON array.
int run_trace(const std::string &path) {
  std::ifstream in(path);
  std::stringstream buffer;
  buffer << in.rdbuf();
  std::string text = buffer.str();
  Value data;
  std::string error;
  if (!json::Parser(text).parse(&data, &error)) {
    std::fprintf(stderr, "%s\n", error.c_str());
    return 2;
  }
  if (!data.get("board") || !data.get("scans")) {
    std::fprintf(stderr, "a trace needs board and scans\n");
    return 2;
  }
  std::string table_error;
  Table table;
  if (!compile_table(json::dump(*data.get("board")).c_str(), &table, &table_error)) {
    std::fprintf(stderr, "the board cannot be read: %s\n", table_error.c_str());
    return 2;
  }
  Engine engine(table, to_start(data.get("start")));
  std::string out = "[";
  bool first = true;
  for (const auto &scan : data.get("scans")->arr) {
    for (const auto &e : scan.arr) engine.event(to_event(e));
    ScanOut o = engine.scan();
    State s = engine.state();
    Value row = json::object({
        {"events", list(o.events)},
        {"writes", list(o.writes)},
        {"publishes", list(o.publishes)},
        {"logic", json::str(s.logic_on ? "on" : "off")},
        {"masts", pairs(s.masts, from_string)},
        {"rules", pairs(s.rules, from_string)},
        {"resources", pairs(s.resources, from_string)},
        {"holders", pairs(s.holders, from_string)},
        {"locks", pairs(s.locks, from_bool)},
        {"locked", pairs(s.locked, from_bool)},
        {"ends", pairs(s.ends, from_text)},
        {"links", pairs(s.links, from_text)},
    });
    out += (first ? "" : ",") + json::dump(row);
    first = false;
  }
  std::printf("%s]\n", out.c_str());
  return 0;
}

}  // namespace

// Durations mode, for the cross-check: one time per line in, the milliseconds
// (or "null" when it cannot be read) out, one per line.
int run_durations() {
  char line[256];
  while (std::fgets(line, sizeof line, stdin)) {
    std::string text(line);
    if (!text.empty() && text.back() == '\n') text.pop_back();
    uint32_t ms = 0;
    if (parse_ms(text, &ms))
      std::printf("%u\n", (unsigned) ms);
    else
      std::printf("null\n");
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 3 && std::string(argv[1]) == "--trace") return run_trace(argv[2]);
  if (argc == 2 && std::string(argv[1]) == "--durations") return run_durations();
  if (argc < 2) {
    std::fprintf(stderr, "usage: engine_tests <cases dir> | engine_tests --trace <trace.json>\n");
    return 2;
  }
  std::string dir = argv[1];
  std::vector<std::string> files;
  if (DIR *d = opendir(dir.c_str())) {
    while (dirent *entry = readdir(d)) {
      std::string name = entry->d_name;
      if (name.size() > 5 && name.compare(name.size() - 5, 5, ".json") == 0) files.push_back(name);
    }
    closedir(d);
  }
  std::sort(files.begin(), files.end());
  if (files.empty()) {
    std::fprintf(stderr, "no cases in %s\n", dir.c_str());
    return 2;
  }
  int failed = 0;
  for (const auto &file : files) {
    std::ifstream in(dir + "/" + file);
    std::stringstream buffer;
    buffer << in.rdbuf();
    std::string text = buffer.str();
    Value data;
    std::string error;
    if (!json::Parser(text).parse(&data, &error)) {
      std::printf("fail - %s: %s\n", file.c_str(), error.c_str());
      failed++;
      continue;
    }
    std::vector<std::string> problems = run_case(data);
    if (problems.empty()) {
      std::printf("ok - %s\n", file.c_str());
    } else {
      failed++;
      std::printf("fail - %s\n", file.c_str());
      for (const auto &p : problems) std::printf("    %s\n", p.c_str());
    }
  }
  std::printf("\n%d of %zu cases failed.\n", failed, files.size());
  return failed ? 1 : 0;
}
