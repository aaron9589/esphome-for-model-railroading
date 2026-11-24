// See logic_table.h. Reads the rule table's JSON in one pass, straight into a
// Table, holding nothing else but a few names: no JSON tree is built. A second
// pass resolves names to indices, so keys may come in any order.
#include "logic_table.h"

#include <cstdlib>
#include <cstring>
#include <utility>

namespace logic_core {

namespace {

// --- reading JSON ----------------------------------------------------------

class Reader {
 public:
  explicit Reader(const char *text) : start_(text), p_(text) {}
  bool ok() const { return error_.empty(); }
  const std::string &error() const { return error_; }
  void fail(const std::string &what) {
    if (error_.empty()) error_ = what + " (at character " + std::to_string(p_ - start_) + ")";
  }
  char peek() {
    ws();
    return *p_;
  }
  bool at_end() {
    ws();
    return *p_ == '\0';
  }
  // Objects and arrays: call with first = true, then in a loop while it returns true.
  bool member(bool *first, std::string *key) {
    if (!ok()) return false;
    if (*first) {
      if (!eat('{')) {
        fail("expected an object");
        return false;
      }
    }
    if (eat('}')) return false;
    if (!*first && !eat(',')) {
      fail("expected , or }");
      return false;
    }
    *first = false;
    key->clear();
    if (!string(key)) return false;
    if (!eat(':')) {
      fail("expected :");
      return false;
    }
    return true;
  }
  bool element(bool *first) {
    if (!ok()) return false;
    if (*first) {
      if (!eat('[')) {
        fail("expected a list");
        return false;
      }
    }
    if (eat(']')) return false;
    if (!*first && !eat(',')) {
      fail("expected , or ]");
      return false;
    }
    *first = false;
    return true;
  }
  bool string(std::string *out) {
    if (!eat('"')) {
      fail("expected a string");
      return false;
    }
    while (*p_ && *p_ != '"') {
      char c = *p_++;
      if (c != '\\') {
        out->push_back(c);
        continue;
      }
      char e = *p_++;
      switch (e) {
        case 'n': out->push_back('\n'); break;
        case 't': out->push_back('\t'); break;
        case 'r': out->push_back('\r'); break;
        case 'b': out->push_back('\b'); break;
        case 'f': out->push_back('\f'); break;
        case 'u': {
          char hex[5] = {0};
          for (int i = 0; i < 4 && *p_; i++) hex[i] = *p_++;
          unsigned code = std::strtoul(hex, nullptr, 16);
          if (code < 0x80) {
            out->push_back(static_cast<char>(code));
          } else if (code < 0x800) {
            out->push_back(static_cast<char>(0xC0 | (code >> 6)));
            out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
          } else {
            out->push_back(static_cast<char>(0xE0 | (code >> 12)));
            out->push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
          }
          break;
        }
        case '\0': fail("unfinished string"); return false;
        default: out->push_back(e);
      }
    }
    if (*p_ != '"') {
      fail("unfinished string");
      return false;
    }
    p_++;
    return true;
  }
  bool boolean() {
    ws();
    if (std::strncmp(p_, "true", 4) == 0) {
      p_ += 4;
      return true;
    }
    if (std::strncmp(p_, "false", 5) == 0) {
      p_ += 5;
      return false;
    }
    skip();
    return false;
  }
  // A string, or "" for anything else (skipped).
  std::string text() {
    std::string out;
    if (peek() == '"')
      string(&out);
    else
      skip();
    return out;
  }
  void skip() {
    char c = peek();
    if (c == '{') {
      bool first = true;
      std::string key;
      while (member(&first, &key)) skip();
    } else if (c == '[') {
      bool first = true;
      while (element(&first)) skip();
    } else if (c == '"') {
      std::string s;
      string(&s);
    } else if (std::strncmp(p_, "true", 4) == 0) {
      p_ += 4;
    } else if (std::strncmp(p_, "false", 5) == 0) {
      p_ += 5;
    } else if (std::strncmp(p_, "null", 4) == 0) {
      p_ += 4;
    } else {
      char *end = nullptr;
      std::strtod(p_, &end);
      if (end == p_) {
        fail("unexpected character");
        return;
      }
      p_ = end;
    }
  }

 private:
  void ws() {
    while (*p_ == ' ' || *p_ == '\n' || *p_ == '\r' || *p_ == '\t') p_++;
  }
  bool eat(char c) {
    ws();
    if (*p_ != c) return false;
    p_++;
    return true;
  }
  const char *start_;
  const char *p_;
  std::string error_;
};

// --- compiling -------------------------------------------------------------

struct RawMember {
  uint16_t name;
  uint16_t board;  // NONE: this board
};
struct RawRemote {
  uint16_t name;
  std::vector<uint16_t> blocks;
  std::vector<std::pair<uint16_t, uint16_t>> masts;  // name, remote mast def
};
struct RawRule {
  uint16_t mast = NONE, aspect = NONE, reserve = NONE;
  std::vector<uint16_t> locks;
};

class Compiler {
 public:
  Compiler(const char *text, Table *t, std::string *error) : r_(text), t_(*t), error_(*error) {}

  bool run() {
    read_board();
    if (r_.ok() && !r_.at_end()) r_.fail("text after the table");
    if (!r_.ok()) {
      error_ = r_.error();
      return false;
    }
    resolve();
    return error_.empty();
  }

 private:
  Reader r_;
  Table &t_;
  std::string &error_;
  std::vector<uint16_t> declared_sensors_, declared_buttons_;
  std::vector<RawRemote> remotes_;
  std::vector<std::vector<RawMember>> block_members_;
  std::vector<std::vector<uint16_t>> resource_blocks_;
  std::vector<uint16_t> approach_lights_;  // per mast: a name, or NONE
  std::vector<RawRule> raw_rules_;
  std::vector<uint16_t> resource_names_;

  uint16_t intern(const std::string &s) { return t_.names.intern(s); }
  // Per node, while compiling: the item's name and its board's.
  std::vector<std::pair<uint16_t, uint16_t>> node_names_;
  uint16_t read_name() { return intern(r_.text()); }
  void bad_time(const std::string &text, const std::string &where) {
    if (error_.empty()) error_ = where + ": a time the engine cannot read (" + text + ")";
  }
  uint32_t read_ms(const std::string &where) {
    std::string text = r_.text();
    uint32_t ms = 0;
    if (!parse_ms(text, &ms)) bad_time(text, where);
    return ms;
  }
  std::vector<uint16_t> read_names() {
    std::vector<uint16_t> out;
    bool first = true;
    while (r_.element(&first)) out.push_back(read_name());
    return out;
  }

  void read_board() {
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "sensors") {
        declared_sensors_ = read_names();
      } else if (key == "turnouts") {
        t_.turnouts = read_names();
      } else if (key == "masts") {
        read_masts(&t_.masts, true);
      } else if (key == "remote") {
        read_remote();
      } else if (key == "logic") {
        read_logic();
      } else {
        r_.skip();
      }
    }
    t_.declared_turnouts = static_cast<uint16_t>(t_.turnouts.size());
  }

  // Masts: { name: { aspects: { a: tag }, diverging, stop, startup, states, approachLight } }.
  void read_masts(std::vector<Mast> *list, bool local) {
    bool first = true;
    std::string name;
    while (r_.member(&first, &name)) {
      Mast m;
      m.name = intern(name);
      m.aspect_first = static_cast<uint16_t>(t_.aspects.size());
      std::vector<uint16_t> diverging;
      std::vector<std::pair<uint16_t, std::vector<std::string>>> states;
      uint16_t stop = NONE, startup = NONE, approach = NONE;
      bool f2 = true;
      std::string key;
      while (r_.member(&f2, &key)) {
        if (key == "aspects") {
          bool f3 = true;
          std::string a;
          while (r_.member(&f3, &a)) {
            Aspect asp{intern(a), tag_from_name(r_.text()), false, false};
            t_.aspects.push_back(asp);
          }
        } else if (key == "diverging") {
          diverging = read_names();
        } else if (key == "stop") {
          stop = read_name();
        } else if (key == "startup") {
          startup = read_name();
        } else if (key == "approachLight") {
          approach = read_name();
        } else if (key == "states") {
          bool f3 = true;
          std::string a;
          while (r_.member(&f3, &a)) {
            std::vector<std::string> texts;
            bool f4 = true;
            while (r_.element(&f4)) texts.push_back(r_.text());
            states.emplace_back(intern(a), std::move(texts));
          }
        } else {
          r_.skip();
        }
      }
      m.aspect_count = static_cast<uint16_t>(t_.aspects.size() - m.aspect_first);
      auto index_of = [&](uint16_t aspect_name) -> int16_t {
        for (uint16_t i = 0; i < m.aspect_count; i++)
          if (t_.aspects[m.aspect_first + i].name == aspect_name) return static_cast<int16_t>(i);
        return -1;
      };
      for (uint16_t d : diverging) {
        int16_t i = index_of(d);
        if (i >= 0) t_.aspects[m.aspect_first + i].diverging = true;
      }
      // Rule: the stop aspect is set, else R292 or Stop, else the first stop aspect, else the first.
      int16_t s = stop != NONE ? index_of(stop) : -1;
      if (s >= 0 && t_.aspects[m.aspect_first + s].tag == TAG_NONE) s = -1;
      for (const char *held : {"R292", "Stop"}) {
        if (s >= 0) break;
        int16_t i = index_of(intern(held));
        if (i >= 0 && t_.aspects[m.aspect_first + i].tag == TAG_STOP) s = i;
      }
      for (uint16_t i = 0; s < 0 && i < m.aspect_count; i++)
        if (t_.aspects[m.aspect_first + i].tag == TAG_STOP) s = static_cast<int16_t>(i);
      if (s < 0 && m.aspect_count) s = 0;
      m.stop = s;
      int16_t u = startup != NONE ? index_of(startup) : -1;
      m.startup = (u >= 0 && t_.aspects[m.aspect_first + u].tag != TAG_NONE) ? u : -1;
      m.states_first = static_cast<uint16_t>(t_.states.size());
      for (auto &st : states) {
        int16_t i = index_of(st.first);
        if (i < 0) continue;
        t_.aspects[m.aspect_first + i].custom_states = true;
        for (auto &text : st.second) {
          size_t a = text.find_first_not_of(" \t\r\n");
          if (a == std::string::npos) continue;
          t_.states.push_back({i, text.substr(a, text.find_last_not_of(" \t\r\n") - a + 1)});
        }
      }
      m.states_count = static_cast<uint16_t>(t_.states.size() - m.states_first);
      if (local) approach_lights_.push_back(approach);
      list->push_back(m);
    }
  }

  void read_remote() {
    bool first = true;
    std::string board;
    while (r_.member(&first, &board)) {
      RawRemote rb;
      rb.name = intern(board);
      bool f2 = true;
      std::string key;
      while (r_.member(&f2, &key)) {
        if (key == "blocks") {
          rb.blocks = read_names();
        } else if (key == "masts") {
          size_t before = t_.remote_masts.size();
          read_masts(&t_.remote_masts, false);
          for (size_t i = before; i < t_.remote_masts.size(); i++)
            rb.masts.emplace_back(t_.remote_masts[i].name, static_cast<uint16_t>(i));
        } else {
          r_.skip();  // sensors and turnouts: their names are enough when used
        }
      }
      t_.remote_boards.push_back(rb.name);
      remotes_.push_back(std::move(rb));
    }
  }

  void read_logic() {
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "blocks") {
        bool f2 = true;
        while (r_.element(&f2)) read_block();
      } else if (key == "buttons") {
        bool f2 = true;
        while (r_.element(&f2)) {
          bool f3 = true;
          std::string k;
          while (r_.member(&f3, &k)) {
            if (k == "name")
              declared_buttons_.push_back(read_name());
            else
              r_.skip();
          }
        }
      } else if (key == "resources") {
        bool f2 = true;
        while (r_.element(&f2)) read_resource();
      } else if (key == "layers") {
        bool f2 = true;
        while (r_.element(&f2)) read_layer();
      } else {
        r_.skip();
      }
    }
  }

  void read_block() {
    LogicBlock b;
    std::vector<RawMember> members;
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "name") {
        b.name = read_name();
      } else if (key == "sensors") {
        bool f2 = true;
        while (r_.element(&f2)) {
          if (r_.peek() == '"') {
            members.push_back({read_name(), NONE});
            continue;
          }
          RawMember m{NONE, NONE};
          uint16_t sensor = NONE, block = NONE;
          bool f3 = true;
          std::string k;
          while (r_.member(&f3, &k)) {
            if (k == "sensor")
              sensor = read_name();
            else if (k == "block")
              block = read_name();
            else if (k == "board")
              m.board = read_name();
            else
              r_.skip();
          }
          m.name = sensor != NONE ? sensor : block;
          if (m.name != NONE) members.push_back(m);
        }
      } else {
        r_.skip();
      }
    }
    t_.blocks.push_back(b);
    block_members_.push_back(std::move(members));
  }

  void read_resource() {
    Resource res;
    std::vector<uint16_t> blocks;
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "name")
        res.name = read_name();
      else if (key == "blocks")
        blocks = read_names();
      else if (key == "release")
        res.release = read_trigger("release");
      else if (key == "approachLock")
        res.approach_lock_ms = read_ms("approach locking");
      else
        r_.skip();
    }
    t_.resources.push_back(res);
    resource_blocks_.push_back(std::move(blocks));
  }

  void read_layer() {
    uint16_t layer = static_cast<uint16_t>(t_.layers.size());
    t_.layers.push_back(intern(""));
    uint16_t number = 0;
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "name") {
        t_.layers[layer] = read_name();
      } else if (key == "rules") {
        bool f2 = true;
        while (r_.element(&f2)) read_rule(layer, ++number);
      } else {
        r_.skip();
      }
    }
  }

  void read_rule(uint16_t layer, uint16_t number) {
    Rule rule;
    RawRule raw;
    rule.layer = layer;
    rule.number = number;
    std::vector<uint16_t> checks;
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "trigger") {
        rule.trigger = read_trigger("a rule's for");
      } else if (key == "checks") {
        bool f2 = true;
        while (r_.element(&f2)) checks.push_back(read_condition());
      } else if (key == "then") {
        bool f2 = true;
        std::string k;
        while (r_.member(&f2, &k)) {
          if (k == "mast")
            raw.mast = read_name();
          else if (k == "aspect")
            raw.aspect = read_name();
          else if (k == "reserve")
            raw.reserve = read_name();
          else if (k == "lock")
            raw.locks = read_names();
          else
            r_.skip();
        }
      } else if (key == "cancel") {
        bool f2 = true;
        std::string k;
        while (r_.member(&f2, &k)) {
          if (k == "when")
            rule.cancel = read_condition();
          else
            r_.skip();
        }
      } else {
        r_.skip();
      }
    }
    rule.checks_first = static_cast<uint16_t>(t_.kids.size());
    rule.checks_count = static_cast<uint16_t>(checks.size());
    t_.kids.insert(t_.kids.end(), checks.begin(), checks.end());
    t_.rules.push_back(rule);
    raw_rules_.push_back(std::move(raw));
  }

  Trigger read_trigger(const std::string &where) {
    Trigger t;
    t.present = true;
    uint16_t when = NONE;
    std::vector<uint16_t> thens;
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "while") {
        t.cond = read_condition();
      } else if (key == "when") {
        when = read_condition();
      } else if (key == "then") {
        bool f2 = true;
        while (r_.element(&f2)) thens.push_back(read_condition());
      } else if (key == "for") {
        t.for_ms = read_ms(where);
      } else if (key == "leavingGuard") {
        t.leaving_guard = r_.boolean();
      } else {
        r_.skip();
      }
    }
    if (when != NONE) {
      t.when = true;
      t.seq_first = static_cast<uint16_t>(t_.seq.size());
      t_.seq.push_back(when);
      t_.seq.insert(t_.seq.end(), thens.begin(), thens.end());
      t.seq_count = static_cast<uint16_t>(1 + thens.size());
    }
    return t;
  }

  // A condition: all / any / not, or one item with its is. As in logic.js, the
  // first of these keys that is present decides the kind.
  uint16_t read_condition() {
    Node n;
    std::vector<uint16_t> all, any;
    uint16_t neg = NONE;
    bool has_all = false, has_any = false, has_not = false;
    uint16_t block = NONE, sensor = NONE, turnout = NONE, mast = NONE, button = NONE;
    uint16_t board_name = NONE, item_name = NONE;
    std::vector<std::string> is;
    bool first = true;
    std::string key;
    while (r_.member(&first, &key)) {
      if (key == "all" || key == "any") {
        std::vector<uint16_t> &list = key == "all" ? all : any;
        (key == "all" ? has_all : has_any) = true;
        bool f2 = true;
        while (r_.element(&f2)) list.push_back(read_condition());
      } else if (key == "not") {
        has_not = true;
        neg = read_condition();
      } else if (key == "block") {
        block = read_name();
      } else if (key == "sensor") {
        sensor = read_name();
      } else if (key == "turnout") {
        turnout = read_name();
      } else if (key == "mast") {
        mast = read_name();
      } else if (key == "button") {
        button = read_name();
      } else if (key == "board") {
        board_name = read_name();
      } else if (key == "is") {
        if (r_.peek() == '[') {
          bool f2 = true;
          while (r_.element(&f2)) is.push_back(r_.text());
        } else {
          is.push_back(r_.text());
        }
      } else {
        r_.skip();
      }
    }
    const std::string first_is = is.empty() ? std::string() : is.front();
    auto kids = [&](Node::Kind kind, const std::vector<uint16_t> &list) {
      n.kind = kind;
      n.first = static_cast<uint16_t>(t_.kids.size());
      n.count = static_cast<uint16_t>(list.size());
      t_.kids.insert(t_.kids.end(), list.begin(), list.end());
    };
    if (has_all) {
      kids(Node::ALL, all);
    } else if (has_any) {
      kids(Node::ANY, any);
    } else if (has_not) {
      kids(Node::NOT, std::vector<uint16_t>(1, neg));
    } else if (block != NONE || sensor != NONE) {
      n.kind = Node::BLOCK;
      item_name = block != NONE ? block : sensor;
      n.is = first_is == "clear" ? Node::IS_CLEAR : first_is == "occupied" ? Node::IS_OCCUPIED : Node::IS_OTHER;
    } else if (turnout != NONE) {
      n.kind = Node::TURNOUT;
      item_name = turnout;
      n.is = first_is == "closed" ? Node::IS_CLOSED : first_is == "thrown" ? Node::IS_THROWN : Node::IS_OTHER;
    } else if (mast != NONE) {
      n.kind = Node::MAST;
      item_name = mast;
      if (first_is == "diverging") {
        n.is = Node::IS_DIVERGING;
      } else {
        n.is = Node::IS_TAGS;
        for (const auto &v : is) {
          Tag tag = tag_from_name(v);
          if (tag != TAG_NONE) n.tags |= static_cast<uint8_t>(1u << tag);
        }
      }
    } else if (button != NONE) {
      n.kind = Node::BUTTON;
      item_name = button;
      n.is = first_is == "pressed" ? Node::IS_PRESSED : Node::IS_OTHER;
    } else {
      // Nothing to read: an empty any, which is never true.
      kids(Node::ANY, {});
    }
    n.remote = board_name != NONE ? 1 : 0;
    t_.nodes.push_back(n);
    node_names_.emplace_back(item_name, board_name);
    return static_cast<uint16_t>(t_.nodes.size() - 1);
  }

  // --- resolving names to indices ---

  static uint16_t index_in(const std::vector<uint16_t> &list, uint16_t name) {
    for (size_t i = 0; i < list.size(); i++)
      if (list[i] == name) return static_cast<uint16_t>(i);
    return NONE;
  }
  static uint16_t add_to(std::vector<uint16_t> *list, uint16_t name) {
    uint16_t i = index_in(*list, name);
    if (i != NONE) return i;
    list->push_back(name);
    return static_cast<uint16_t>(list->size() - 1);
  }
  uint16_t logic_block(uint16_t name) const {
    for (size_t i = 0; i < t_.blocks.size(); i++)
      if (t_.blocks[i].name == name) return static_cast<uint16_t>(i);
    return NONE;
  }
  BlockRef block_ref(uint16_t name) {
    uint16_t b = logic_block(name);
    if (b != NONE) return {b, true};
    return {add_to(&t_.sensors, name), false};
  }
  uint16_t remote_board(uint16_t name) const { return index_in(t_.remote_boards, name); }
  // Another board's item, made on first use. Its kind is from that board's lists.
  uint16_t remote_item(uint16_t board, uint8_t kind, uint16_t name) {
    if (board == NONE) return NONE;
    if (kind == RemoteItem::SENSOR || kind == RemoteItem::BLOCK)
      kind = index_in(remotes_[board].blocks, name) != NONE ? RemoteItem::BLOCK : RemoteItem::SENSOR;
    for (size_t i = 0; i < t_.remote_items.size(); i++) {
      const RemoteItem &it = t_.remote_items[i];
      if (it.board == board && it.kind == kind && it.name == name) return static_cast<uint16_t>(i);
    }
    RemoteItem it{board, name, kind, NONE};
    if (kind == RemoteItem::MAST)
      for (const auto &m : remotes_[board].masts)
        if (m.first == name && it.mast == NONE) it.mast = m.second;
    t_.remote_items.push_back(it);
    return static_cast<uint16_t>(t_.remote_items.size() - 1);
  }
  uint16_t mast_index(uint16_t name) const {
    for (size_t i = 0; i < t_.masts.size(); i++)
      if (t_.masts[i].name == name) return static_cast<uint16_t>(i);
    return NONE;
  }

  void resolve() {
    t_.sensors = declared_sensors_;
    t_.buttons = declared_buttons_;
    for (size_t i = 0; i < t_.blocks.size(); i++) {
      t_.blocks[i].first = static_cast<uint16_t>(t_.members.size());
      for (const auto &m : block_members_[i]) {
        if (m.board == NONE) {
          // A member on this board is one of its sensors.
          t_.members.push_back({add_to(&t_.sensors, m.name), NONE});
        } else {
          uint16_t board = remote_board(m.board);
          t_.members.push_back({remote_item(board, RemoteItem::SENSOR, m.name), board});
        }
      }
      t_.blocks[i].count = static_cast<uint16_t>(t_.members.size() - t_.blocks[i].first);
    }
    for (size_t ni = 0; ni < t_.nodes.size(); ni++) {
      Node &n = t_.nodes[ni];
      const uint16_t name = node_names_[ni].first, board_name = node_names_[ni].second;
      if (n.kind <= Node::NOT) continue;
      if (board_name != NONE && n.kind != Node::BUTTON) {
        n.board = remote_board(board_name);
        uint8_t kind = n.kind == Node::TURNOUT ? RemoteItem::TURNOUT : n.kind == Node::MAST ? RemoteItem::MAST : RemoteItem::SENSOR;
        n.item = remote_item(n.board, kind, name);
        continue;
      }
      switch (n.kind) {
        case Node::BLOCK: {
          BlockRef ref = block_ref(name);
          n.item = ref.item;
          n.logic_block = ref.logic_block ? 1 : 0;
          break;
        }
        case Node::TURNOUT: n.item = add_to(&t_.turnouts, name); break;
        case Node::MAST: n.item = mast_index(name); break;
        case Node::BUTTON: n.item = add_to(&t_.buttons, name); break;
        default: break;
      }
    }
    for (size_t i = 0; i < t_.resources.size(); i++) {
      t_.resources[i].blocks_first = static_cast<uint16_t>(t_.block_refs.size());
      for (uint16_t name : resource_blocks_[i]) t_.block_refs.push_back(block_ref(name));
      t_.resources[i].blocks_count = static_cast<uint16_t>(t_.block_refs.size() - t_.resources[i].blocks_first);
    }
    for (size_t i = 0; i < t_.masts.size(); i++) {
      if (approach_lights_[i] == NONE) continue;
      t_.masts[i].approach_light = static_cast<uint16_t>(t_.block_refs.size());
      t_.block_refs.push_back(block_ref(approach_lights_[i]));
    }
    for (size_t i = 0; i < t_.rules.size(); i++) {
      Rule &rule = t_.rules[i];
      const RawRule &raw = raw_rules_[i];
      rule.mast = raw.mast == NONE ? NONE : mast_index(raw.mast);
      if (rule.mast != NONE && raw.aspect != NONE) {
        const Mast &m = t_.masts[rule.mast];
        for (uint16_t a = 0; a < m.aspect_count; a++)
          if (t_.aspects[m.aspect_first + a].name == raw.aspect) rule.aspect = static_cast<int16_t>(a);
      }
      // The first resource of the name, as in logic.js.
      for (size_t r = 0; raw.reserve != NONE && r < t_.resources.size(); r++) {
        if (t_.resources[r].name == raw.reserve) {
          rule.resource = static_cast<uint16_t>(r);
          break;
        }
      }
      rule.locks_first = static_cast<uint16_t>(t_.locks.size());
      for (uint16_t name : raw.locks) t_.locks.push_back(add_to(&t_.turnouts, name));
      rule.locks_count = static_cast<uint16_t>(t_.locks.size() - rule.locks_first);
    }
    if (t_.nodes.size() >= NONE || t_.names.size() >= NONE || t_.names.chars.size() >= NONE || t_.rules.size() >= NONE)
      error_ = "the table is too big";
  }
};

template <typename T>
void fit(std::vector<T> *v) {
  v->shrink_to_fit();
}

}  // namespace

// "0.5s" or "500ms", spaces around allowed; empty is 0. Anything else is an
// error, exactly as logic.js reads it: ^(\d+(\.\d+)?)(ms|s)$.
bool parse_ms(const std::string &raw, uint32_t *out) {
  *out = 0;
  size_t a = raw.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return raw.empty();
  std::string text = raw.substr(a, raw.find_last_not_of(" \t\r\n") - a + 1);
  bool millis = text.size() > 2 && text.compare(text.size() - 2, 2, "ms") == 0;
  bool secs = !millis && !text.empty() && text.back() == 's';
  if (!millis && !secs) return false;
  std::string number = text.substr(0, text.size() - (millis ? 2 : 1));
  size_t i = 0;
  while (i < number.size() && number[i] >= '0' && number[i] <= '9') i++;
  if (i == 0) return false;
  if (i < number.size()) {
    if (number[i] != '.') return false;
    size_t j = i + 1;
    while (j < number.size() && number[j] >= '0' && number[j] <= '9') j++;
    if (j == i + 1 || j != number.size()) return false;
  }
  *out = static_cast<uint32_t>(std::strtod(number.c_str(), nullptr) * (millis ? 1 : 1000) + 0.5);
  return true;
}

bool compile_table(const char *json, Table *out, std::string *error) {
  error->clear();
  Table t;
  if (!Compiler(json ? json : "", &t, error).run()) return false;
  t.names.chars.shrink_to_fit();
  fit(&t.names.starts);
  fit(&t.nodes);
  fit(&t.kids);
  fit(&t.seq);
  fit(&t.aspects);
  fit(&t.states);
  fit(&t.block_refs);
  fit(&t.members);
  fit(&t.locks);
  fit(&t.sensors);
  fit(&t.buttons);
  fit(&t.turnouts);
  fit(&t.masts);
  fit(&t.remote_boards);
  fit(&t.remote_masts);
  fit(&t.remote_items);
  fit(&t.blocks);
  fit(&t.resources);
  fit(&t.rules);
  fit(&t.layers);
  *out = std::move(t);
  return true;
}

}  // namespace logic_core
