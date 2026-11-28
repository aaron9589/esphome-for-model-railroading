// See logic_core.h. Rule numbers refer to configurator/test/cases/README.md.
// Each function here has a counterpart in configurator/logic.js; keep the two
// in step. Names are resolved once by the compiler (logic_table.cpp), so the
// JS lookups by name live there: stopAspect, statesOf, tagOf, remoteKind and
// remoteItem. Here, occupied() is occupied_ref() and remote_occupied(), and
// mastReading() and turnoutState() are inside condition().
//
// Plant ends: linkKind is link_kind(), setLink set_link(), ready ready(),
// endHears end_hears(), inPairing in_pairing(), endState end_state(),
// endOffer end_offer(), joinPairing join_pairing(), heardPairing
// heard_pairing(), decidePairing decide_pairing(), finishEnds finish_ends()
// and endEvent end_event(). endByName is find_end() for events; the compiler
// resolves the names in the table.
#include "logic_core.h"

#include <algorithm>
#include <cstdlib>

namespace logic_core {

namespace {

const char *const TAG_NAMES[] = {"stop", "restricting", "approach", "advance", "clear"};

// Remote item values (Engine::remote_values_): not known yet, then by kind.
constexpr int16_t R_UNSET = -1;
constexpr int16_t R_NOT_ASPECT = -2;  // a mast's /State that is none of its aspects
constexpr int16_t R_CLEAR = 0, R_OCCUPIED = 1;

std::string trim(const std::string &s) {
  size_t a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  return s.substr(a, s.find_last_not_of(" \t\r\n") - a + 1);
}

template <typename T>
size_t vec_bytes(const std::vector<T> &v) {
  return v.capacity() * sizeof(T);
}

}  // namespace

Tag tag_from_name(const std::string &name) {
  for (int i = 0; i < 5; i++)
    if (name == TAG_NAMES[i]) return static_cast<Tag>(i);
  return TAG_NONE;
}

const char *tag_name(Tag tag) { return tag == TAG_NONE ? "" : TAG_NAMES[tag]; }

size_t Table::bytes() const {
  size_t n = names.chars.capacity() + vec_bytes(names.starts) + vec_bytes(nodes) + vec_bytes(kids) + vec_bytes(seq) + vec_bytes(aspects) +
             vec_bytes(states) + vec_bytes(block_refs) + vec_bytes(members) + vec_bytes(locks) + vec_bytes(lock_with) + vec_bytes(res_next) + vec_bytes(layer_routes) + vec_bytes(sensors) +
             vec_bytes(buttons) + vec_bytes(turnouts) + vec_bytes(masts) + vec_bytes(remote_boards) +
             vec_bytes(remote_masts) + vec_bytes(remote_items) + vec_bytes(blocks) + vec_bytes(resources) + vec_bytes(res_refs) +
             vec_bytes(rules) + vec_bytes(layers) + vec_bytes(ends) + vec_bytes(end_tracks) + vec_bytes(end_sensors);
  for (const auto &s : states) n += s.text.capacity() > 15 ? s.text.capacity() + 1 : 0;
  return n;
}

// --- set-up ---------------------------------------------------------------

Engine::Engine(const Table &table, const Start &start) : t_(table) {
  const size_t rules = t_.rules.size(), resources = t_.resources.size(), masts = t_.masts.size();
  rules_.resize(rules);
  res_.resize(resources);
  res_rules_.resize(resources);
  for (size_t r = 0; r < rules; r++)
    for (uint16_t k = 0; k < t_.rules[r].res_count; k++) res_rules_[res_of(static_cast<uint16_t>(r), k)].push_back(static_cast<uint16_t>(r));
  field_.assign(masts, false);
  for (const auto &rule : t_.rules)
    if (rule.mast != NONE) field_[rule.mast] = true;
  sensors_.resize(t_.sensors.size());
  buttons_.resize(t_.buttons.size());
  switches_.resize(t_.switches.size());
  panel_locks_.assign(t_.turnouts.size(), false);
  lamps_shown_.assign(t_.lamps.size(), 0);
  held_since_.assign(t_.nodes.size(), -1);
  last_at_.assign(t_.nodes.size(), -1);
  // Rule 34: every leaf condition with a for.
  for (size_t i = 0; i < t_.nodes.size(); i++) {
    const Node &c = t_.nodes[i];
    const bool leaf = c.kind != Node::ALL && c.kind != Node::ANY && c.kind != Node::NOT;
    if (leaf && c.within)
      within_.push_back(static_cast<uint16_t>(i));
    else if (leaf && c.timed)
      held_.push_back(static_cast<uint16_t>(i));
  }
  turnouts_.assign(t_.turnouts.size(), T_NONE);
  for (size_t i = 0; i < t_.declared_turnouts; i++) turnouts_[i] = T_CLOSED;
  remote_locks_.assign(t_.turnouts.size(), false);
  field_locks_.assign(t_.turnouts.size(), false);
  prev_locked_.assign(t_.turnouts.size(), false);
  online_.assign(t_.remote_boards.size(), -1);
  remote_values_.assign(t_.remote_items.size(), R_UNSET);
  edges_.assign(t_.nodes.size(), 2);
  prev_block_.assign(t_.blocks.size(), false);
  published_.assign(resources * 2, -1);

  auto_on_ = start.auto_on;
  timed_start_.assign(t_.nodes.size(), -1);
  broker_ = start.broker_connected;
  connect_at_ = broker_ ? 0 : -1;
  publish_all_ = broker_;
  logic_on_ = start.logic_on;
  startup_next_ = logic_on_;
  board_ = start.board;
  ends_publish_all_ = broker_;
  ends_.resize(t_.ends.size());
  for (size_t e = 0; e < t_.ends.size(); e++) {
    const size_t tracks = t_.ends[e].tracks_count;
    ends_[e].block.assign(tracks, -1);
    ends_[e].mast.assign(tracks, -1);
    ends_[e].published_block.assign(tracks, -1);
    ends_[e].published_mast.assign(tracks, -1);
    ends_[e].who = board_ + "/" + t_.names[t_.ends[e].name];
  }

  jmri_shown_.assign(masts, SHOWS_NOTHING);
  display_.assign(masts, SHOWS_NOTHING);
  prev_out_.assign(masts, SHOWS_NOTHING);
  holds_.assign(masts, false);
  last_held_.assign(masts, -1);
  hold_went_.assign(masts, 0);
  for (size_t m = 0; m < masts; m++) {
    display_[m] = t_.masts[m].startup;  // -1 (nothing) when it has none
    if (field_[m]) {
      prev_out_[m] = t_.masts[m].stop;
      if (logic_on_) display_[m] = t_.masts[m].stop;
    }
  }

  for (size_t r = 0; r < rules; r++) {
    const Trigger &t = t_.rules[r].trigger;
    if (t.when) {
      for (uint16_t i = 0; i < t.seq_count; i++) track(t_.seq[t.seq_first + i]);
    } else if (t.present && t.cond != NONE) {
      track(t.cond);
    }
    if (t_.rules[r].cancel != NONE) track(t_.rules[r].cancel);
    if (t_.rules[r].withdraw != NONE) track(t_.rules[r].withdraw);
  }
  // Requests (rule 5): a routes group's, shared by its reserving When rules,
  // or a reserving When rule's own.
  std::vector<uint16_t> layer_ask(t_.layers.size(), NONE);
  for (size_t l = 0; l < t_.layers.size(); l++) {
    if (!t_.layer_routes[l]) continue;
    layer_ask[l] = static_cast<uint16_t>(asks_.size());
    asks_.emplace_back();
  }
  for (size_t r = 0; r < rules; r++) {
    const Rule &rule = t_.rules[r];
    if (rule.res_count == 0 || !rule.trigger.when) continue;
    uint16_t a = layer_ask[rule.layer];
    if (a == NONE) {
      a = static_cast<uint16_t>(asks_.size());
      asks_.emplace_back();
    }
    rules_[r].ask = a;
    asks_[a].rules.push_back(static_cast<uint16_t>(r));
  }
  for (const auto &res : t_.resources)
    if (res.release.when)
      for (uint16_t i = 0; i < res.release.seq_count; i++) track(t_.seq[res.release.seq_first + i]);
  for (size_t r = 0; r < rules; r++) reset_trigger(static_cast<uint16_t>(r));
  for (size_t i = 0; i < resources; i++) reset_release(static_cast<uint16_t>(i));

  for (const auto &s : start.sensors_occupied) {
    int16_t i = find(t_.sensors, s.first);
    if (i >= 0) sensors_[i].value = s.second;
  }
  for (const auto &s : start.turnouts) {
    int16_t i = find(t_.turnouts, s.first);
    if (i < 0) continue;
    const std::string &v = s.second;
    turnouts_[i] = v == "closed" ? T_CLOSED : v == "thrown" ? T_THROWN : v == "moving" ? T_MOVING : T_OTHER;
  }
  for (const auto &s : start.remote_locks) {
    int16_t i = find(t_.turnouts, s.first);
    if (i >= 0) remote_locks_[i] = s.second;
  }
  for (const auto &s : start.switches) {
    int16_t i = find(t_.switches, s.first);
    if (i >= 0) switches_[i].value = s.second;
  }
  for (const auto &rs : start.remote) {
    int16_t b = find(t_.remote_boards, rs.board);
    if (b < 0) continue;
    if (rs.online >= 0) online_[b] = rs.online;
    for (const auto &s : rs.sensors) {
      Event e;
      e.kind = Event::REMOTE_ITEM;
      e.board = rs.board;
      e.item_kind = "sensor";
      e.name = s.first;
      e.value = s.second;
      event(e);
    }
    for (const auto &s : rs.turnouts) {
      Event e;
      e.kind = Event::REMOTE_ITEM;
      e.board = rs.board;
      e.item_kind = "turnout";
      e.name = s.first;
      e.value = s.second;
      event(e);
    }
    for (const auto &s : rs.masts) {
      Event e;
      e.kind = Event::REMOTE_MAST;
      e.board = rs.board;
      e.name = s.first;
      e.value = s.second;
      event(e);
    }
  }
  for (const auto &j : start.jmri) {
    int16_t m = find_mast(j.first);
    if (m >= 0) jmri_message(static_cast<uint16_t>(m), j.second);
  }
  for (const auto &l : start.links) {
    int16_t e = find_end(l.first);
    if (e >= 0) ends_[e].link = l.second;
  }
  for (size_t i = 0; i < t_.declared_turnouts; i++) prev_locked_[i] = remote_locks_[i];
  record_edges();
  starting_ = false;
}

void Engine::track(uint16_t node) {
  tracked_.push_back(node);
  const Node &m = t_.nodes[node];
  if (m.kind == Node::ANY)
    for (uint16_t i = 0; i < m.count; i++) track(t_.kids[m.first + i]);
  if (m.timed) timed_.push_back(node);
}

bool Engine::has_layer(const std::string &name) const {
  for (uint16_t l : t_.layers)
    if (t_.names.equals(l, name)) return true;
  return false;
}

size_t Engine::bytes() const {
  size_t n = vec_bytes(rules_) + vec_bytes(res_) + vec_bytes(res_rules_) + vec_bytes(sensors_) + vec_bytes(buttons_) +
             vec_bytes(turnouts_) + vec_bytes(online_) + vec_bytes(remote_values_) + vec_bytes(edges_) +
             vec_bytes(tracked_) + vec_bytes(jmri_shown_) + vec_bytes(display_) + vec_bytes(prev_out_) +
             vec_bytes(published_) + vec_bytes(ends_) + vec_bytes(pair_group_);
  for (const auto &v : res_rules_) n += vec_bytes(v);
  for (const auto &e : ends_)
    n += e.who.capacity() + e.link.capacity() + e.their_link.capacity() + e.published_link.capacity() + 4 * e.block.capacity();
  // vector<bool> packs bits.
  n += (field_.size() + remote_locks_.size() * 3 + prev_block_.size() + holds_.size()) / 8 + 6 * 16;
  return n;
}

// --- lookups --------------------------------------------------------------

int16_t Engine::find(const std::vector<uint16_t> &list, const std::string &name) const {
  for (size_t i = 0; i < list.size(); i++)
    if (t_.names.equals(list[i], name)) return static_cast<int16_t>(i);
  return -1;
}

int16_t Engine::find_mast(const std::string &name) const {
  for (size_t i = 0; i < t_.masts.size(); i++)
    if (t_.names.equals(t_.masts[i].name, name)) return static_cast<int16_t>(i);
  return -1;
}

int16_t Engine::find_remote_item(uint16_t board, uint8_t kind, const std::string &name) const {
  for (size_t i = 0; i < t_.remote_items.size(); i++) {
    const RemoteItem &it = t_.remote_items[i];
    if (it.board != board || !t_.names.equals(it.name, name)) continue;
    bool sensor_like = kind == RemoteItem::SENSOR || kind == RemoteItem::BLOCK;
    bool item_sensor_like = it.kind == RemoteItem::SENSOR || it.kind == RemoteItem::BLOCK;
    if (sensor_like ? item_sensor_like : it.kind == kind) return static_cast<int16_t>(i);
  }
  return -1;
}

int16_t Engine::aspect_index(const Mast &m, const std::string &name) const {
  for (uint16_t i = 0; i < m.aspect_count; i++)
    if (t_.names.equals(t_.aspects[m.aspect_first + i].name, name)) return static_cast<int16_t>(i);
  return -1;
}

Tag Engine::aspect_tag(const Mast &m, int16_t a) const {
  return (a < 0 || a >= static_cast<int16_t>(m.aspect_count)) ? TAG_NONE : t_.aspects[m.aspect_first + a].tag;
}

std::string Engine::aspect_text(uint16_t mast, int16_t a) const {
  if (a == SHOWS_DARK) return "dark";
  if (a < 0) return "";
  return t_.names[t_.aspects[t_.masts[mast].aspect_first + a].name];
}

// Rule 18, today's handler.
int16_t Engine::pick_aspect(uint16_t mast, const std::string &x) const {
  const Mast &m = t_.masts[mast];
  std::vector<std::pair<std::string, int16_t>> by_name;  // first wins
  auto note = [&](const std::string &state, int16_t a) {
    std::string name = trim(state.substr(0, state.find(';')));
    if (name.empty()) return;
    for (const auto &p : by_name)
      if (p.first == name) return;
    by_name.emplace_back(name, a);
  };
  for (uint16_t a = 0; a < m.aspect_count; a++) {
    const Aspect &asp = t_.aspects[m.aspect_first + a];
    if (!asp.custom_states) {
      std::string state = t_.names[asp.name] + "; Lit; Unheld";
      if (x == state) return static_cast<int16_t>(a);
      note(state, static_cast<int16_t>(a));
      continue;
    }
    for (uint16_t s = 0; s < m.states_count; s++) {
      const StateString &st = t_.states[m.states_first + s];
      if (st.aspect != static_cast<int16_t>(a)) continue;
      if (x == st.text) return static_cast<int16_t>(a);
      note(st.text, static_cast<int16_t>(a));
    }
  }
  auto named = [&](const std::string &name) -> int16_t {
    for (const auto &p : by_name)
      if (p.first == name) return p.second;
    return IGNORED;
  };
  if (x.find("; Unlit") != std::string::npos) return SHOWS_DARK;
  if (x.find("; Held") != std::string::npos) {
    for (const char *name : {"R292", "Stop"}) {
      int16_t a = named(name);
      if (a != IGNORED) return a;
    }
    return SHOWS_DARK;
  }
  std::string name = x.substr(0, x.find(';'));
  while (!name.empty() && name.back() == ' ') name.pop_back();
  return named(name);
}

// Rule 14.
bool Engine::known(uint16_t board, bool has) const { return broker_ && board != NONE && online_[board] == 1 && has; }

// --- reading inputs -------------------------------------------------------

bool Engine::remote_occupied(uint16_t item) {
  if (item == NONE) return true;
  int16_t v = remote_values_[item];
  return known(t_.remote_items[item].board, v != R_UNSET) ? v == R_OCCUPIED : true;
}

bool Engine::occupied_ref(uint16_t item, bool logic_block) {
  if (item == NONE) return false;
  if (!logic_block) return sensors_[item].value;
  const LogicBlock &b = t_.blocks[item];
  for (uint16_t i = 0; i < b.count; i++) {
    const Member &m = t_.members[b.first + i];
    if (m.remote == Member::END) {
      bool occ = true;
      Tag tag = TAG_STOP;
      end_hears(m.item, m.board, &occ, &tag);
      if (occ) return true;
    } else if (m.remote == Member::REMOTE ? remote_occupied(m.item) : sensors_[m.item].value) {
      return true;
    }
  }
  return false;
}

bool Engine::went(uint16_t item, bool logic_block, bool on) {
  if (item == NONE) return false;
  if (!logic_block) return on ? sensors_[item].on : sensors_[item].off;
  bool prev = prev_block_[item];
  bool now = occupied_ref(item, true);
  bool pulsed = false;
  const LogicBlock &b = t_.blocks[item];
  for (uint16_t i = 0; i < b.count; i++) {
    const Member &m = t_.members[b.first + i];
    if (!m.remote && sensors_[m.item].on) pulsed = true;
  }
  return on ? (!prev && (now || pulsed)) : (!now && (prev || pulsed));
}

// Rule 34: a condition with a for holds once its state has held that long.
bool Engine::condition(uint16_t index) {
  const Node &c = t_.nodes[index];
  // Rule 38: a moment or state within a time.
  if (c.within) {
    const int64_t at = last_at_[index];
    return at >= 0 && (n_ - at) * static_cast<int64_t>(SCAN_MS) < static_cast<int64_t>(c.within_ms);
  }
  if (c.timed) {
    const int64_t since = held_since_[index];
    return since >= 0 && (n_ - since) * static_cast<int64_t>(SCAN_MS) >= static_cast<int64_t>(c.for_ms) && condition_core(index);
  }
  return condition_core(index);
}

bool Engine::condition_core(uint16_t index) {
  const Node &c = t_.nodes[index];
  switch (c.kind) {
    case Node::ALL:
      for (uint16_t i = 0; i < c.count; i++)
        if (!condition(t_.kids[c.first + i])) return false;
      return true;
    case Node::ANY:
      for (uint16_t i = 0; i < c.count; i++)
        if (condition(t_.kids[c.first + i])) return true;
      return false;
    case Node::NOT:
      return c.count == 0 ? true : !condition(t_.kids[c.first]);
    case Node::BLOCK: {
      bool occ = c.remote ? remote_occupied(c.item) : occupied_ref(c.item, c.logic_block);
      return c.is == Node::IS_CLEAR ? !occ : occ;
    }
    case Node::TURNOUT: {
      uint8_t want = c.is == Node::IS_CLOSED   ? T_CLOSED
                     : c.is == Node::IS_THROWN ? T_THROWN
                     : c.is == Node::IS_MOVING ? T_MOVING
                                               : 0xFF;
      if (!c.remote) return c.item != NONE && turnouts_[c.item] == want;
      if (c.item == NONE) return false;
      int16_t v = remote_values_[c.item];
      return known(t_.remote_items[c.item].board, v != R_UNSET) && v == want;
    }
    case Node::MAST: {
      if (c.is == Node::IS_HELD || c.is == Node::IS_UNHELD)
        return c.item != NONE && last_held_[c.item] == (c.is == Node::IS_HELD ? 1 : 0);
      // Rule 13: what the mast reads as, or nothing (stop).
      const Mast *def = nullptr;
      int16_t a = -1;
      if (c.remote) {
        if (c.item != NONE) {
          const RemoteItem &it = t_.remote_items[c.item];
          def = it.mast == NONE ? nullptr : &t_.remote_masts[it.mast];
          int16_t v = remote_values_[c.item];
          if (known(it.board, v != R_UNSET)) a = v;
        }
      } else if (c.item != NONE) {
        def = &t_.masts[c.item];
        a = field_[c.item] ? prev_out_[c.item] : display_[c.item];
      }
      Tag tag = def ? aspect_tag(*def, a) : TAG_NONE;
      if (c.is == Node::IS_DIVERGING) return tag != TAG_NONE && t_.aspects[def->aspect_first + a].diverging;
      if (c.is != Node::IS_TAGS) return false;
      if (tag == TAG_NONE) tag = TAG_STOP;
      return (c.tags >> tag) & 1;
    }
    case Node::BUTTON:
      return c.item != NONE && buttons_[c.item].value;
    case Node::SWITCH:
      return c.item != NONE && switches_[c.item].value == (c.is != Node::IS_OFF);
    case Node::AUTO:
      return auto_on_ == (c.is == Node::IS_ON);
    case Node::END: {
      // What a plant end hears: its Block, or its Mast, which is a tag only.
      bool occ = true;
      Tag tag = TAG_STOP;
      end_hears(c.item, c.first, &occ, &tag);
      if (c.hears_mast) return c.is == Node::IS_TAGS && ((c.tags >> tag) & 1);
      return c.is == Node::IS_CLEAR ? !occ : occ;
    }
  }
  return false;
}

// An `if` counts a moment only while that condition holds, and a `for` only
// once its state has then held that long (rule 32).
bool Engine::moment(uint16_t index) {
  const Node &m = t_.nodes[index];
  bool now;
  if (m.timed) {
    const int64_t start = timed_start_[index];
    now = start >= 0 && n_ == start + static_cast<int64_t>((m.for_ms + SCAN_MS - 1) / SCAN_MS);
  } else {
    now = moment_now(index);
  }
  return now && (m.if_node == NONE || condition(m.if_node));
}

bool Engine::moment_now(uint16_t index) {
  const Node &m = t_.nodes[index];
  if (m.kind == Node::ANY) {
    for (uint16_t i = 0; i < m.count; i++)
      if (moment(t_.kids[m.first + i])) return true;
    return false;
  }
  if (m.kind == Node::MAST && (m.is == Node::IS_HELD || m.is == Node::IS_UNHELD))
    return m.item != NONE && (hold_went_[m.item] & (m.is == Node::IS_HELD ? 1 : 2)) != 0;
  if (m.kind == Node::SWITCH) return m.item != NONE && (m.is == Node::IS_OFF ? switches_[m.item].off : switches_[m.item].on);
  if (!m.remote && m.kind == Node::BUTTON) return m.is == Node::IS_PRESSED && m.item != NONE && buttons_[m.item].on;
  if (!m.remote && m.kind == Node::BLOCK && m.not_from) {
    // Rule 31: entered, and not from these. At start-up a train already there
    // counts as entered from where the board cannot tell.
    const bool entered = went(m.item, m.logic_block, true) || (startup_scan_ && occupied_ref(m.item, m.logic_block));
    return entered && !came_from(index);
  }
  if (!m.remote && m.kind == Node::BLOCK) return went(m.item, m.logic_block, m.is != Node::IS_CLEAR);
  return condition_core(index) && edges_[index] == 0;
}

// Where a train entering a block came from: the one neighbour occupied now,
// its block's next or those named; none or several cannot tell.
bool Engine::came_from(uint16_t index) {
  const Node &m = t_.nodes[index];
  std::vector<BlockRef> near;
  auto add = [&](const BlockRef &ref) {
    for (const auto &x : near)
      if (x.item == ref.item && x.logic_block == ref.logic_block) return;
    near.push_back(ref);
  };
  if (m.logic_block && m.item != NONE) {
    const LogicBlock &b = t_.blocks[m.item];
    for (uint16_t i = 0; i < b.next_count; i++) add(t_.block_refs[b.next_first + i]);
  }
  for (uint16_t i = 0; i < m.from_count; i++) add(t_.block_refs[m.from_first + i]);
  int found = 0;
  BlockRef occ{NONE, false};
  for (const auto &ref : near) {
    if (!occupied_ref(ref.item, ref.logic_block)) continue;
    found += 1;
    occ = ref;
  }
  if (found != 1) return false;
  for (uint16_t i = 0; i < m.from_count; i++) {
    const BlockRef &ref = t_.block_refs[m.from_first + i];
    if (ref.item == occ.item && ref.logic_block == occ.logic_block) return true;
  }
  return false;
}

// A timed moment's run starts when its state happens, and lasts while it holds.
void Engine::update_timed() {
  for (uint16_t node : timed_) {
    if (moment_now(node))
      timed_start_[node] = n_;
    else if (!condition_core(node))
      timed_start_[node] = -1;
  }
  // Rule 34: each held condition's run, once a scan.
  for (uint16_t node : held_) {
    if (!condition_core(node))
      held_since_[node] = -1;
    else if (held_since_[node] < 0)
      held_since_[node] = n_;
  }
  // Rule 38: each within condition's last time.
  for (uint16_t node : within_)
    if (moment_now(node) || condition_core(node)) last_at_[node] = n_;
}

// { sensor: X } and { block: X } are one input.
bool Engine::same_input_in_order(uint16_t pi, uint16_t ni) {
  const Node &prev = t_.nodes[pi], &next = t_.nodes[ni];
  if (prev.kind != Node::BLOCK || next.kind != Node::BLOCK) return false;
  if (prev.remote || next.remote) return false;
  if (prev.item != next.item || prev.logic_block || next.logic_block || prev.item == NONE) return false;
  const Latch &s = sensors_[prev.item];
  if (prev.is == Node::IS_OCCUPIED && next.is == Node::IS_CLEAR) return s.on && s.off && !s.value;
  if (prev.is == Node::IS_CLEAR && next.is == Node::IS_OCCUPIED) return s.on && s.off && s.value;
  return false;
}

bool Engine::advance(uint16_t first, uint16_t count, uint16_t *p) {
  bool moved = false;
  while (*p < count) {
    uint16_t m = t_.seq[first + *p];
    if (!moment(m)) break;
    if (moved && !same_input_in_order(t_.seq[first + *p - 1], m)) break;
    *p += 1;
    moved = true;
  }
  if (*p == count) {
    *p = 0;
    return true;
  }
  return false;
}

// --- plant ends (README rules 24-29) --------------------------------------

int16_t Engine::find_end(const std::string &name) const {
  for (size_t i = 0; i < t_.ends.size(); i++)
    if (t_.names.equals(t_.ends[i].name, name)) return static_cast<int16_t>(i);
  return -1;
}


// Rule 24.
Engine::Link Engine::link_kind(uint16_t e) const {
  const std::string &link = ends_[e].link;
  if (link == "end") return LINK_END;
  size_t at = link.rfind('/');
  if (at == std::string::npos || at == 0 || at == link.size() - 1 || link == who(e)) return LINK_EMPTY;
  return LINK_BOARD;
}

void Engine::set_link(uint16_t e, const std::string &link) {
  EndState &s = ends_[e];
  if (s.link == link) return;
  s.link = link;
  s.their_link.clear();
  s.online = -1;
  std::fill(s.block.begin(), s.block.end(), -1);
  std::fill(s.mast.begin(), s.mast.end(), -1);
}

// Rule 25. An empty their_link is never this end's address.
bool Engine::ready(uint16_t e) const { return broker_ && ends_[e].online == 1 && ends_[e].their_link == who(e); }

void Engine::end_hears(uint16_t e, int32_t track, bool *occupied, Tag *tag) const {
  *occupied = true;
  *tag = TAG_STOP;
  if (e == NONE || track < 1 || track > static_cast<int32_t>(t_.ends[e].tracks_count)) return;
  Link kind = link_kind(e);
  if (kind == LINK_END) {
    *occupied = false;
    return;
  }
  if (kind == LINK_EMPTY || !ready(e)) return;
  const int8_t block = ends_[e].block[track - 1], mast = ends_[e].mast[track - 1];
  *occupied = block != 0;
  if (mast >= 0) *tag = static_cast<Tag>(mast);
}

// Rule 26.
bool Engine::in_pairing(uint16_t e) const {
  const std::string &me = who(e);
  for (const auto &x : pair_group_)
    if (x.who == me) return true;
  for (const auto &g : closed_groups_)
    for (const auto &x : g)
      if (x.who == me) return true;
  return false;
}

Engine::EndStateKind Engine::end_state(uint16_t e) const {
  if (in_pairing(e)) return E_PAIRING;
  Link kind = link_kind(e);
  if (kind == LINK_EMPTY) return E_EMPTY;
  if (kind == LINK_END) return E_END;
  if (!broker_) return E_UNHEARD;
  const EndState &s = ends_[e];
  if (!s.their_link.empty() && s.their_link != who(e)) return E_DISAGREES;
  if (s.online != 1 || s.their_link.empty()) return E_UNHEARD;
  return E_HEARD;
}

// Rule 27: what track i (0 is track 1) of an end offers.
void Engine::end_offer(uint16_t e, uint16_t i, bool *occupied, Tag *tag) const {
  const EndTrack &track = t_.end_tracks[t_.ends[e].tracks_first + i];
  bool own = false;
  for (uint16_t k = 0; k < track.sensors_count; k++)
    if (sensors_[t_.end_sensors[track.sensors_first + k]].value) own = true;
  *occupied = own;
  *tag = TAG_STOP;
  if (track.through) {
    if (track.through_end != NONE && t_.ends[track.through_end].name == t_.ends[e].name) return;
    bool far = true;
    end_hears(track.through_end, track.through_track, &far, tag);
    *occupied = own || far;
    return;
  }
  if (track.mast != NONE) {
    Tag shown = aspect_tag(t_.masts[track.mast], display_[track.mast]);
    if (shown != TAG_NONE) *tag = shown;
  }
}

// Rule 28: an end joins the pairing group, or is renewed in it.
void Engine::join_pairing(const std::string &w, int32_t tracks, int64_t t) {
  bool closed = !pair_group_.empty();
  for (const auto &x : pair_group_)
    if (x.until > t) closed = false;
  if (closed) {
    closed_groups_.push_back(std::move(pair_group_));
    pair_group_.clear();
  }
  for (auto &x : pair_group_) {
    if (x.who != w) continue;
    x.until = t + PAIR_MS;
    x.tracks = tracks;
    return;
  }
  pair_group_.push_back(PairEntry{w, tracks, t + PAIR_MS});
}

// An announcement, <board>/<end>/<tracks>. This board's own is ignored.
void Engine::heard_pairing(const std::string &s, int64_t t) {
  size_t a = s.rfind('/');
  if (a == std::string::npos || a == 0) return;
  size_t b = s.rfind('/', a - 1);
  if (b == std::string::npos || b == 0 || a - b < 2) return;
  const std::string tracks = s.substr(a + 1);
  if (tracks.empty() || tracks.size() > 4) return;
  for (char c : tracks)
    if (c < '0' || c > '9') return;
  if (b == board_.size() && s.compare(0, b, board_) == 0) return;
  join_pairing(s.substr(0, a), static_cast<int32_t>(std::strtol(tracks.c_str(), nullptr, 10)), t);
}

void Engine::decide_pairing(ScanOut *out) {
  bool closed = !pair_group_.empty();
  for (const auto &x : pair_group_)
    if (x.until > n_ * static_cast<int64_t>(SCAN_MS)) closed = false;
  if (closed) {
    closed_groups_.push_back(std::move(pair_group_));
    pair_group_.clear();
  }
  for (const auto &g : closed_groups_) {
    for (size_t ei = 0; ei < t_.ends.size(); ei++) {
      const uint16_t e = static_cast<uint16_t>(ei);
      const std::string &w = who(e);
      bool in = false;
      size_t others = 0;
      const PairEntry *other = nullptr;
      for (const auto &x : g) {
        if (x.who == w) {
          in = true;
        } else {
          others++;
          if (!other) other = &x;
        }
      }
      if (!in) continue;
      const std::string name = t_.names[t_.ends[e].name];
      if (others == 1 && other->tracks == static_cast<int32_t>(t_.ends[e].tracks_count)) {
        set_link(e, other->who);
        out->events.push_back(LogEvent{LogEvent::PAIRING, name, other->who, "paired"});
      } else {
        out->events.push_back(LogEvent{LogEvent::PAIRING, name, "", others == 0 ? "alone" : others > 1 ? "crowded" : "tracks"});
      }
    }
  }
  closed_groups_.clear();
}

// Rules 23 and 29: the last part of every scan, logic on or off.
void Engine::finish_ends(ScanOut *out) {
  decide_pairing(out);
  for (size_t ei = 0; ei < t_.ends.size(); ei++) {
    const uint16_t e = static_cast<uint16_t>(ei);
    EndStateKind st = end_state(e);
    if (st == E_DISAGREES && ends_[e].prev_state != E_DISAGREES)
      out->events.push_back(LogEvent{LogEvent::DISAGREES, t_.names[t_.ends[e].name], ends_[e].link, ends_[e].their_link});
    ends_[e].prev_state = static_cast<int8_t>(st);
  }
  if (broker_) {
    for (size_t ei = 0; ei < t_.ends.size(); ei++) {
      const uint16_t e = static_cast<uint16_t>(ei);
      EndState &s = ends_[e];
      const std::string name = t_.names[t_.ends[e].name];
      const uint16_t tracks = t_.ends[e].tracks_count;
      if (s.announce) out->publishes.push_back(Publish{Publish::PAIRING, "", who(e) + "/" + std::to_string(tracks), 0});
      if (ends_publish_all_ || !s.link_published || s.published_link != s.link) {
        out->publishes.push_back(Publish{Publish::END_LINK, name, s.link, 0});
        s.link_published = true;
        s.published_link = s.link;
      }
      for (uint16_t i = 0; i < tracks; i++) {
        bool occ = false;
        Tag tag = TAG_STOP;
        end_offer(e, i, &occ, &tag);
        const int8_t block = occ ? 1 : 0;
        if (ends_publish_all_ || s.published_block[i] != block) {
          out->publishes.push_back(Publish{Publish::END_BLOCK, name, occ ? "ACTIVE" : "INACTIVE", static_cast<uint16_t>(i + 1)});
          s.published_block[i] = block;
        }
        if (ends_publish_all_ || s.published_mast[i] != tag) {
          out->publishes.push_back(Publish{Publish::END_MAST, name, tag_name(tag), static_cast<uint16_t>(i + 1)});
          s.published_mast[i] = tag;
        }
      }
    }
    ends_publish_all_ = false;
  }
  for (auto &s : ends_) s.announce = false;
}

// An event on an end: its link, or what its subscriptions bring.
void Engine::end_event(const Event &e, int64_t t) {
  int16_t found = find_end(e.name);
  if (found < 0) return;
  const uint16_t i = static_cast<uint16_t>(found);
  EndState &s = ends_[i];
  switch (e.kind) {
    case Event::END_PAIR:
      if (e.value != "pressed") return;
      join_pairing(who(i), t_.ends[i].tracks_count, t);
      s.announce = true;
      return;
    case Event::END_LINK: set_link(i, e.value); return;
    case Event::END_THEIR_LINK: s.their_link = e.value; return;
    case Event::END_ONLINE: s.online = e.flag ? 1 : 0; return;
    case Event::END_BLOCK:
    case Event::END_MAST: {
      // Rule 25: their track j is this board's track count + 1 - j.
      const int32_t count = t_.ends[i].tracks_count;
      if (e.track < 1 || e.track > count) return;
      const size_t k = static_cast<size_t>(count - e.track);
      if (e.kind == Event::END_BLOCK)
        s.block[k] = e.value == "occupied" ? 1 : e.value == "clear" ? 0 : -1;
      else
        s.mast[k] = tag_from_name(e.value);  // TAG_NONE (-1): not heard
      return;
    }
    default: return;
  }
}

// --- triggers and releases (rules 3, 5, 9, 20) ------------------------------

void Engine::reset_trigger(uint16_t r) {
  rules_[r].trig = TrigState();
  rules_[r].phase = IDLE;
  rules_[r].cancel_now = false;
  if (rules_[r].ask != NONE) {
    asks_[rules_[r].ask].request = false;
    asks_[rules_[r].ask].since = -1;
    asks_[rules_[r].ask].once = false;
  }
}

void Engine::reset_release(uint16_t i) {
  res_[i].rel_run_true = -1;
  res_[i].rel_seq_p = 0;
  res_[i].rel_done = false;
}

bool Engine::held(uint16_t i) const { return res_[i].holder != NONE || res_[i].startup_held; }

// A rule that no longer holds any of its resources is idle again.
bool Engine::holds_any(uint16_t r) const {
  for (uint16_t k = 0; k < t_.rules[r].res_count; k++)
    if (res_[res_of(r, k)].holder == r) return true;
  return false;
}

void Engine::eval_trigger(uint16_t r, const Ctx &) {
  const Rule &rule = t_.rules[r];
  RuleState &rs = rules_[r];
  const Trigger &t = rule.trigger;
  TrigState &st = rs.trig;
  bool is_true;
  if (t.when) {
    const bool asked = advance(t.seq_first, t.seq_count, &st.seq_p);
    if (rs.ask != NONE) {
      // Read now, settled for the whole request once every rule has been
      // read (settle_asks), so rules sharing one see the same moments.
      st.asked = asked;
      st.once = asked && rule.try_once && (rule.try_if == NONE || condition(rule.try_if));
      st.cancelled = rule.cancel != NONE && moment(rule.cancel);
      st.withdrawn = rule.withdraw != NONE && moment(rule.withdraw);
      rs.checks_now = true;
      for (uint16_t i = 0; i < rule.checks_count; i++) {
        if (!condition(t_.kids[rule.checks_first + i])) {
          rs.checks_now = false;
          break;
        }
      }
      return;
    }
    is_true = asked;
  } else {
    const bool raw = t.present && t.cond != NONE && condition(t.cond);
    if (raw) {
      if (st.run_true < 0) st.run_true = n_;
      st.run_false = -1;
      if (!st.eff && (n_ - st.run_true) * SCAN_MS >= t.for_ms) st.eff = true;
    } else {
      if (st.run_false < 0) st.run_false = n_;
      st.run_true = -1;
      if (st.eff && (n_ - st.run_false) * SCAN_MS >= t.for_ms) st.eff = false;
    }
    is_true = st.eff;
  }
  if (is_true && st.since < 0) st.since = n_;
  if (!is_true) st.since = -1;
  rs.true_now = is_true;
  rs.checks_now = true;
  for (uint16_t i = 0; i < rule.checks_count; i++) {
    if (!condition(t_.kids[rule.checks_first + i])) {
      rs.checks_now = false;
      break;
    }
  }
}

// Rule 5: a reserving When rule's request, read for every rule that shares
// it. A withdraw takes back a request still waiting; then a cancel with
// something to cancel (that request, or a rule that is ACTIVE) takes it back,
// and cancels the ACTIVE rule, and this scan's moment with it; otherwise the
// moment asks.
void Engine::settle_asks() {
  for (auto &ask : asks_) {
    bool asked = false, once = false, cancelled = false, withdrawn = false, active = false;
    for (uint16_t r : ask.rules) {
      const TrigState &st = rules_[r].trig;
      asked = asked || st.asked;
      once = once || st.once;
      cancelled = cancelled || st.cancelled;
      withdrawn = withdrawn || st.withdrawn;
      active = active || rules_[r].phase == ACTIVE;
      rules_[r].cancel_now = false;
    }
    if (withdrawn) ask.request = false;
    if (cancelled && (ask.request || active)) {
      ask.request = false;
      for (uint16_t r : ask.rules)
        if (rules_[r].phase == ACTIVE) rules_[r].cancel_now = true;
    } else if (asked) {
      // Rule 39: a new request is tried once if a moment that asked says so.
      if (!ask.request) ask.once = once;
      ask.request = true;
    }
    if (ask.request && ask.since < 0) ask.since = n_;
    if (!ask.request) {
      ask.since = -1;
      ask.once = false;
    }
    for (uint16_t r : ask.rules) {
      rules_[r].true_now = ask.request;
      rules_[r].trig.since = ask.since;
    }
  }
}

void Engine::eval_release(uint16_t i) {
  const Trigger &t = t_.resources[i].release;
  ResState &res = res_[i];
  if (t.when) {
    res.release_now = held(i) ? (advance(t.seq_first, t.seq_count, &res.rel_seq_p) || res.rel_done) : false;
    if (res.release_now) res.rel_done = true;
    return;
  }
  bool raw = t.present && t.cond != NONE && condition(t.cond);
  if (raw) {
    if (res.rel_run_true < 0) res.rel_run_true = n_;
  } else {
    res.rel_run_true = -1;
  }
  res.release_now = raw && (n_ - res.rel_run_true) * SCAN_MS >= t.for_ms;
}

void Engine::free_res(uint16_t i) {
  ResState &res = res_[i];
  const uint16_t holder = res.holder;
  res.holder = NONE;
  res.passed = false;
  res.seen = false;
  if (holder != NONE && !holds_any(holder)) rules_[holder].phase = IDLE;
  res.startup_held = false;
  res.rel_seq_p = 0;
  res.rel_done = false;
}

bool Engine::block_occupied_or_went(uint16_t i) {
  const Resource &res = t_.resources[i];
  for (uint16_t b = 0; b < res.blocks_count; b++) {
    const BlockRef &ref = t_.block_refs[res.blocks_first + b];
    if (occupied_ref(ref.item, ref.logic_block) || went(ref.item, ref.logic_block, true)) return true;
  }
  return false;
}

bool Engine::blocks_clear(uint16_t i) {
  const Resource &res = t_.resources[i];
  for (uint16_t b = 0; b < res.blocks_count; b++) {
    const BlockRef &ref = t_.block_refs[res.blocks_first + b];
    if (occupied_ref(ref.item, ref.logic_block)) return false;
  }
  return true;
}

bool Engine::mast_held(uint16_t r) const {
  uint16_t m = t_.rules[r].mast;
  return m != NONE && holds_[m];
}

bool Engine::is_active(uint16_t r) const {
  return t_.rules[r].res_count > 0 ? rules_[r].phase == ACTIVE : (rules_[r].true_now && rules_[r].checks_now);
}

bool Engine::locks_held(uint16_t r) const {
  return t_.rules[r].res_count > 0 ? rules_[r].phase != IDLE : (rules_[r].true_now && rules_[r].checks_now);
}

// A held resource is PASSED once its train has entered it; until then it is
// CANCELLING while its rule is, and otherwise ACTIVE.
const char *Engine::resource_state(uint16_t i) const {
  if (res_[i].startup_held) return "PASSED";
  if (res_[i].holder == NONE) return "IDLE";
  if (res_[i].passed) return "PASSED";
  return rules_[res_[i].holder].phase == CANCELLING ? "CANCELLING" : "ACTIVE";
}

// --- writes and publishes (rules 21, 22) ----------------------------------

void Engine::finish(ScanOut *out, const std::vector<int16_t> *new_out, const std::vector<bool> &new_locks,
                    const std::vector<bool> *new_panel, const std::vector<uint8_t> *new_lamps) {
  if (new_out) {
    for (size_t m = 0; m < t_.masts.size(); m++) {
      if (!field_[m]) continue;
      int16_t a = (*new_out)[m];
      if (display_[m] != a) out->writes.push_back(Write{false, t_.names[t_.masts[m].name], aspect_text(m, a), false});
      display_[m] = a;
    }
  }
  for (size_t t = 0; t < t_.declared_turnouts; t++)
    if (field_locks_[t] != new_locks[t]) out->writes.push_back(Write{true, t_.names[t_.turnouts[t]], "", new_locks[t]});
  field_locks_ = new_locks;
  // Rules 37 and 36: panel locks, then lamps; none given is all off.
  for (size_t t = 0; t < t_.declared_turnouts; t++) {
    const bool on = new_panel && (*new_panel)[t];
    if (panel_locks_[t] != on) {
      Write w;
      w.panel = true;
      w.name = t_.names[t_.turnouts[t]];
      w.on = on;
      out->writes.push_back(w);
    }
    panel_locks_[t] = on;
  }
  static const char *const LIGHTS[] = {"off", "on", "flash"};
  for (size_t l = 0; l < t_.lamps.size(); l++) {
    const uint8_t light = new_lamps ? (*new_lamps)[l] : 0;
    if (lamps_shown_[l] != light) {
      Write w;
      w.lamp = true;
      w.name = t_.names[t_.lamps[l]];
      w.aspect = LIGHTS[light];
      out->writes.push_back(w);
    }
    lamps_shown_[l] = light;
  }
  for (size_t t = 0; t < t_.declared_turnouts; t++) {
    bool locked = field_locks_[t] || remote_locks_[t];
    if (prev_locked_[t] && !locked) out->events.push_back(LogEvent{LogEvent::RESYNC, t_.names[t_.turnouts[t]], "", ""});
    prev_locked_[t] = locked;
  }
}

void Engine::publish_resources(ScanOut *out, const std::vector<Publish> &echoes) {
  if (!broker_) return;
  for (size_t i = 0; i < t_.resources.size(); i++) {
    const std::string &name = t_.names[t_.resources[i].name];
    // Held: 0 INACTIVE, 1 ACTIVE. State: 2 IDLE, 3 ACTIVE, 4 PASSED, 5 CANCELLING.
    int8_t held_v = held(static_cast<uint16_t>(i)) ? 1 : 0;
    const char *state = resource_state(static_cast<uint16_t>(i));
    int8_t state_v = state[0] == 'I' ? 2 : state[0] == 'A' ? 3 : state[0] == 'P' ? 4 : 5;
    if (publish_all_ || published_[2 * i] != held_v) {
      out->publishes.push_back(Publish{Publish::HELD, name, held_v ? "ACTIVE" : "INACTIVE"});
      published_[2 * i] = held_v;
    }
    if (publish_all_ || published_[2 * i + 1] != state_v) {
      out->publishes.push_back(Publish{Publish::STATE, name, state});
      published_[2 * i + 1] = state_v;
    }
  }
  for (const auto &echo : echoes) out->publishes.push_back(echo);
  publish_all_ = false;
}

void Engine::record_edges() {
  for (uint16_t m : tracked_) edges_[m] = condition_core(m) ? 1 : 0;
  for (size_t b = 0; b < t_.blocks.size(); b++) prev_block_[b] = occupied_ref(static_cast<uint16_t>(b), true);
}

void Engine::end_scan() {
  for (auto &l : sensors_) l.on = l.off = false;
  for (auto &l : buttons_) l.on = l.off = false;
  for (auto &l : switches_) l.on = l.off = false;
  std::fill(hold_went_.begin(), hold_went_.end(), 0);
  n_ += 1;
}

void Engine::switch_off(ScanOut *out, const std::vector<Publish> &echoes) {
  for (size_t i = 0; i < t_.resources.size(); i++) {
    if (held(static_cast<uint16_t>(i))) {
      out->events.push_back(LogEvent{LogEvent::RELEASE, t_.names[t_.resources[i].name], "", "switch"});
      free_res(static_cast<uint16_t>(i));
    }
  }
  for (size_t r = 0; r < t_.rules.size(); r++) reset_trigger(static_cast<uint16_t>(r));
  std::vector<int16_t> new_out(t_.masts.size(), SHOWS_NOTHING);
  for (size_t m = 0; m < t_.masts.size(); m++)
    if (field_[m]) new_out[m] = jmri_shown_[m] == SHOWS_NOTHING ? t_.masts[m].stop : jmri_shown_[m];
  finish(out, &new_out, std::vector<bool>(t_.turnouts.size(), false));
  publish_resources(out, echoes);
  logic_on_ = false;
}

// A manual release: the resource is freed, its rule's mast goes to Stop, and
// any other resources that rule holds stay held until its train has passed
// through them.
void Engine::release_by_hand(uint16_t i, ScanOut *out, std::vector<bool> *released_now, std::vector<bool> *force_stop) {
  out->events.push_back(LogEvent{LogEvent::RELEASE, t_.names[t_.resources[i].name], "", "manual"});
  const uint16_t holder = res_[i].holder;
  free_res(i);
  if (holder != NONE && rules_[holder].phase != IDLE) rules_[holder].phase = PASSED;
  (*released_now)[i] = true;
  for (uint16_t r : res_rules_[i]) {
    uint16_t m = t_.rules[r].mast;
    if (m == NONE) continue;
    holds_[m] = false;
    (*force_stop)[m] = true;
  }
}

// --- the scan (rule 6) ----------------------------------------------------

ScanOut Engine::scan() {
  ScanOut out;
  if (pending_logic_ == 1 && !logic_on_) {
    logic_on_ = true;
    startup_next_ = true;
  }
  bool switching_off = pending_logic_ == 0 && logic_on_;
  pending_logic_ = -1;
  if (switching_off || !logic_on_) {
    // No section to release while logic is off, but each press is answered.
    std::vector<Publish> echoes;
    if (broker_) {
      for (const auto &p : pending_releases_) echoes.push_back(Publish{Publish::RELEASE, p.first, "CLOSED"});
      for (const auto &p : pending_group_releases_)
        if (has_layer(p.first)) echoes.push_back(Publish{Publish::RELEASE_GROUP, p.first, "CLOSED"});
    }
    pending_releases_.clear();
    pending_group_releases_.clear();
    if (switching_off) {
      switch_off(&out, echoes);
    } else {
      finish(&out, nullptr, std::vector<bool>(t_.turnouts.size(), false));
      for (const auto &echo : echoes) out.publishes.push_back(echo);
    }
    record_edges();
    finish_ends(&out);
    end_scan();
    return out;
  }

  Ctx ctx;
  ctx.startup = startup_next_;
  for (size_t i = 0; i < t_.resources.size(); i++) ctx.held_at_start.push_back(held(static_cast<uint16_t>(i)));
  startup_next_ = false;
  std::vector<bool> force_stop(t_.masts.size(), false);
  std::vector<bool> released_now(t_.resources.size(), false);
  std::vector<Publish> echoes;

  // 6.1: start-up, then manual releases.
  if (ctx.startup) {
    out.events.push_back(LogEvent{LogEvent::STARTUP, "", "", ""});
    for (size_t r = 0; r < t_.rules.size(); r++) reset_trigger(static_cast<uint16_t>(r));
    for (size_t i = 0; i < t_.resources.size(); i++) {
      free_res(static_cast<uint16_t>(i));
      reset_release(static_cast<uint16_t>(i));
    }
    for (size_t m = 0; m < t_.masts.size(); m++)
      if (field_[m]) prev_out_[m] = t_.masts[m].stop;
    for (size_t i = 0; i < t_.resources.size(); i++) {
      const Resource &res = t_.resources[i];
      for (uint16_t b = 0; b < res.blocks_count; b++) {
        const BlockRef &ref = t_.block_refs[res.blocks_first + b];
        if (occupied_ref(ref.item, ref.logic_block)) {
          res_[i].startup_held = true;
          out.events.push_back(LogEvent{LogEvent::PASS, t_.names[res.name], "", ""});
          break;
        }
      }
    }
  }
  for (size_t i = 0; i < t_.resources.size(); i++) {
    const std::string &name = t_.names[t_.resources[i].name];
    for (const auto &press : pending_releases_) {
      if (press.first != name) continue;
      if (broker_) echoes.push_back(Publish{Publish::RELEASE, name, "CLOSED"});
      if (press.second) {
        out.events.push_back(LogEvent{LogEvent::IGNORED, name, "", "release"});
        continue;
      }
      release_by_hand(static_cast<uint16_t>(i), &out, &released_now, &force_stop);
    }
  }
  pending_releases_.clear();
  // Rule 33: Release for a group frees everything its rules hold, in resource
  // order.
  for (const auto &press : pending_group_releases_) {
    if (!has_layer(press.first)) continue;
    if (broker_) echoes.push_back(Publish{Publish::RELEASE_GROUP, press.first, "CLOSED"});
    if (press.second) {
      out.events.push_back(LogEvent{LogEvent::IGNORED, press.first, "", "releaseGroup"});
      continue;
    }
    out.events.push_back(LogEvent{LogEvent::RELEASE_GROUP, press.first, "", ""});
    for (size_t i = 0; i < t_.resources.size(); i++) {
      const uint16_t holder = res_[i].holder;
      if (holder != NONE && t_.names.equals(t_.layers[t_.rules[holder].layer], press.first))
        release_by_hand(static_cast<uint16_t>(i), &out, &released_now, &force_stop);
    }
  }
  pending_group_releases_.clear();

  // 6.2: releases read this scan, a start-up hold's release, every rule's
  // trigger, the requests, then each reserving rule.
  startup_scan_ = ctx.startup;
  update_timed();
  for (size_t i = 0; i < t_.resources.size(); i++) eval_release(static_cast<uint16_t>(i));
  for (size_t i = 0; i < t_.resources.size(); i++) {
    if (res_[i].startup_held && res_[i].release_now) {
      out.events.push_back(LogEvent{LogEvent::RELEASE, t_.names[t_.resources[i].name], "", "release"});
      free_res(static_cast<uint16_t>(i));
    }
  }
  for (size_t ri = 0; ri < t_.rules.size(); ri++) eval_trigger(static_cast<uint16_t>(ri), ctx);
  settle_asks();
  for (size_t ri = 0; ri < t_.rules.size(); ri++) {
    const uint16_t r = static_cast<uint16_t>(ri);
    const Rule &rule = t_.rules[r];
    RuleState &rs = rules_[r];
    if (rule.res_count == 0 || rs.phase == IDLE) continue;
    // Passed first: a train that has entered a resource is never cancelled,
    // even by a cancel in the same scan. The mast goes back to Stop.
    for (uint16_t k = 0; k < rule.res_count; k++) {
      const uint16_t i = res_of(r, k);
      if (res_[i].holder != r || res_[i].passed || !block_occupied_or_went(i)) continue;
      res_[i].passed = true;
      rs.phase = PASSED;
      out.events.push_back(LogEvent{LogEvent::PASS, t_.names[t_.resources[i].name], t_.rule_ref(r), ""});
    }
    // Sequential release (rule 9): the train seen going into the next block
    // along the way, from the scan it passed.
    for (uint16_t k = 0; k < rule.res_count; k++) {
      const uint16_t i = res_of(r, k);
      if (res_[i].holder != r || !res_[i].passed || res_[i].seen) continue;
      const Range &next = t_.res_next[rule.res_first + k];
      for (uint16_t b = 0; b < next.count; b++) {
        const BlockRef &ref = t_.block_refs[next.first + b];
        if (went(ref.item, ref.logic_block, true)) res_[i].seen = true;
      }
    }
    if (rs.phase == ACTIVE) {
      bool cancel = false;
      if (rule.trigger.when) {
        cancel = rs.cancel_now;
      } else if (!rs.true_now) {
        cancel = true;
      }
      if (!cancel && mast_held(r)) {
        cancel = true;
        if (rs.ask != NONE) asks_[rs.ask].request = true;
      }
      if (cancel) {
        // Each resource: held while approach locking holds it, or freed now.
        rs.phase = CANCELLING;
        rs.cancel_at = n_;
        bool behind = false;
        if (rule.approach_block != NONE) {
          const BlockRef &ref = t_.block_refs[rule.approach_block];
          behind = occupied_ref(ref.item, ref.logic_block);
        }
        for (uint16_t k = 0; k < rule.res_count; k++) {
          const uint16_t i = res_of(r, k);
          if (res_[i].holder != r) continue;
          const std::string &name = t_.names[t_.resources[i].name];
          out.events.push_back(LogEvent{LogEvent::CANCEL, name, t_.rule_ref(r), ""});
          const uint32_t locked_for = rule.approach_block != NONE ? (behind ? rule.approach_ms : 0) : t_.resources[i].approach_lock_ms;
          if (locked_for > 0) continue;
          out.events.push_back(LogEvent{LogEvent::RELEASE, name, "", "cancel"});
          free_res(i);
        }
        if (rs.phase == IDLE) continue;
      }
    }
    if (rs.phase == CANCELLING) {
      // Rule 10: by time; with a rule's own approach locking, also at once
      // when the train behind the signal leaves.
      bool left = false;
      if (rule.approach_block != NONE) {
        const BlockRef &ref = t_.block_refs[rule.approach_block];
        left = !occupied_ref(ref.item, ref.logic_block);
      }
      for (uint16_t k = 0; k < rule.res_count; k++) {
        const uint16_t i = res_of(r, k);
        if (res_[i].holder != r) continue;
        const uint32_t hold = rule.approach_block != NONE ? rule.approach_ms : t_.resources[i].approach_lock_ms;
        const bool time = (n_ - rs.cancel_at) * static_cast<int64_t>(SCAN_MS) >= static_cast<int64_t>(hold);
        if (!time && !left) continue;
        out.events.push_back(LogEvent{LogEvent::RELEASE, t_.names[t_.resources[i].name], "", time ? "time" : "left"});
        free_res(i);
      }
      continue;
    }
    if (rs.phase != PASSED) continue;
    for (uint16_t k = 0; k < rule.res_count; k++) {
      const uint16_t i = res_of(r, k);
      if (res_[i].holder != r || !res_[i].passed || !res_[i].release_now) continue;
      if (t_.res_next[rule.res_first + k].count && !res_[i].seen) continue;
      out.events.push_back(LogEvent{LogEvent::RELEASE, t_.names[t_.resources[i].name], "", "release"});
      free_res(i);
    }
  }

  // 6.3: grants, longest waiting first, then list order. A rule takes all of
  // its resources at once or none of them, and each resource it waits for is
  // kept from the rules that started waiting after it. A request shared by
  // several rules is used up by the first granted.
  std::vector<uint16_t> asking;
  for (size_t ri = 0; ri < t_.rules.size(); ri++) {
    const uint16_t r = static_cast<uint16_t>(ri);
    const RuleState &rs = rules_[r];
    if (t_.rules[r].res_count > 0 && rs.phase == IDLE && rs.true_now && rs.checks_now && !mast_held(r)) asking.push_back(r);
  }
  std::stable_sort(asking.begin(), asking.end(), [this](uint16_t a, uint16_t b) { return rules_[a].trig.since < rules_[b].trig.since; });
  std::vector<bool> claimed(t_.resources.size(), false);
  std::vector<uint16_t> granted(t_.resources.size(), NONE);
  for (uint16_t r : asking) {
    const Rule &rule = t_.rules[r];
    RuleState &rs = rules_[r];
    if (rs.ask != NONE && !asks_[rs.ask].request) continue;
    bool ok = true;
    for (uint16_t k = 0; k < rule.res_count; k++) {
      const uint16_t i = res_of(r, k);
      if (claimed[i] || held(i) || released_now[i] || !blocks_clear(i)) ok = false;
    }
    for (uint16_t k = 0; k < rule.res_count; k++) claimed[res_of(r, k)] = true;
    if (!ok) continue;
    rs.phase = ACTIVE;
    for (uint16_t k = 0; k < rule.res_count; k++) {
      const uint16_t i = res_of(r, k);
      res_[i].holder = r;
      res_[i].passed = false;
      res_[i].seen = false;
      res_[i].rel_seq_p = 0;
      res_[i].rel_done = false;
      granted[i] = r;
    }
    if (rs.ask != NONE) {
      Ask &ask = asks_[rs.ask];
      ask.request = false;
      ask.since = -1;
      ask.once = false;
      for (uint16_t other : ask.rules) rules_[other].trig.since = -1;
    }
  }
  for (size_t i = 0; i < t_.resources.size(); i++)
    if (granted[i] != NONE) out.events.push_back(LogEvent{LogEvent::GRANT, t_.names[t_.resources[i].name], t_.rule_ref(granted[i]), ""});
  // Rule 39: a request tried once and not granted is dropped, unless its
  // rule's waitWhile holds (a turnout on its way still moving).
  for (auto &ask : asks_) {
    if (!ask.request || !ask.once || ask.rules.empty()) continue;
    bool wait = false;
    for (uint16_t r : ask.rules)
      if (t_.rules[r].try_wait != NONE && condition(t_.rules[r].try_wait)) wait = true;
    if (wait) continue;
    ask.request = false;
    ask.since = -1;
    ask.once = false;
    for (uint16_t r : ask.rules) {
      rules_[r].trig.since = -1;
      rules_[r].true_now = false;
    }
    out.events.push_back(LogEvent{LogEvent::DROPPED, "", t_.rule_ref(ask.rules[0]), ""});
  }

  // 6.4: who wins each mast (rule 12), approach lighting, then the locks.
  std::vector<int16_t> new_out(t_.masts.size(), SHOWS_NOTHING);
  for (size_t mi = 0; mi < t_.masts.size(); mi++) {
    if (!field_[mi]) continue;
    const Mast &def = t_.masts[mi];
    const int16_t stop = def.stop;
    int16_t pick = -100;
    auto consider = [&](int16_t a) {
      if (pick == -100 || aspect_tag(def, a) < aspect_tag(def, pick)) pick = a;
    };
    uint16_t layer = NONE;
    bool sets = false;
    int16_t winner = -100;
    auto close_layer = [&]() {
      if (sets) consider(winner != -100 ? winner : stop);
    };
    for (size_t ri = 0; ri < t_.rules.size(); ri++) {
      const Rule &rule = t_.rules[ri];
      if (rule.layer != layer) {
        close_layer();
        layer = rule.layer;
        sets = false;
        winner = -100;
      }
      if (rule.mast != mi) continue;
      sets = true;
      // Fail safe: an aspect the mast does not have is its stop aspect.
      if (winner == -100 && is_active(static_cast<uint16_t>(ri))) winner = aspect_tag(def, rule.aspect) != TAG_NONE ? rule.aspect : stop;
    }
    close_layer();
    if (holds_[mi] || force_stop[mi]) consider(stop);
    if (pick == -100) pick = stop;
    if (def.approach_light != NONE) {
      const BlockRef &ref = t_.block_refs[def.approach_light];
      if (!occupied_ref(ref.item, ref.logic_block)) pick = SHOWS_DARK;
    }
    new_out[mi] = pick;
  }
  // Rule 21: a rule's turnout locks, while it holds them; one held with a
  // resource only while the rule holds that resource.
  std::vector<bool> new_locks(t_.turnouts.size(), false);
  std::vector<bool> new_panel(t_.turnouts.size(), false);
  for (size_t r = 0; r < t_.rules.size(); r++) {
    if (!locks_held(static_cast<uint16_t>(r))) continue;
    const Rule &rule = t_.rules[r];
    for (uint16_t l = 0; l < rule.locks_count; l++) {
      const uint16_t with = t_.lock_with[rule.locks_first + l];
      if (with == NONE || res_[with].holder == r) (t_.lock_own[rule.locks_first + l] ? new_panel : new_locks)[t_.locks[rule.locks_first + l]] = true;
    }
  }
  // Rule 36: each lamp, flash before on.
  std::vector<uint8_t> new_lamps(t_.lamps.size(), 0);
  for (size_t r = 0; r < t_.rules.size(); r++) {
    const Rule &rule = t_.rules[r];
    if (rule.lamp == NONE || !is_active(static_cast<uint16_t>(r))) continue;
    if (rule.light > new_lamps[rule.lamp]) new_lamps[rule.lamp] = rule.light;
  }
  finish(&out, &new_out, new_locks, &new_panel, &new_lamps);
  record_edges();
  prev_out_ = new_out;
  publish_resources(&out, echoes);
  finish_ends(&out);
  end_scan();
  return out;
}

// --- events ---------------------------------------------------------------

void Engine::event(const Event &e) {
  int64_t now = n_ * SCAN_MS;
  switch (e.kind) {
    case Event::END_PAIR:
    case Event::END_LINK:
    case Event::END_THEIR_LINK:
    case Event::END_ONLINE:
    case Event::END_BLOCK:
    case Event::END_MAST:
      end_event(e, now);
      return;
    case Event::PAIRING:
      heard_pairing(e.value, now);
      return;
    case Event::REMOTE_ONLINE: {
      int16_t b = find(t_.remote_boards, e.board);
      if (b >= 0) online_[b] = e.flag ? 1 : 0;
      return;
    }
    case Event::REMOTE_MAST: {
      int16_t b = find(t_.remote_boards, e.board);
      if (b < 0) return;
      int16_t i = find_remote_item(b, RemoteItem::MAST, e.name);
      if (i < 0) return;
      if (e.value.empty()) {
        remote_values_[i] = R_UNSET;
        return;
      }
      const RemoteItem &it = t_.remote_items[i];
      int16_t a = it.mast == NONE ? -1 : aspect_index(t_.remote_masts[it.mast], e.value);
      remote_values_[i] = a >= 0 ? a : R_NOT_ASPECT;
      return;
    }
    case Event::REMOTE_ITEM: {
      int16_t b = find(t_.remote_boards, e.board);
      if (b < 0) return;
      bool turnout = e.item_kind == "turnout";
      int16_t i = find_remote_item(b, turnout ? RemoteItem::TURNOUT : RemoteItem::SENSOR, e.name);
      if (i < 0) return;
      const std::string &v = e.value;
      if (v == "unknown")
        remote_values_[i] = R_UNSET;
      else if (turnout)
        remote_values_[i] = v == "closed" ? T_CLOSED : v == "thrown" ? T_THROWN : v == "moving" ? T_MOVING : T_OTHER;
      else
        remote_values_[i] = v == "occupied" ? R_OCCUPIED : R_CLEAR;
      return;
    }
    case Event::SENSOR:
    case Event::BUTTON: {
      bool sensor = e.kind == Event::SENSOR;
      int16_t i = find(sensor ? t_.sensors : t_.buttons, e.name);
      if (i < 0) return;  // nothing reads it
      Latch &l = sensor ? sensors_[i] : buttons_[i];
      bool value = e.value == (sensor ? "occupied" : "pressed");
      if (l.value == value) return;
      l.value = value;
      if (value)
        l.on = true;
      else
        l.off = true;
      return;
    }
    case Event::SWITCH: {
      int16_t i = find(t_.switches, e.name);
      if (i < 0) return;  // nothing reads it
      Latch &l = switches_[i];
      const bool value = e.value == "on";
      if (l.value == value) return;
      l.value = value;
      if (value)
        l.on = true;
      else
        l.off = true;
      return;
    }
    case Event::TURNOUT: {
      int16_t i = find(t_.turnouts, e.name);
      if (i < 0) return;
      const std::string &v = e.value;
      turnouts_[i] = v == "closed" ? T_CLOSED : v == "thrown" ? T_THROWN : v == "moving" ? T_MOVING : T_OTHER;
      return;
    }
    case Event::REMOTE_LOCK: {
      int16_t i = find(t_.turnouts, e.name);
      if (i >= 0) remote_locks_[i] = e.value == "locked";
      return;
    }
    case Event::JMRI: {
      int16_t m = find_mast(e.name);
      if (m >= 0) jmri_message(static_cast<uint16_t>(m), e.value);
      return;
    }
    case Event::RELEASE: {
      bool ignored = e.value == "mqtt" && connect_at_ >= 0 && now - connect_at_ < RELEASE_WINDOW_MS;
      pending_releases_.emplace_back(e.name, ignored);
      return;
    }
    case Event::RELEASE_GROUP: {
      bool ignored = e.value == "mqtt" && connect_at_ >= 0 && now - connect_at_ < RELEASE_WINDOW_MS;
      pending_group_releases_.emplace_back(e.name, ignored);
      return;
    }
    case Event::AUTO:
      auto_on_ = e.value == "on";
      return;
    case Event::LOGIC:
      pending_logic_ = e.value == "on" ? 1 : e.value == "off" ? 0 : -1;
      return;
    case Event::BROKER:
      if (e.value == "connected") {
        broker_ = true;
        connect_at_ = now;
        publish_all_ = true;
        ends_publish_all_ = true;
      } else if (e.value == "disconnected") {
        broker_ = false;
      }
      return;
  }
}

// Rules 15 and 17.
void Engine::jmri_message(uint16_t m, const std::string &message) {
  int16_t pick = pick_aspect(m, message);
  if (field_[m]) {
    const bool held = message.find("; Held") != std::string::npos;
    // Rule 30: a change of hold, from a message the board was sent.
    if (!starting_ && last_held_[m] != (held ? 1 : 0) && (held || last_held_[m] == 1)) hold_went_[m] |= held ? 1 : 2;
    last_held_[m] = held ? 1 : 0;
    holds_[m] = held;
    if (pick != IGNORED) jmri_shown_[m] = pick;
    if (!logic_on_ && pick != IGNORED) display_[m] = pick;
  } else if (pick != IGNORED) {
    display_[m] = pick;
  }
}

std::string Engine::shows(const std::string &mast) const {
  int16_t m = find_mast(mast);
  return m < 0 ? std::string() : aspect_text(static_cast<uint16_t>(m), display_[m]);
}

State Engine::state() const {
  State s;
  s.logic_on = logic_on_;
  s.auto_on = auto_on_;
  for (size_t m = 0; m < t_.masts.size(); m++) s.masts.emplace_back(t_.names[t_.masts[m].name], aspect_text(m, display_[m]));
  for (size_t r = 0; r < t_.rules.size(); r++) {
    const char *phase = "idle";
    if (logic_on_) {
      switch (rules_[r].phase) {
        case ACTIVE: phase = "active"; break;
        case PASSED: phase = "passed"; break;
        case CANCELLING: phase = "cancelling"; break;
        default:
          phase = (t_.rules[r].res_count > 0 && rules_[r].true_now && rules_[r].checks_now) ? "waiting" : "idle";
      }
    }
    s.rules.emplace_back(t_.rule_ref(static_cast<uint16_t>(r)), phase);
  }
  for (size_t i = 0; i < t_.resources.size(); i++) {
    const std::string &name = t_.names[t_.resources[i].name];
    s.resources.emplace_back(name, resource_state(static_cast<uint16_t>(i)));
    s.holders.emplace_back(name, res_[i].holder != NONE ? t_.rule_ref(res_[i].holder) : "");
  }
  for (size_t t = 0; t < t_.declared_turnouts; t++) {
    s.locks.emplace_back(t_.names[t_.turnouts[t]], field_locks_[t]);
    s.locked.emplace_back(t_.names[t_.turnouts[t]], field_locks_[t] || remote_locks_[t]);
    s.panel.emplace_back(t_.names[t_.turnouts[t]], panel_locks_[t]);
  }
  static const char *const LIGHTS[] = {"off", "on", "flash"};
  for (size_t l = 0; l < t_.lamps.size(); l++) s.lamps.emplace_back(t_.names[t_.lamps[l]], LIGHTS[lamps_shown_[l]]);
  static const char *const END_STATES[] = {"pairing", "empty", "end", "unheard", "disagrees", "heard"};
  for (size_t e = 0; e < t_.ends.size(); e++) {
    s.ends.emplace_back(t_.names[t_.ends[e].name], END_STATES[end_state(static_cast<uint16_t>(e))]);
    s.links.emplace_back(t_.names[t_.ends[e].name], ends_[e].link);
  }
  return s;
}

}  // namespace logic_core
