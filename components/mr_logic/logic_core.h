// The logic engine's core: plain C++17, no ESPHome, no exceptions, no RTTI.
// It mirrors configurator/logic.js function for function, and both replay the
// same cases (configurator/test/cases/*.json, see its README.md for the scan's
// numbered rules). engine-tests/ builds this on a computer and runs them.
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

struct MastDef {
  std::string name;
  std::vector<std::pair<std::string, Tag>> aspects;  // in order
  std::vector<std::string> diverging;
  std::string stop;  // empty: R292 or Stop, else the first stop aspect
  std::map<std::string, std::vector<std::string>> states;  // custom exact strings
  std::string startup;  // empty: none
  std::string approach_light;  // a block; empty: always lit
};

// A condition, or a moment (the same shapes).
struct Cond {
  enum Kind : uint8_t { ALL, ANY, NOT, BLOCK, TURNOUT, MAST, BUTTON };
  Kind kind = BLOCK;
  std::string name;
  bool remote = false;
  std::string board;
  std::vector<std::string> is;  // one value, or a mast's tags
  std::vector<Cond> kids;
};

struct Trigger {
  bool present = false;
  bool when = false;
  Cond cond;  // while
  std::vector<Cond> seq;  // when, then ...
  uint32_t for_ms = 0;
  bool leaving_guard = false;
};

struct Then {
  std::string mast;
  std::string aspect;
  std::string reserve;
  std::vector<std::string> lock;
};

struct RuleDef {
  Trigger trigger;
  std::vector<Cond> checks;
  Then then;
  bool has_cancel = false;
  Cond cancel;
};

struct LayerDef {
  std::string name;
  std::vector<RuleDef> rules;
};

struct ResourceDef {
  std::string name;
  std::vector<std::string> blocks;
  Trigger release;
  uint32_t approach_lock_ms = 0;
};

struct Member {
  std::string name;
  bool remote = false;
  std::string board;
};

struct BlockDef {
  std::string name;
  std::vector<Member> members;
};

struct RemoteBoardDef {
  std::string name;
  std::vector<std::string> sensors;
  std::vector<std::string> blocks;
  std::vector<std::string> turnouts;
  std::vector<MastDef> masts;
};

struct Board {
  std::vector<std::string> sensors;
  std::vector<std::string> turnouts;
  std::vector<MastDef> masts;
  std::vector<RemoteBoardDef> remote;
  std::vector<BlockDef> blocks;
  std::vector<std::string> buttons;
  std::vector<ResourceDef> resources;
  std::vector<LayerDef> layers;
};

struct RemoteStart {
  std::string board;
  int8_t online = -1;  // -1 not known
  std::map<std::string, std::string> sensors;
  std::map<std::string, std::string> turnouts;
  std::map<std::string, std::string> masts;
};

struct Start {
  bool logic_on = true;
  bool broker_connected = true;
  std::map<std::string, bool> sensors_occupied;
  std::map<std::string, std::string> turnouts;
  std::vector<std::pair<std::string, std::string>> jmri;  // mast, retained message
  std::vector<RemoteStart> remote;
  std::map<std::string, bool> remote_locks;
};

struct Event {
  enum Kind : uint8_t {
    SENSOR, BUTTON, TURNOUT, REMOTE_LOCK, JMRI, RELEASE, LOGIC, BROKER,
    REMOTE_ONLINE, REMOTE_ITEM, REMOTE_MAST,
  };
  Kind kind = SENSOR;
  std::string name;  // sensor, button, turnout, mast, resource, or remote item
  std::string value;  // occupied, pressed, closed, the message, mqtt, on, connected, the aspect ...
  std::string board;
  std::string item_kind;  // REMOTE_ITEM: sensor, block or turnout
  bool flag = false;  // REMOTE_ONLINE
};

struct LogEvent {
  enum Kind : uint8_t { STARTUP, GRANT, CANCEL, PASS, RELEASE, IGNORED, RESYNC };
  Kind kind;
  std::string what;  // resource or turnout
  std::string rule;  // empty: none (a start-up pass)
  std::string by;
};

struct Write {
  bool lock = false;
  std::string name;
  std::string aspect;
  bool on = false;
};

struct Publish {
  enum Kind : uint8_t { HELD, STATE, RELEASE };
  Kind kind;
  std::string resource;
  std::string value;
};

struct ScanOut {
  std::vector<LogEvent> events;
  std::vector<Write> writes;
  std::vector<Publish> publishes;
};

struct State {
  bool logic_on = false;
  std::vector<std::pair<std::string, std::string>> masts;  // "" when nothing is shown
  std::vector<std::pair<std::string, std::string>> rules;
  std::vector<std::pair<std::string, std::string>> resources;
  std::vector<std::pair<std::string, std::string>> holders;  // "" for none
  std::vector<std::pair<std::string, bool>> locks;
  std::vector<std::pair<std::string, bool>> locked;
};

// Today's handler (cases README rule 18): the aspect a JMRI message picks, or
// "dark". Returns false when the message is ignored.
bool pick_aspect(const MastDef &mast, const std::string &message, std::string *out);
std::string stop_aspect(const MastDef &mast);

class Engine {
 public:
  Engine(const Board &board, const Start &start);
  // Rules and resources point into board_, so an Engine stays where it is made.
  Engine(const Engine &) = delete;
  Engine &operator=(const Engine &) = delete;
  Engine(Engine &&) = delete;
  Engine &operator=(Engine &&) = delete;
  void event(const Event &e);
  ScanOut scan();
  State state() const;
  int64_t time_ms() const { return n_ * static_cast<int64_t>(SCAN_MS); }

  static constexpr uint32_t SCAN_MS = 100;
  static constexpr uint32_t RELEASE_WINDOW_MS = 5000;

 private:
  enum Phase : uint8_t { IDLE, ACTIVE, PASSED, CANCELLING };
  struct Latch {
    bool value = false, on = false, off = false;
  };
  struct TrigState {
    int64_t run_true = -1, run_false = -1, since = -1;
    bool eff = false, guard = false, request = false, fired = false;
    int8_t prev_raw = -1;
    size_t seq_p = 0;
  };
  struct Rule {
    const RuleDef *def;
    std::string ref;
    int index;
    int resource = -1;
    Phase phase = IDLE;
    int64_t cancel_at = 0;
    bool true_now = false, checks_now = false;
    TrigState trig;
  };
  struct Resource {
    const ResourceDef *def;
    std::vector<int> rules;
    int holder = -1;
    bool startup_held = false;
    int64_t rel_run_true = -1;
    size_t rel_seq_p = 0;
    bool rel_done = false;
    bool release_now = false;
  };
  struct Remote {
    int8_t online = -1;
    std::map<std::string, std::string> items;  // kind \0 name -> value; absent: not known
  };
  struct Ctx {
    bool startup = false;
    std::vector<bool> held_at_start;
  };

  Board board_;
  std::vector<Rule> rules_;
  std::vector<std::vector<int>> layer_rules_;
  std::vector<Resource> resources_;
  std::vector<std::string> field_masts_;
  std::map<std::string, Latch> latched_;
  std::map<std::string, std::string> turnouts_;
  std::map<std::string, bool> remote_locks_;
  std::map<std::string, Remote> remote_;
  std::vector<const Cond *> tracked_;
  std::map<const Cond *, bool> edges_;
  std::map<std::string, bool> prev_block_;

  int64_t n_ = 0;
  bool broker_ = true;
  int64_t connect_at_ = -1;
  bool publish_all_ = true;
  bool logic_on_ = true;
  bool startup_next_ = true;
  std::string pending_logic_;
  std::vector<std::pair<std::string, bool>> pending_releases_;  // resource, ignored

  std::map<std::string, std::string> jmri_shown_;  // "" none
  std::map<std::string, bool> holds_;
  std::map<std::string, std::string> display_;  // "" nothing shown
  std::map<std::string, std::string> prev_out_;
  std::map<std::string, bool> field_locks_;
  std::map<std::string, bool> prev_locked_;
  std::map<std::string, std::string> published_;

  const MastDef *mast(const std::string &name) const;
  const MastDef *remote_mast(const std::string &board, const std::string &name) const;
  const RemoteBoardDef *remote_board(const std::string &name) const;
  const BlockDef *logic_block(const std::string &name) const;
  bool is_field(const std::string &name) const;
  Latch &input(const char *kind, const std::string &name);
  std::string remote_kind(const std::string &board, const std::string &name) const;
  bool remote_value(const std::string &board, const std::string &kind, const std::string &name, std::string *out) const;
  bool known(const std::string &board, bool has) const;
  bool occupied(const std::string &name, bool remote, const std::string &board);
  bool went(const std::string &name, bool on);
  bool turnout_is(const std::string &name, bool remote, const std::string &board, const std::string &is);
  void mast_reading(const std::string &name, bool remote, const std::string &board, const MastDef **def,
                    std::string *aspect, Tag *tag);
  bool condition(const Cond &c);
  bool moment(const Cond &m);
  bool same_input_in_order(const Cond &prev, const Cond &next);
  bool advance(const std::vector<Cond> &seq, size_t *p);
  void reset_trigger(Rule &rule);
  void reset_release(Resource &res);
  bool held(const Resource &res) const;
  void eval_trigger(Rule &rule, const Ctx &ctx);
  void eval_release(Resource &res);
  void free_res(Resource &res);
  bool block_occupied_or_went(const Resource &res);
  bool blocks_clear(const Resource &res);
  bool mast_held(const Rule &rule) const;
  bool is_active(const Rule &rule) const;
  bool locks_held(const Rule &rule) const;
  std::string resource_state(const Resource &res) const;
  void finish(ScanOut *out, const std::map<std::string, std::string> &new_out, const std::map<std::string, bool> &new_locks,
              bool has_out);
  void publish_resources(ScanOut *out, const std::vector<std::string> &echoes);
  void record_edges();
  void end_scan();
  void switch_off(ScanOut *out, const std::vector<std::string> &echoes);
  void set_latched(const char *kind, const std::string &name, bool value);
  void jmri_message(const std::string &mast_name, const std::string &message);
  void track(const Cond &c);
};

}  // namespace logic_core
