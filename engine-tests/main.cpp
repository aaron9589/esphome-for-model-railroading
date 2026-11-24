// Replays configurator/test/cases/*.json against the C++ core, the same way
// configurator/test/engine-runner.js replays them against logic.js.
//   engine_tests <cases dir>
// Exits non-zero if any case fails.
#include <algorithm>
#include <cstdio>
#include <dirent.h>
#include <fstream>
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
  s.logic_on = v->text("logic", "on") != "off";
  s.broker_connected = v->text("broker", "connected") != "disconnected";
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
  }
  return Value();
}

Value to_json(const Write &w) {
  if (w.lock) return json::object({{"lock", json::str(w.name)}, {"on", json::boolean(w.on)}});
  return json::object({{"mast", json::str(w.name)}, {"aspect", json::str(w.aspect)}});
}

Value to_json(const Publish &p) {
  switch (p.kind) {
    case Publish::HELD: return json::object({{"resource", json::str(p.resource)}, {"held", json::str(p.value)}});
    case Publish::STATE: return json::object({{"resource", json::str(p.resource)}, {"state", json::str(p.value)}});
    case Publish::RELEASE: return json::object({{"release", json::str(p.resource)}, {"value", json::str(p.value)}});
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

std::vector<std::string> run_case(const Value &data) {
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
    State s = engine.state();
    const Value *expect = step.get("expect");
    if (!expect) continue;
    std::string where = "scan " + std::to_string(at) + ": ";
    if (const Value *logic = expect->get("logic")) {
      std::string got = s.logic_on ? "on" : "off";
      if (got != logic->str) problems.push_back(where + "logic is " + got + ", expected " + logic->str);
    }
    auto check_strings = [&](const char *name, const std::vector<std::pair<std::string, std::string>> &have) {
      const Value *want = expect->get(name);
      if (!want) return;
      for (const auto &p : want->obj) {
        auto it = std::find_if(have.begin(), have.end(), [&](const auto &h) { return h.first == p.first; });
        Value got = it == have.end() ? json::str("(missing)") : nullable(it->second);
        if (!json::equal(got, p.second))
          problems.push_back(where + name + " " + p.first + " is " + json::dump(got) + ", expected " + json::dump(p.second));
      }
    };
    auto check_bools = [&](const char *name, const std::vector<std::pair<std::string, bool>> &have) {
      const Value *want = expect->get(name);
      if (!want) return;
      for (const auto &p : want->obj) {
        auto it = std::find_if(have.begin(), have.end(), [&](const auto &h) { return h.first == p.first; });
        if (it == have.end() || it->second != p.second.b)
          problems.push_back(where + name + " " + p.first + " is wrong, expected " + json::dump(p.second));
      }
    };
    check_strings("masts", s.masts);
    check_strings("rules", s.rules);
    check_strings("resources", s.resources);
    check_strings("holders", s.holders);
    check_bools("locks", s.locks);
    check_bools("locked", s.locked);
    const std::pair<const char *, Value> outputs[] = {
        {"events", list(out.events)}, {"writes", list(out.writes)}, {"publishes", list(out.publishes)}};
    for (const auto &o : outputs) {
      const Value *want = expect->get(o.first);
      if (want && !json::equal(o.second, *want))
        problems.push_back(where + o.first + " " + json::dump(o.second) + ", expected " + json::dump(*want));
    }
  }
  return problems;
}

template <typename T>
Value pairs(const std::vector<std::pair<std::string, T>> &items, Value (*make)(const T &)) {
  Value v;
  v.type = Value::OBJ;
  for (const auto &p : items) v.obj.emplace_back(p.first, make(p.second));
  return v;
}
Value from_string(const std::string &s) { return nullable(s); }
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
