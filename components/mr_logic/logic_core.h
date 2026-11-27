// The logic engine's core: plain C++17, no ESPHome, no exceptions, no RTTI.
// It behaves exactly as configurator/logic.js and both replay the same cases
// (configurator/test/cases/*.json; the numbered rules are in its README.md).
//
// The rule table is compiled once (logic_table.cpp) into the compact,
// index-based Table below, so a board with a few hundred rules fits in a few
// tens of kilobytes. Names are kept once, for logs and outputs; everything the
// scan touches is an index. The Engine refers to the Table: keep the Table
// alive, and where it is, for as long as the Engine.
#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace logic_core {

// Most restrictive first.
enum Tag : int8_t { TAG_NONE = -1, TAG_STOP = 0, TAG_RESTRICTING, TAG_APPROACH, TAG_ADVANCE, TAG_CLEAR };
Tag tag_from_name(const std::string &name);
const char *tag_name(Tag tag);

static constexpr uint16_t NONE = 0xFFFF;

// A condition or a moment. ALL / ANY / NOT have kids, a range in Table::kids.
// END is what a plant end's track hears: item is the end (NONE: no such end),
// `first` its track number (0: not a track), and hears_mast says which value.
//
// AUTO is the Auto/Manual switch (is IS_ON or IS_OFF). A mast on this board
// with IS_HELD / IS_UNHELD reads what JMRI last said of its hold; as a moment,
// that hold changing (README rule 30).
//
// As a moment, a node may also have: `if_node`, a condition it counts only
// while true; `timed` with `for_ms`, counting once its state has held that
// long (rule 32); and, on a BLOCK, `not_from`: entered, but not from the
// blocks in a range of Table::block_refs (rule 31).
struct Node {
  // SWITCH is a switch piece, IS_ON or IS_OFF (README rule 35). A leaf
  // condition with `timed` is also a state held for for_ms (rule 34).
  enum Kind : uint8_t { ALL, ANY, NOT, BLOCK, TURNOUT, MAST, BUTTON, END, AUTO, SWITCH };
  // What `is` asks for. A mast's tags are in `tags` (a bit per Tag).
  enum Is : uint8_t {
    IS_OCCUPIED, IS_CLEAR, IS_CLOSED, IS_THROWN, IS_MOVING, IS_PRESSED, IS_DIVERGING, IS_TAGS, IS_OTHER,
    IS_HELD, IS_UNHELD, IS_ON, IS_OFF,
  };
  uint8_t kind = BLOCK;
  uint8_t is = IS_OTHER;
  uint8_t tags = 0;
  uint8_t logic_block = 0;  // BLOCK on this board: item is a logic block, not a sensor
  uint16_t board = NONE;  // another board's item: its remote board
  uint16_t item = NONE;  // by kind: sensor / logic block, turnout, mast, button; or remote item
  uint8_t remote = 0;  // another board's item
  uint8_t hears_mast = 0;  // END: the Mast it hears, not the Block
  uint16_t first = 0, count = 0;  // kids
  uint16_t if_node = NONE;
  uint8_t timed = 0, not_from = 0;
  uint32_t for_ms = 0;
  uint8_t within = 0;  // rule 38: true for within_ms after it last happened or held
  uint32_t within_ms = 0;
  uint16_t from_first = 0, from_count = 0;  // not_from: a range in Table::block_refs
};

struct Trigger {
  bool present = false;
  bool when = false;
  uint16_t cond = NONE;  // while
  uint16_t seq_first = 0, seq_count = 0;  // when, then ...: a range in Table::seq
  uint32_t for_ms = 0;
};

struct Aspect {
  uint16_t name;  // in Table::names
  Tag tag;
  bool diverging;
  bool custom_states;  // its exact strings are in Table::states, not "<name>; Lit; Unheld"
};

struct Mast {
  uint16_t name;
  uint16_t aspect_first = 0, aspect_count = 0;  // a range in Table::aspects
  int16_t stop = -1;  // index within the mast's aspects
  int16_t startup = -1;
  uint16_t approach_light = NONE;  // a block ref in Table::block_refs
  uint16_t states_first = 0, states_count = 0;  // custom exact strings: a range in Table::states
};

struct StateString {
  int16_t aspect;  // index within the mast's aspects
  std::string text;
};

// A block named on this board: a logic block, or a sensor.
struct BlockRef {
  uint16_t item;
  bool logic_block;
};

struct Member {
  enum Kind : uint8_t { LOCAL, REMOTE, END };
  uint16_t item;  // a sensor; a remote item (NONE: on a board not listed, read occupied); or an end (NONE: none)
  uint16_t board;  // REMOTE: the remote board, NONE when not listed. END: the track number (0: none)
  uint8_t remote;  // its Kind
};

struct LogicBlock {
  uint16_t name = 0;
  uint16_t first = 0, count = 0;  // a range in Table::members
  uint16_t next_first = 0, next_count = 0;  // its neighbours: a range in Table::block_refs
};

struct RemoteItem {
  enum Kind : uint8_t { SENSOR, BLOCK, TURNOUT, MAST };
  uint16_t board;
  uint16_t name;
  uint8_t kind;
  uint16_t mast = NONE;  // MAST: its definition in Table::remote_masts
};

// A plant end's track (README rules 25-27). Its sensors are a range in
// Table::end_sensors. A pass-through names the far end (an index, NONE: none)
// and track (0: none).
struct EndTrack {
  uint16_t sensors_first = 0, sensors_count = 0;
  uint16_t mast = NONE;  // a declared mast
  bool through = false;
  uint16_t through_end = NONE;
  uint16_t through_track = 0;
};

struct End {
  uint16_t name = 0;
  uint16_t tracks_first = 0, tracks_count = 0;  // a range in Table::end_tracks
};

struct Resource {
  uint16_t name = 0;
  uint16_t blocks_first = 0, blocks_count = 0;  // a range in Table::block_refs
  Trigger release;
  uint32_t approach_lock_ms = 0;
};

struct Rule {
  uint16_t layer;
  uint16_t number;  // from 1, within its layer
  Trigger trigger;
  uint16_t checks_first = 0, checks_count = 0;  // a range in Table::kids
  uint16_t mast = NONE;  // a declared mast
  int16_t aspect = -1;  // within that mast's aspects; -1: not one of them
  // The resources it takes, all at once or none: a range in Table::res_refs.
  // None: a plain rule.
  // Parallel to it, in Table::res_next: the blocks a train must be seen
  // going into after each resource before it is freed (sequential release).
  uint16_t res_first = 0, res_count = 0;
  // A range in Table::locks, and in Table::lock_with the resource each is
  // held with (NONE: the whole rule's).
  uint16_t locks_first = 0, locks_count = 0;
  uint16_t cancel = NONE;  // a moment node
  uint16_t withdraw = NONE;  // a moment node
  uint16_t approach_block = NONE;  // its own approach locking: a block ref in Table::block_refs
  uint32_t approach_ms = 0;
  uint16_t lamp = NONE;  // a lamp it lights (rule 36), in Table::lamps
  uint8_t light = 0;  // 1 on, 2 flash
};

// A range in Table::block_refs.
struct Range {
  uint16_t first = 0, count = 0;
};

// Every name once, in one string: far smaller than a string each.
struct NamePool {
  std::string chars;
  std::vector<uint16_t> starts;
  size_t size() const { return starts.size(); }
  std::string operator[](size_t i) const {
    size_t a = starts[i], b = i + 1 < starts.size() ? starts[i + 1] : chars.size();
    return chars.substr(a, b - a);
  }
  bool equals(size_t i, const std::string &s) const {
    size_t a = starts[i], b = i + 1 < starts.size() ? starts[i + 1] : chars.size();
    return b - a == s.size() && chars.compare(a, b - a, s) == 0;
  }
  uint16_t intern(const std::string &s) {
    for (size_t i = 0; i < starts.size(); i++)
      if (equals(i, s)) return static_cast<uint16_t>(i);
    starts.push_back(static_cast<uint16_t>(chars.size()));
    chars += s;
    return static_cast<uint16_t>(starts.size() - 1);
  }
};

struct Table {
  NamePool names;
  std::vector<Node> nodes;
  std::vector<uint16_t> kids;  // node indices
  std::vector<uint16_t> seq;  // node indices
  std::vector<Aspect> aspects;
  std::vector<StateString> states;
  std::vector<BlockRef> block_refs;
  std::vector<Member> members;
  std::vector<uint16_t> locks;  // turnout indices
  std::vector<uint16_t> lock_with;  // per lock: a resource index, or NONE
  std::vector<uint8_t> lock_own;  // per lock: 1 a panel lock, its own buttons get past (rule 37)
  std::vector<uint16_t> res_refs;  // resource indices
  std::vector<Range> res_next;  // per res_ref

  std::vector<uint16_t> sensors;  // names; declared first, then any only named
  std::vector<uint16_t> buttons;
  std::vector<uint16_t> switches;  // names
  std::vector<uint16_t> lamps;  // names, in the order rules first name them
  std::vector<uint16_t> turnouts;
  uint16_t declared_turnouts = 0;
  std::vector<Mast> masts;  // declared masts, in order
  std::vector<uint16_t> remote_boards;  // names
  std::vector<Mast> remote_masts;
  std::vector<RemoteItem> remote_items;
  std::vector<LogicBlock> blocks;
  std::vector<Resource> resources;
  std::vector<Rule> rules;  // layers in order, rules in order
  std::vector<uint16_t> layers;  // names
  std::vector<uint8_t> layer_routes;  // per layer: its reserving When rules share one request
  std::vector<End> ends;
  std::vector<EndTrack> end_tracks;
  std::vector<uint16_t> end_sensors;  // sensor indices

  std::string name(uint16_t i) const { return names[i]; }
  std::string rule_ref(uint16_t r) const { return names[layers[rules[r].layer]] + "/" + std::to_string(rules[r].number); }
  size_t bytes() const;  // heap held, roughly
};

struct RemoteStart {
  std::string board;
  int8_t online = -1;  // -1 not known
  std::map<std::string, std::string> sensors;
  std::map<std::string, std::string> turnouts;
  std::map<std::string, std::string> masts;
};

struct Start {
  std::string board;  // this board's name, as in its topics
  std::vector<std::pair<std::string, std::string>> links;  // end, its saved link
  bool logic_on = true;
  bool auto_on = true;  // the Auto/Manual switch
  bool broker_connected = true;
  std::map<std::string, bool> sensors_occupied;
  std::map<std::string, std::string> turnouts;
  std::vector<std::pair<std::string, std::string>> jmri;  // mast, retained message
  std::vector<RemoteStart> remote;
  std::map<std::string, bool> remote_locks;
  std::map<std::string, bool> switches;  // on
};

struct Event {
  enum Kind : uint8_t {
    SENSOR, BUTTON, TURNOUT, REMOTE_LOCK, JMRI, RELEASE, LOGIC, BROKER,
    AUTO,  // value "on" or "off"
    RELEASE_GROUP,  // name the group, value "mqtt" or not
    REMOTE_ONLINE, REMOTE_ITEM, REMOTE_MAST,
    // Plant ends: name is this board's end. END_BLOCK and END_MAST carry the
    // linked end's track number, as it numbers it. PAIRING is an announcement.
    END_PAIR, END_LINK, END_THEIR_LINK, END_ONLINE, END_BLOCK, END_MAST, PAIRING,
    SWITCH,  // value "on" or "off"
  };
  Kind kind = SENSOR;
  std::string name;
  std::string value;
  std::string board;
  std::string item_kind;  // REMOTE_ITEM: sensor, block or turnout
  bool flag = false;  // REMOTE_ONLINE, END_ONLINE
  int32_t track = 0;  // END_BLOCK, END_MAST
};

struct LogEvent {
  // PAIRING: what is the end, by the result, rule the end it paired with.
  // DISAGREES: what is the end, rule its link, by the linked end's link.
  // IGNORED: by is "release" (what, a resource) or "releaseGroup" (what, a
  // group). RELEASE_GROUP: what is the group.
  enum Kind : uint8_t { STARTUP, GRANT, CANCEL, PASS, RELEASE, IGNORED, RESYNC, PAIRING, DISAGREES, RELEASE_GROUP };
  Kind kind;
  std::string what;
  std::string rule;  // empty: none (a start-up pass)
  std::string by;
};

// A mast's aspect; a field lock (lock); a panel lock (panel, rule 37); or a
// lamp (lamp, its light in aspect: "off", "on" or "flash", rule 36).
struct Write {
  bool lock = false;
  std::string name;
  std::string aspect;
  bool on = false;
  bool panel = false;
  bool lamp = false;
};

struct Publish {
  // END_*: resource is the end's name, and track its track. PAIRING: value only.
  // RELEASE_GROUP: resource is the group.
  enum Kind : uint8_t { HELD, STATE, RELEASE, PAIRING, END_LINK, END_BLOCK, END_MAST, RELEASE_GROUP };
  Kind kind;
  std::string resource;
  std::string value;
  uint16_t track = 0;
};

struct ScanOut {
  std::vector<LogEvent> events;
  std::vector<Write> writes;
  std::vector<Publish> publishes;
};

struct State {
  bool logic_on = false;
  bool auto_on = true;
  std::vector<std::pair<std::string, std::string>> masts;  // "" when nothing is shown
  std::vector<std::pair<std::string, std::string>> rules;
  std::vector<std::pair<std::string, std::string>> resources;
  std::vector<std::pair<std::string, std::string>> holders;  // "" for none
  std::vector<std::pair<std::string, bool>> locks;
  std::vector<std::pair<std::string, bool>> locked;
  std::vector<std::pair<std::string, bool>> panel;  // rule 37
  std::vector<std::pair<std::string, std::string>> lamps;  // rule 36
  std::vector<std::pair<std::string, std::string>> ends;  // README rule 26
  std::vector<std::pair<std::string, std::string>> links;
};

class Engine {
 public:
  Engine(const Table &table, const Start &start);
  Engine(const Engine &) = delete;
  Engine &operator=(const Engine &) = delete;
  Engine(Engine &&) = delete;
  Engine &operator=(Engine &&) = delete;

  void event(const Event &e);
  ScanOut scan();
  State state() const;
  bool logic_on() const { return logic_on_; }
  // What a mast shows now: an aspect, "dark", or "" for nothing. With logic
  // off a JMRI message changes this at once, with no scan.
  std::string shows(const std::string &mast) const;
  int64_t time_ms() const { return n_ * static_cast<int64_t>(SCAN_MS); }
  size_t bytes() const;  // heap held, roughly

  // Rules 18 and 13: today's handler for a mast (index in Table::masts).
  static constexpr int16_t SHOWS_NOTHING = -1, SHOWS_DARK = -2, IGNORED = -3;
  int16_t pick_aspect(uint16_t mast, const std::string &message) const;

  static constexpr uint32_t SCAN_MS = 100;
  static constexpr uint32_t RELEASE_WINDOW_MS = 5000;
  static constexpr uint32_t PAIR_MS = 30000;

 private:
  enum Phase : uint8_t { IDLE, ACTIVE, PASSED, CANCELLING };
  enum Turnout : uint8_t { T_NONE, T_CLOSED, T_THROWN, T_MOVING, T_OTHER };
  struct Latch {
    bool value = false, on = false, off = false;
  };
  struct TrigState {
    int64_t run_true = -1, run_false = -1, since = -1;
    bool eff = false, guard = false;
    bool asked = false, cancelled = false, withdrawn = false;  // this scan's moments, for its request
    int8_t prev_raw = -1;
    uint16_t seq_p = 0;
  };
  struct RuleState {
    Phase phase = IDLE;
    bool true_now = false, checks_now = false, cancel_now = false;
    int64_t cancel_at = 0;
    uint16_t ask = NONE;  // a reserving When rule's request, in asks_
    TrigState trig;
  };
  // A request, a rule's own or shared by a routes group's rules (rule 5).
  struct Ask {
    bool request = false;
    int64_t since = -1;
    std::vector<uint16_t> rules;
  };
  struct ResState {
    uint16_t holder = NONE;
    bool passed = false;  // its holder's train has entered it
    bool seen = false;  // and has been seen going on (sequential release)
    bool startup_held = false, rel_done = false, release_now = false;
    int64_t rel_run_true = -1;
    uint16_t rel_seq_p = 0;
  };
  struct Ctx {
    bool startup = false;
    std::vector<bool> held_at_start;
  };
  // A plant end: its link and what has been heard through it, per track of
  // this board (index 0 is track 1); and what was last published.
  struct EndState {
    std::string who;  // "<board>/<end>", this end's own address
    std::string link, their_link;  // their_link "": not heard
    int8_t online = -1;
    std::vector<int8_t> block, mast;  // -1 not heard; block 0 / 1; mast a Tag
    bool announce = false;
    int8_t prev_state = -1;
    bool link_published = false;
    std::string published_link;
    std::vector<int8_t> published_block, published_mast;  // -1 not yet
  };
  struct PairEntry {
    std::string who;
    int32_t tracks;
    int64_t until;
  };
  enum Link : uint8_t { LINK_EMPTY, LINK_END, LINK_BOARD };
  enum EndStateKind : uint8_t { E_PAIRING, E_EMPTY, E_END, E_UNHEARD, E_DISAGREES, E_HEARD };

  const Table &t_;
  std::vector<RuleState> rules_;
  std::vector<ResState> res_;
  std::vector<std::vector<uint16_t>> res_rules_;  // rules reserving each resource
  std::vector<bool> field_;  // per mast: some rule sets it
  std::vector<Latch> sensors_, buttons_, switches_;
  std::vector<bool> panel_locks_;  // rule 37
  std::vector<uint8_t> lamps_shown_;  // rule 36: 0 off, 1 on, 2 flash
  std::vector<uint16_t> held_;  // rule 34: leaf conditions with a for
  std::vector<int64_t> held_since_;  // per node: the scan its run began, -1 none
  std::vector<uint16_t> within_;  // rule 38: leaf conditions with a within
  std::vector<int64_t> last_at_;  // per node: the last scan it happened or held, -1 never
  std::vector<uint8_t> turnouts_;
  std::vector<bool> remote_locks_, field_locks_, prev_locked_;
  std::vector<int8_t> online_;  // per remote board
  std::vector<int16_t> remote_values_;  // per remote item; see value_of
  std::vector<uint8_t> edges_;  // per node: 0 false, 1 true, 2 not taken
  std::vector<uint16_t> tracked_;
  std::vector<uint16_t> timed_;  // timed moment nodes
  std::vector<int64_t> timed_start_;  // per node: the scan its run began, -1 none
  std::vector<bool> prev_block_;
  std::vector<Ask> asks_;
  bool startup_scan_ = false;
  bool auto_on_ = true;
  bool starting_ = true;  // the start's retained messages are no moment

  int64_t n_ = 0;
  bool broker_ = true;
  int64_t connect_at_ = -1;
  bool publish_all_ = true;
  bool logic_on_ = true;
  bool startup_next_ = true;
  int8_t pending_logic_ = -1;  // -1 none, 0 off, 1 on
  std::vector<std::pair<std::string, bool>> pending_releases_;  // resource name, ignored
  std::vector<std::pair<std::string, bool>> pending_group_releases_;  // group name, ignored

  std::vector<int16_t> jmri_shown_, display_, prev_out_;  // per mast: aspect, SHOWS_NOTHING or SHOWS_DARK
  std::vector<bool> holds_;
  std::vector<int8_t> last_held_;  // per mast (rule 30): -1 no message, 0 unheld, 1 held
  std::vector<uint8_t> hold_went_;  // per mast: 1 went held, 2 went unheld, since the last scan
  std::vector<int8_t> published_;  // per resource: held, then state; -1 not yet

  std::string board_;
  std::vector<EndState> ends_;
  std::vector<PairEntry> pair_group_;
  std::vector<std::vector<PairEntry>> closed_groups_;
  bool ends_publish_all_ = true;

  int16_t find(const std::vector<uint16_t> &list, const std::string &name) const;
  int16_t find_mast(const std::string &name) const;
  int16_t find_remote_item(uint16_t board, uint8_t kind, const std::string &name) const;
  int16_t aspect_index(const Mast &m, const std::string &name) const;
  Tag aspect_tag(const Mast &m, int16_t a) const;
  bool known(uint16_t board, bool has) const;
  bool occupied_ref(uint16_t item, bool logic_block);
  bool remote_occupied(uint16_t item);
  bool went(uint16_t item, bool logic_block, bool on);
  bool condition(uint16_t node);
  bool condition_core(uint16_t node);  // its state, ignoring a for
  bool moment(uint16_t node);
  bool moment_now(uint16_t node);
  bool came_from(uint16_t node);
  void update_timed();
  void settle_asks();
  bool same_input_in_order(uint16_t prev, uint16_t next);
  bool advance(uint16_t first, uint16_t count, uint16_t *p);
  void reset_trigger(uint16_t r);
  void reset_release(uint16_t i);
  bool held(uint16_t i) const;
  bool holds_any(uint16_t r) const;
  uint16_t res_of(uint16_t r, uint16_t k) const { return t_.res_refs[t_.rules[r].res_first + k]; }
  void eval_trigger(uint16_t r, const Ctx &ctx);
  void eval_release(uint16_t i);
  void free_res(uint16_t i);
  bool block_occupied_or_went(uint16_t i);
  bool blocks_clear(uint16_t i);
  bool mast_held(uint16_t r) const;
  bool is_active(uint16_t r) const;
  bool locks_held(uint16_t r) const;
  const char *resource_state(uint16_t i) const;
  // new_panel and new_lamps null: all off.
  void finish(ScanOut *out, const std::vector<int16_t> *new_out, const std::vector<bool> &new_locks,
              const std::vector<bool> *new_panel = nullptr, const std::vector<uint8_t> *new_lamps = nullptr);
  void publish_resources(ScanOut *out, const std::vector<Publish> &echoes);
  void record_edges();
  void end_scan();
  void switch_off(ScanOut *out, const std::vector<Publish> &echoes);
  void release_by_hand(uint16_t i, ScanOut *out, std::vector<bool> *released_now, std::vector<bool> *force_stop);
  void jmri_message(uint16_t mast, const std::string &message);
  std::string aspect_text(uint16_t mast, int16_t a) const;
  void track(uint16_t node);
  bool has_layer(const std::string &name) const;
  // Plant ends (README rules 23-29).
  int16_t find_end(const std::string &name) const;
  const std::string &who(uint16_t end) const { return ends_[end].who; }
  Link link_kind(uint16_t end) const;
  void set_link(uint16_t end, const std::string &link);
  bool ready(uint16_t end) const;
  void end_hears(uint16_t end, int32_t track, bool *occupied, Tag *tag) const;
  bool in_pairing(uint16_t end) const;
  EndStateKind end_state(uint16_t end) const;
  void end_offer(uint16_t end, uint16_t i, bool *occupied, Tag *tag) const;
  void join_pairing(const std::string &who, int32_t tracks, int64_t t);
  void heard_pairing(const std::string &text, int64_t t);
  void decide_pairing(ScanOut *out);
  void finish_ends(ScanOut *out);
  void end_event(const Event &e, int64_t t);
};

}  // namespace logic_core
