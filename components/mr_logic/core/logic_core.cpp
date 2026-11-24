// See logic_core.h. Each function here has a namesake in configurator/logic.js;
// keep the two in step. Rule numbers refer to configurator/test/cases/README.md.
#include "logic_core.h"

#include <algorithm>

namespace mr_logic {

namespace {

const char *const TAG_NAMES[] = {"stop", "restricting", "approach", "advance", "clear"};
const char *const HELD_NAMES[] = {"R292", "Stop"};

std::string key(const char *kind, const std::string &name) { return std::string(kind) + '\0' + name; }

bool contains(const std::vector<std::string> &list, const std::string &value) {
  return std::find(list.begin(), list.end(), value) != list.end();
}

std::string trim(const std::string &s) {
  size_t a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  size_t b = s.find_last_not_of(" \t\r\n");
  return s.substr(a, b - a + 1);
}

Tag tag_of(const MastDef &mast, const std::string &aspect) {
  for (const auto &a : mast.aspects)
    if (a.first == aspect) return a.second;
  return TAG_NONE;
}

std::vector<std::string> states_of(const MastDef &mast, const std::string &aspect) {
  std::vector<std::string> out;
  auto it = mast.states.find(aspect);
  if (it == mast.states.end()) {
    out.push_back(aspect + "; Lit; Unheld");
    return out;
  }
  for (const auto &s : it->second) {
    std::string t = trim(s);
    if (!t.empty()) out.push_back(t);
  }
  return out;
}

}  // namespace

Tag tag_from_name(const std::string &name) {
  for (int i = 0; i < 5; i++)
    if (name == TAG_NAMES[i]) return static_cast<Tag>(i);
  return TAG_NONE;
}

const char *tag_name(Tag tag) { return tag == TAG_NONE ? "" : TAG_NAMES[tag]; }

std::string stop_aspect(const MastDef &mast) {
  if (!mast.stop.empty() && tag_of(mast, mast.stop) != TAG_NONE) return mast.stop;
  for (const char *name : HELD_NAMES)
    if (tag_of(mast, name) == TAG_STOP) return name;
  for (const auto &a : mast.aspects)
    if (a.second == TAG_STOP) return a.first;
  return mast.aspects.empty() ? std::string() : mast.aspects.front().first;
}

bool pick_aspect(const MastDef &mast, const std::string &x, std::string *out) {
  std::vector<std::pair<std::string, std::string>> by_name;  // first wins
  auto find_name = [&](const std::string &name) -> const std::string * {
    for (const auto &p : by_name)
      if (p.first == name) return &p.second;
    return nullptr;
  };
  for (const auto &a : mast.aspects) {
    for (const auto &state : states_of(mast, a.first)) {
      if (x == state) {
        *out = a.first;
        return true;
      }
      std::string name = trim(state.substr(0, state.find(';')));
      if (!name.empty() && !find_name(name)) by_name.emplace_back(name, a.first);
    }
  }
  if (x.find("; Unlit") != std::string::npos) {
    *out = "dark";
    return true;
  }
  if (x.find("; Held") != std::string::npos) {
    for (const char *name : HELD_NAMES) {
      if (const std::string *a = find_name(name)) {
        *out = *a;
        return true;
      }
    }
    *out = "dark";
    return true;
  }
  std::string name = x.substr(0, x.find(';'));
  while (!name.empty() && name.back() == ' ') name.pop_back();
  if (const std::string *a = find_name(name)) {
    *out = *a;
    return true;
  }
  return false;
}

// --- set-up ---------------------------------------------------------------

Engine::Engine(const Board &board, const Start &start) : board_(board) {
  for (const auto &layer : board_.layers) {
    std::vector<int> list;
    for (size_t i = 0; i < layer.rules.size(); i++) {
      Rule rule;
      rule.def = &layer.rules[i];
      rule.ref = layer.name + "/" + std::to_string(i + 1);
      rule.index = static_cast<int>(rules_.size());
      list.push_back(rule.index);
      rules_.push_back(rule);
    }
    layer_rules_.push_back(list);
  }
  for (const auto &def : board_.resources) {
    Resource res;
    res.def = &def;
    resources_.push_back(res);
  }
  for (auto &rule : rules_) {
    const std::string &reserve = rule.def->then.reserve;
    if (reserve.empty()) continue;
    for (size_t i = 0; i < resources_.size(); i++) {
      // Names are unique once validated; if not, the first one wins, as in logic.js.
      if (resources_[i].def->name == reserve) {
        rule.resource = static_cast<int>(i);
        resources_[i].rules.push_back(rule.index);
        break;
      }
    }
  }
  for (const auto &m : board_.masts) {
    for (const auto &rule : rules_) {
      if (rule.def->then.mast == m.name) {
        field_masts_.push_back(m.name);
        break;
      }
    }
  }
  for (const auto &t : board_.turnouts) {
    turnouts_[t] = "closed";
    remote_locks_[t] = false;
    field_locks_[t] = false;
  }
  for (const auto &b : board_.remote) remote_[b.name] = Remote();

  broker_ = start.broker_connected;
  connect_at_ = broker_ ? 0 : -1;
  publish_all_ = broker_;
  logic_on_ = start.logic_on;
  startup_next_ = logic_on_;

  for (const auto &m : board_.masts) {
    display_[m.name] = (!m.startup.empty() && tag_of(m, m.startup) != TAG_NONE) ? m.startup : "";
    if (is_field(m.name)) {
      jmri_shown_[m.name] = "";
      holds_[m.name] = false;
      prev_out_[m.name] = stop_aspect(m);
      if (logic_on_) display_[m.name] = stop_aspect(m);
    }
  }

  for (const auto &rule : rules_) {
    const Trigger &t = rule.def->trigger;
    if (t.when) {
      for (const auto &m : t.seq) track(m);
    } else if (t.present) {
      track(t.cond);
    }
    if (rule.def->has_cancel) track(rule.def->cancel);
  }
  for (const auto &res : resources_) {
    if (res.def->release.when)
      for (const auto &m : res.def->release.seq) track(m);
  }
  for (auto &rule : rules_) reset_trigger(rule);
  for (auto &res : resources_) reset_release(res);

  for (const auto &s : start.sensors_occupied) input("sensor", s.first).value = s.second;
  for (const auto &t : start.turnouts) turnouts_[t.first] = t.second;
  for (const auto &t : start.remote_locks) remote_locks_[t.first] = t.second;
  for (const auto &rs : start.remote) {
    auto it = remote_.find(rs.board);
    if (it == remote_.end()) continue;
    if (rs.online >= 0) it->second.online = rs.online;
    for (const auto &s : rs.sensors) it->second.items[key(remote_kind(rs.board, s.first).c_str(), s.first)] = s.second;
    for (const auto &s : rs.turnouts) it->second.items[key("turnout", s.first)] = s.second;
    for (const auto &s : rs.masts) it->second.items[key("mast", s.first)] = s.second;
  }
  for (const auto &j : start.jmri) jmri_message(j.first, j.second);
  for (const auto &t : board_.turnouts) prev_locked_[t] = remote_locks_[t];
  record_edges();
}

void Engine::track(const Cond &c) { tracked_.push_back(&c); }

// --- lookups --------------------------------------------------------------

const MastDef *Engine::mast(const std::string &name) const {
  for (const auto &m : board_.masts)
    if (m.name == name) return &m;
  return nullptr;
}

const RemoteBoardDef *Engine::remote_board(const std::string &name) const {
  for (const auto &b : board_.remote)
    if (b.name == name) return &b;
  return nullptr;
}

const MastDef *Engine::remote_mast(const std::string &board, const std::string &name) const {
  const RemoteBoardDef *b = remote_board(board);
  if (!b) return nullptr;
  for (const auto &m : b->masts)
    if (m.name == name) return &m;
  return nullptr;
}

const BlockDef *Engine::logic_block(const std::string &name) const {
  for (const auto &b : board_.blocks)
    if (b.name == name) return &b;
  return nullptr;
}

bool Engine::is_field(const std::string &name) const { return contains(field_masts_, name); }

Engine::Latch &Engine::input(const char *kind, const std::string &name) { return latched_[key(kind, name)]; }

std::string Engine::remote_kind(const std::string &board, const std::string &name) const {
  const RemoteBoardDef *b = remote_board(board);
  return (b && contains(b->blocks, name)) ? "block" : "sensor";
}

bool Engine::remote_value(const std::string &board, const std::string &kind, const std::string &name,
                          std::string *out) const {
  auto it = remote_.find(board);
  if (it == remote_.end()) return false;
  auto v = it->second.items.find(key(kind.c_str(), name));
  if (v == it->second.items.end()) return false;
  *out = v->second;
  return true;
}

// Rule 14.
bool Engine::known(const std::string &board, bool has) const {
  auto it = remote_.find(board);
  return broker_ && it != remote_.end() && it->second.online == 1 && has;
}

// --- reading inputs -------------------------------------------------------

bool Engine::occupied(const std::string &name, bool remote, const std::string &board) {
  if (remote) {
    std::string value;
    bool has = remote_value(board, remote_kind(board, name), name, &value);
    return known(board, has) ? value == "occupied" : true;
  }
  if (const BlockDef *block = logic_block(name)) {
    for (const auto &m : block->members) {
      // A member on this board is one of its sensors; another board's is read there.
      if (m.remote ? occupied(m.name, true, m.board) : input("sensor", m.name).value) return true;
    }
    return false;
  }
  return input("sensor", name).value;
}

bool Engine::went(const std::string &name, bool on) {
  const BlockDef *block = logic_block(name);
  if (!block) return on ? input("sensor", name).on : input("sensor", name).off;
  auto it = prev_block_.find(name);
  bool prev = it != prev_block_.end() && it->second;
  bool now = occupied(name, false, "");
  bool pulsed = false;
  for (const auto &m : block->members)
    if (!m.remote && input("sensor", m.name).on) pulsed = true;
  return on ? (!prev && (now || pulsed)) : (!now && (prev || pulsed));
}

bool Engine::turnout_is(const std::string &name, bool remote, const std::string &board, const std::string &is) {
  if (!remote) {
    auto it = turnouts_.find(name);
    return it != turnouts_.end() && it->second == is;
  }
  std::string value;
  bool has = remote_value(board, "turnout", name, &value);
  return known(board, has) && value == is;
}

// Rule 13.
void Engine::mast_reading(const std::string &name, bool remote, const std::string &board, const MastDef **def,
                          std::string *aspect, Tag *tag) {
  std::string a;
  if (remote) {
    *def = remote_mast(board, name);
    std::string value;
    bool has = remote_value(board, "mast", name, &value);
    a = known(board, has) ? value : "";
  } else {
    *def = mast(name);
    a = is_field(name) ? prev_out_[name] : display_[name];
  }
  Tag t = (*def && !a.empty() && a != "dark") ? tag_of(**def, a) : TAG_NONE;
  if (t == TAG_NONE) {
    *aspect = "";
    *tag = TAG_STOP;
  } else {
    *aspect = a;
    *tag = t;
  }
}

bool Engine::condition(const Cond &c) {
  switch (c.kind) {
    case Cond::ALL:
      for (const auto &k : c.kids)
        if (!condition(k)) return false;
      return true;
    case Cond::ANY:
      for (const auto &k : c.kids)
        if (condition(k)) return true;
      return false;
    case Cond::NOT:
      return c.kids.empty() ? true : !condition(c.kids.front());
    case Cond::BLOCK: {
      bool occ = occupied(c.name, c.remote, c.board);
      return (!c.is.empty() && c.is.front() == "clear") ? !occ : occ;
    }
    case Cond::TURNOUT:
      return !c.is.empty() && turnout_is(c.name, c.remote, c.board, c.is.front());
    case Cond::MAST: {
      const MastDef *def = nullptr;
      std::string aspect;
      Tag tag;
      mast_reading(c.name, c.remote, c.board, &def, &aspect, &tag);
      if (!c.is.empty() && c.is.front() == "diverging") return !aspect.empty() && def && contains(def->diverging, aspect);
      return contains(c.is, tag_name(tag));
    }
    case Cond::BUTTON:
      return input("button", c.name).value;
  }
  return false;
}

bool Engine::moment(const Cond &m) {
  if (!m.remote && m.kind == Cond::BUTTON) return !m.is.empty() && m.is.front() == "pressed" && input("button", m.name).on;
  if (!m.remote && m.kind == Cond::BLOCK) return went(m.name, m.is.empty() || m.is.front() != "clear");
  auto e = edges_.find(&m);
  return condition(m) && e != edges_.end() && !e->second;
}

bool Engine::same_input_in_order(const Cond &prev, const Cond &next) {
  if (prev.kind != Cond::BLOCK || next.kind != Cond::BLOCK || prev.remote || next.remote) return false;
  if (prev.name != next.name || logic_block(prev.name)) return false;
  const Latch &s = input("sensor", prev.name);
  const std::string a = prev.is.empty() ? "" : prev.is.front();
  const std::string b = next.is.empty() ? "" : next.is.front();
  if (a == "occupied" && b == "clear") return s.on && s.off && !s.value;
  if (a == "clear" && b == "occupied") return s.on && s.off && s.value;
  return false;
}

bool Engine::advance(const std::vector<Cond> &seq, size_t *p) {
  bool moved = false;
  while (*p < seq.size()) {
    const Cond &m = seq[*p];
    if (!moment(m)) break;
    if (moved && !same_input_in_order(seq[*p - 1], m)) break;
    *p += 1;
    moved = true;
  }
  if (*p == seq.size()) {
    *p = 0;
    return true;
  }
  return false;
}

// --- triggers and releases (rules 3, 5, 9, 20) ------------------------------

void Engine::reset_trigger(Rule &rule) {
  rule.trig = TrigState();
  rule.phase = IDLE;
}

void Engine::reset_release(Resource &res) {
  res.rel_run_true = -1;
  res.rel_seq_p = 0;
  res.rel_done = false;
}

bool Engine::held(const Resource &res) const { return res.holder >= 0 || res.startup_held; }

void Engine::eval_trigger(Rule &rule, const Ctx &ctx) {
  const Trigger &t = rule.def->trigger;
  TrigState &st = rule.trig;
  bool is_true;
  if (t.when) {
    if (advance(t.seq, &st.seq_p)) {
      st.request = true;
      if (rule.resource < 0) st.fired = true;
    }
    is_true = rule.resource >= 0 ? st.request : st.fired;
    st.fired = false;
  } else {
    bool raw = t.present && condition(t.cond);
    if (t.leaving_guard) {
      if (!raw)
        st.guard = false;
      else if (!ctx.startup && st.prev_raw == 0 && rule.resource >= 0 && ctx.held_at_start[rule.resource])
        st.guard = true;
    }
    st.prev_raw = raw ? 1 : 0;
    if (raw) {
      if (st.run_true < 0) st.run_true = n_;
      st.run_false = -1;
      if (!st.eff && (n_ - st.run_true) * SCAN_MS >= t.for_ms) st.eff = true;
    } else {
      if (st.run_false < 0) st.run_false = n_;
      st.run_true = -1;
      if (st.eff && (n_ - st.run_false) * SCAN_MS >= t.for_ms) st.eff = false;
    }
    is_true = st.eff && !st.guard;
  }
  if (is_true && st.since < 0) st.since = n_;
  if (!is_true) st.since = -1;
  rule.true_now = is_true;
  rule.checks_now = true;
  for (const auto &c : rule.def->checks) {
    if (!condition(c)) {
      rule.checks_now = false;
      break;
    }
  }
}

void Engine::eval_release(Resource &res) {
  const Trigger &t = res.def->release;
  if (t.when) {
    res.release_now = held(res) ? (advance(t.seq, &res.rel_seq_p) || res.rel_done) : false;
    if (res.release_now) res.rel_done = true;
    return;
  }
  bool raw = t.present && condition(t.cond);
  if (raw) {
    if (res.rel_run_true < 0) res.rel_run_true = n_;
  } else {
    res.rel_run_true = -1;
  }
  res.release_now = raw && (n_ - res.rel_run_true) * SCAN_MS >= t.for_ms;
}

void Engine::free_res(Resource &res) {
  if (res.holder >= 0) {
    rules_[res.holder].phase = IDLE;
    res.holder = -1;
  }
  res.startup_held = false;
  res.rel_seq_p = 0;
  res.rel_done = false;
}

bool Engine::block_occupied_or_went(const Resource &res) {
  for (const auto &b : res.def->blocks)
    if (occupied(b, false, "") || went(b, true)) return true;
  return false;
}

bool Engine::blocks_clear(const Resource &res) {
  for (const auto &b : res.def->blocks)
    if (occupied(b, false, "")) return false;
  return true;
}

bool Engine::mast_held(const Rule &rule) const {
  const std::string &m = rule.def->then.mast;
  if (m.empty()) return false;
  auto it = holds_.find(m);
  return it != holds_.end() && it->second;
}

bool Engine::is_active(const Rule &rule) const {
  return rule.resource >= 0 ? rule.phase == ACTIVE : (rule.true_now && rule.checks_now);
}

bool Engine::locks_held(const Rule &rule) const {
  return rule.resource >= 0 ? rule.phase != IDLE : (rule.true_now && rule.checks_now);
}

std::string Engine::resource_state(const Resource &res) const {
  if (res.startup_held) return "PASSED";
  if (res.holder < 0) return "IDLE";
  switch (rules_[res.holder].phase) {
    case ACTIVE: return "ACTIVE";
    case PASSED: return "PASSED";
    case CANCELLING: return "CANCELLING";
    default: return "IDLE";
  }
}

// --- writes and publishes (rules 21, 22) ----------------------------------

void Engine::finish(ScanOut *out, const std::map<std::string, std::string> &new_out,
                    const std::map<std::string, bool> &new_locks, bool has_out) {
  if (has_out) {
    for (const auto &m : field_masts_) {
      auto it = new_out.find(m);
      if (it == new_out.end()) continue;
      if (display_[m] != it->second) out->writes.push_back(Write{false, m, it->second, false});
      display_[m] = it->second;
    }
  }
  for (const auto &t : board_.turnouts) {
    bool now = new_locks.at(t);
    if (field_locks_[t] != now) out->writes.push_back(Write{true, t, "", now});
  }
  field_locks_ = new_locks;
  for (const auto &t : board_.turnouts) {
    bool locked = field_locks_[t] || remote_locks_[t];
    if (prev_locked_[t] && !locked) out->events.push_back(LogEvent{LogEvent::RESYNC, t, "", ""});
    prev_locked_[t] = locked;
  }
}

void Engine::publish_resources(ScanOut *out, const std::vector<std::string> &echoes) {
  if (!broker_) return;
  for (const auto &res : resources_) {
    const std::pair<Publish::Kind, std::string> values[] = {
        {Publish::HELD, held(res) ? "ACTIVE" : "INACTIVE"},
        {Publish::STATE, resource_state(res)},
    };
    for (const auto &v : values) {
      std::string id = res.def->name + '\0' + (v.first == Publish::HELD ? "held" : "state");
      auto it = published_.find(id);
      if (publish_all_ || it == published_.end() || it->second != v.second) {
        out->publishes.push_back(Publish{v.first, res.def->name, v.second});
        published_[id] = v.second;
      }
    }
  }
  for (const auto &name : echoes) out->publishes.push_back(Publish{Publish::RELEASE, name, "CLOSED"});
  publish_all_ = false;
}

void Engine::record_edges() {
  for (const Cond *m : tracked_) edges_[m] = condition(*m);
  for (const auto &b : board_.blocks) prev_block_[b.name] = occupied(b.name, false, "");
}

void Engine::end_scan() {
  for (auto &l : latched_) l.second.on = l.second.off = false;
  n_ += 1;
}

void Engine::switch_off(ScanOut *out, const std::vector<std::string> &echoes) {
  for (auto &res : resources_) {
    if (held(res)) {
      out->events.push_back(LogEvent{LogEvent::RELEASE, res.def->name, "", "switch"});
      free_res(res);
    }
  }
  for (auto &rule : rules_) reset_trigger(rule);
  std::map<std::string, std::string> new_out;
  for (const auto &m : field_masts_) {
    const std::string &shown = jmri_shown_[m];
    new_out[m] = shown.empty() ? stop_aspect(*mast(m)) : shown;
  }
  std::map<std::string, bool> no_locks;
  for (const auto &t : board_.turnouts) no_locks[t] = false;
  finish(out, new_out, no_locks, true);
  publish_resources(out, echoes);
  logic_on_ = false;
}

// --- the scan (rule 6) ----------------------------------------------------

ScanOut Engine::scan() {
  ScanOut out;
  if (pending_logic_ == "on" && !logic_on_) {
    logic_on_ = true;
    startup_next_ = true;
  }
  bool switching_off = pending_logic_ == "off" && logic_on_;
  pending_logic_.clear();
  if (switching_off || !logic_on_) {
    std::vector<std::string> echoes;
    if (broker_)
      for (const auto &p : pending_releases_) echoes.push_back(p.first);
    pending_releases_.clear();
    if (switching_off) {
      switch_off(&out, echoes);
    } else {
      std::map<std::string, bool> no_locks;
      for (const auto &t : board_.turnouts) no_locks[t] = false;
      finish(&out, {}, no_locks, false);
      for (const auto &name : echoes) out.publishes.push_back(Publish{Publish::RELEASE, name, "CLOSED"});
    }
    record_edges();
    end_scan();
    return out;
  }

  Ctx ctx;
  ctx.startup = startup_next_;
  for (const auto &res : resources_) ctx.held_at_start.push_back(held(res));
  startup_next_ = false;
  std::vector<std::string> force_stop;
  std::vector<bool> released_now(resources_.size(), false);
  std::vector<std::string> echoes;

  // 6.1: start-up, then manual releases.
  if (ctx.startup) {
    out.events.push_back(LogEvent{LogEvent::STARTUP, "", "", ""});
    for (auto &rule : rules_) reset_trigger(rule);
    for (auto &res : resources_) {
      free_res(res);
      reset_release(res);
    }
    for (const auto &m : field_masts_) prev_out_[m] = stop_aspect(*mast(m));
    for (auto &res : resources_) {
      for (const auto &b : res.def->blocks) {
        if (occupied(b, false, "")) {
          res.startup_held = true;
          out.events.push_back(LogEvent{LogEvent::PASS, res.def->name, "", ""});
          break;
        }
      }
    }
  }
  for (size_t i = 0; i < resources_.size(); i++) {
    Resource &res = resources_[i];
    for (const auto &press : pending_releases_) {
      if (press.first != res.def->name) continue;
      if (broker_) echoes.push_back(res.def->name);
      if (press.second) {
        out.events.push_back(LogEvent{LogEvent::IGNORED, res.def->name, "", ""});
        continue;
      }
      out.events.push_back(LogEvent{LogEvent::RELEASE, res.def->name, "", "manual"});
      free_res(res);
      released_now[i] = true;
      for (int r : res.rules) {
        const std::string &m = rules_[r].def->then.mast;
        if (m.empty()) continue;
        holds_[m] = false;
        force_stop.push_back(m);
      }
    }
  }
  pending_releases_.clear();

  // 6.2: releases read this scan, a start-up hold's release, then each rule.
  for (auto &res : resources_) eval_release(res);
  for (auto &res : resources_) {
    if (res.startup_held && res.release_now) {
      out.events.push_back(LogEvent{LogEvent::RELEASE, res.def->name, "", "release"});
      free_res(res);
    }
  }
  for (auto &rule : rules_) {
    eval_trigger(rule, ctx);
    if (rule.resource < 0) continue;
    Resource &res = resources_[rule.resource];
    if (res.holder != rule.index) continue;
    const std::string &name = res.def->name;
    if (rule.phase == ACTIVE) {
      const Trigger &t = rule.def->trigger;
      bool cancel = false;
      if (t.when) {
        if (rule.def->has_cancel && moment(rule.def->cancel)) {
          cancel = true;
          rule.trig.request = false;
        }
      } else if (!rule.true_now) {
        cancel = true;
      }
      if (!cancel && mast_held(rule)) {
        cancel = true;
        if (t.when) rule.trig.request = true;
      }
      if (cancel) {
        out.events.push_back(LogEvent{LogEvent::CANCEL, name, rule.ref, ""});
        if (res.def->approach_lock_ms > 0) {
          rule.phase = CANCELLING;
          rule.cancel_at = n_;
        } else {
          out.events.push_back(LogEvent{LogEvent::RELEASE, name, "", "cancel"});
          free_res(res);
          continue;
        }
      }
    }
    if ((rule.phase == ACTIVE || rule.phase == CANCELLING) && block_occupied_or_went(res)) {
      rule.phase = PASSED;
      out.events.push_back(LogEvent{LogEvent::PASS, name, rule.ref, ""});
    }
    if (rule.phase == CANCELLING && (n_ - rule.cancel_at) * SCAN_MS >= res.def->approach_lock_ms) {
      out.events.push_back(LogEvent{LogEvent::RELEASE, name, "", "time"});
      free_res(res);
      continue;
    }
    if (rule.phase == PASSED && res.release_now) {
      out.events.push_back(LogEvent{LogEvent::RELEASE, name, "", "release"});
      free_res(res);
    }
  }

  // 6.3: grants, longest waiting first, then list order.
  for (size_t i = 0; i < resources_.size(); i++) {
    Resource &res = resources_[i];
    if (held(res) || released_now[i] || !blocks_clear(res)) continue;
    int best = -1;
    for (int r : res.rules) {
      const Rule &rule = rules_[r];
      if (rule.phase != IDLE || !rule.true_now || !rule.checks_now || mast_held(rule)) continue;
      if (best < 0 || rule.trig.since < rules_[best].trig.since ||
          (rule.trig.since == rules_[best].trig.since && rule.index < rules_[best].index))
        best = r;
    }
    if (best < 0) continue;
    Rule &rule = rules_[best];
    rule.phase = ACTIVE;
    res.holder = best;
    res.rel_seq_p = 0;
    res.rel_done = false;
    if (rule.def->trigger.when) {
      rule.trig.request = false;
      rule.trig.since = -1;
    }
    out.events.push_back(LogEvent{LogEvent::GRANT, res.def->name, rule.ref, ""});
  }

  // 6.4: who wins each mast (rule 12), approach lighting, then the locks.
  std::map<std::string, std::string> new_out;
  for (const auto &m : field_masts_) {
    const MastDef &def = *mast(m);
    const std::string stop = stop_aspect(def);
    std::vector<std::string> answers;
    for (const auto &layer : layer_rules_) {
      bool sets = false;
      const Rule *winner = nullptr;
      for (int r : layer) {
        if (rules_[r].def->then.mast != m) continue;
        sets = true;
        if (!winner && is_active(rules_[r])) winner = &rules_[r];
      }
      if (!sets) continue;
      // Fail safe: an aspect the mast does not have is its stop aspect.
      answers.push_back(winner && tag_of(def, winner->def->then.aspect) != TAG_NONE ? winner->def->then.aspect : stop);
    }
    if (holds_[m] || contains(force_stop, m)) answers.push_back(stop);
    std::string pick = answers.empty() ? stop : answers.front();
    for (const auto &a : answers)
      if (tag_of(def, a) < tag_of(def, pick)) pick = a;
    if (!def.approach_light.empty() && !occupied(def.approach_light, false, "")) pick = "dark";
    new_out[m] = pick;
  }
  std::map<std::string, bool> new_locks;
  for (const auto &t : board_.turnouts) new_locks[t] = false;
  for (const auto &rule : rules_) {
    if (!locks_held(rule)) continue;
    for (const auto &t : rule.def->then.lock) new_locks[t] = true;
  }
  finish(&out, new_out, new_locks, true);
  record_edges();
  prev_out_ = new_out;
  publish_resources(&out, echoes);
  end_scan();
  return out;
}

// --- events ---------------------------------------------------------------

void Engine::set_latched(const char *kind, const std::string &name, bool value) {
  Latch &v = input(kind, name);
  if (v.value == value) return;
  v.value = value;
  if (value)
    v.on = true;
  else
    v.off = true;
}

void Engine::event(const Event &e) {
  int64_t t = n_ * SCAN_MS;
  switch (e.kind) {
    case Event::REMOTE_ONLINE: {
      auto it = remote_.find(e.board);
      if (it != remote_.end()) it->second.online = e.flag ? 1 : 0;
      return;
    }
    case Event::REMOTE_MAST: {
      auto it = remote_.find(e.board);
      if (it != remote_.end()) it->second.items[key("mast", e.name)] = e.value;
      return;
    }
    case Event::REMOTE_ITEM: {
      auto it = remote_.find(e.board);
      if (it == remote_.end()) return;
      std::string kind = e.item_kind == "turnout" ? "turnout" : remote_kind(e.board, e.name);
      std::string k = key(kind.c_str(), e.name);
      if (e.value == "unknown")
        it->second.items.erase(k);
      else
        it->second.items[k] = e.value;
      return;
    }
    case Event::SENSOR: return set_latched("sensor", e.name, e.value == "occupied");
    case Event::BUTTON: return set_latched("button", e.name, e.value == "pressed");
    case Event::TURNOUT: turnouts_[e.name] = e.value; return;
    case Event::REMOTE_LOCK: remote_locks_[e.name] = e.value == "locked"; return;
    case Event::JMRI: return jmri_message(e.name, e.value);
    case Event::RELEASE: {
      bool ignored = e.value == "mqtt" && connect_at_ >= 0 && t - connect_at_ < RELEASE_WINDOW_MS;
      pending_releases_.emplace_back(e.name, ignored);
      return;
    }
    case Event::LOGIC: pending_logic_ = e.value; return;
    case Event::BROKER:
      if (e.value == "connected") {
        broker_ = true;
        connect_at_ = t;
        publish_all_ = true;
      } else if (e.value == "disconnected") {
        broker_ = false;
      }
      return;
  }
}

// Rules 15 and 17.
void Engine::jmri_message(const std::string &mast_name, const std::string &message) {
  const MastDef *def = mast(mast_name);
  if (!def) return;
  std::string pick;
  bool picked = pick_aspect(*def, message, &pick);
  if (is_field(mast_name)) {
    holds_[mast_name] = message.find("; Held") != std::string::npos;
    if (picked) jmri_shown_[mast_name] = pick;
    if (!logic_on_ && picked) display_[mast_name] = pick;
  } else if (picked) {
    display_[mast_name] = pick;
  }
}

State Engine::state() const {
  State s;
  s.logic_on = logic_on_;
  for (const auto &m : board_.masts) s.masts.emplace_back(m.name, display_.at(m.name));
  for (const auto &rule : rules_) {
    const char *phase = "idle";
    if (logic_on_) {
      switch (rule.phase) {
        case ACTIVE: phase = "active"; break;
        case PASSED: phase = "passed"; break;
        case CANCELLING: phase = "cancelling"; break;
        default:
          phase = (rule.resource >= 0 && rule.true_now && rule.checks_now) ? "waiting" : "idle";
      }
    }
    s.rules.emplace_back(rule.ref, phase);
  }
  for (const auto &res : resources_) {
    s.resources.emplace_back(res.def->name, resource_state(res));
    s.holders.emplace_back(res.def->name, res.holder >= 0 ? rules_[res.holder].ref : "");
  }
  for (const auto &t : board_.turnouts) {
    s.locks.emplace_back(t, field_locks_.at(t));
    s.locked.emplace_back(t, field_locks_.at(t) || remote_locks_.at(t));
  }
  return s;
}

}  // namespace mr_logic
