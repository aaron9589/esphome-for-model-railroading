// See logic_table.h.
#include "logic_table.h"

#include <cstdlib>

namespace logic_core {

using json::Value;

namespace {

// "0.5s" or "500ms"; empty is 0. Anything else is an error, as in logic.js.
bool parse_ms(const std::string &text, uint32_t *out) {
  *out = 0;
  if (text.empty()) return true;
  bool millis = text.size() > 2 && text.compare(text.size() - 2, 2, "ms") == 0;
  bool secs = !millis && text.size() > 1 && text.back() == 's';
  if (!millis && !secs) return false;
  std::string number = text.substr(0, text.size() - (millis ? 2 : 1));
  if (number.empty() || number.find_first_not_of("0123456789.") != std::string::npos) return false;
  char *end = nullptr;
  double n = std::strtod(number.c_str(), &end);
  if (*end != '\0') return false;
  *out = static_cast<uint32_t>(n * (millis ? 1 : 1000) + 0.5);
  return true;
}

std::string *g_error = nullptr;  // the first problem while reading a table

uint32_t duration(const std::string &text, const std::string &where) {
  uint32_t ms = 0;
  if (!parse_ms(text, &ms) && g_error && g_error->empty()) *g_error = where + ": a time the engine cannot read (" + text + ")";
  return ms;
}

std::vector<std::string> strings(const Value *v) {
  std::vector<std::string> out;
  if (!v) return out;
  if (v->type == Value::STR) out.push_back(v->str);
  for (const auto &x : v->arr) out.push_back(x.str);
  return out;
}

Cond to_cond(const Value &v) {
  Cond c;
  if (const Value *k = v.get("all")) {
    c.kind = Cond::ALL;
    for (const auto &x : k->arr) c.kids.push_back(to_cond(x));
    return c;
  }
  if (const Value *k = v.get("any")) {
    c.kind = Cond::ANY;
    for (const auto &x : k->arr) c.kids.push_back(to_cond(x));
    return c;
  }
  if (const Value *k = v.get("not")) {
    c.kind = Cond::NOT;
    c.kids.push_back(to_cond(*k));
    return c;
  }
  if (v.has("block") || v.has("sensor")) {
    c.kind = Cond::BLOCK;
    c.name = v.has("block") ? v.text("block") : v.text("sensor");
  } else if (v.has("turnout")) {
    c.kind = Cond::TURNOUT;
    c.name = v.text("turnout");
  } else if (v.has("mast")) {
    c.kind = Cond::MAST;
    c.name = v.text("mast");
  } else if (v.has("button")) {
    c.kind = Cond::BUTTON;
    c.name = v.text("button");
  }
  if (v.has("board")) {
    c.remote = true;
    c.board = v.text("board");
  }
  c.is = strings(v.get("is"));
  return c;
}

Trigger to_trigger(const Value *v) {
  Trigger t;
  if (!v) return t;
  t.present = true;
  t.for_ms = duration(v->text("for"), "for");
  if (const Value *b = v->get("leavingGuard")) t.leaving_guard = b->b;
  if (const Value *w = v->get("when")) {
    t.when = true;
    t.seq.push_back(to_cond(*w));
    if (const Value *then = v->get("then"))
      for (const auto &m : then->arr) t.seq.push_back(to_cond(m));
  } else if (const Value *w = v->get("while")) {
    t.cond = to_cond(*w);
  }
  return t;
}

MastDef to_mast(const std::string &name, const Value &v) {
  MastDef m;
  m.name = name;
  if (const Value *a = v.get("aspects"))
    for (const auto &p : a->obj) m.aspects.emplace_back(p.first, tag_from_name(p.second.str));
  m.diverging = strings(v.get("diverging"));
  m.stop = v.text("stop");
  m.startup = v.text("startup");
  m.approach_light = v.text("approachLight");
  if (const Value *s = v.get("states"))
    for (const auto &p : s->obj) m.states[p.first] = strings(&p.second);
  return m;
}

}  // namespace

Board board_from_value(const Value &v) {
  Board b;
  b.sensors = strings(v.get("sensors"));
  b.turnouts = strings(v.get("turnouts"));
  if (const Value *m = v.get("masts"))
    for (const auto &p : m->obj) b.masts.push_back(to_mast(p.first, p.second));
  if (const Value *r = v.get("remote")) {
    for (const auto &p : r->obj) {
      RemoteBoardDef rb;
      rb.name = p.first;
      rb.sensors = strings(p.second.get("sensors"));
      rb.blocks = strings(p.second.get("blocks"));
      rb.turnouts = strings(p.second.get("turnouts"));
      if (const Value *m = p.second.get("masts"))
        for (const auto &q : m->obj) rb.masts.push_back(to_mast(q.first, q.second));
      b.remote.push_back(rb);
    }
  }
  const Value *logic = v.get("logic");
  if (!logic) return b;
  if (const Value *blocks = logic->get("blocks")) {
    for (const auto &x : blocks->arr) {
      BlockDef block;
      block.name = x.text("name");
      if (const Value *s = x.get("sensors")) {
        for (const auto &m : s->arr) {
          Member member;
          if (m.type == Value::STR) {
            member.name = m.str;
          } else {
            member.name = m.has("sensor") ? m.text("sensor") : m.text("block");
            member.remote = m.has("board");
            member.board = m.text("board");
          }
          block.members.push_back(member);
        }
      }
      b.blocks.push_back(block);
    }
  }
  if (const Value *buttons = logic->get("buttons"))
    for (const auto &x : buttons->arr) b.buttons.push_back(x.text("name"));
  if (const Value *resources = logic->get("resources")) {
    for (const auto &x : resources->arr) {
      ResourceDef r;
      r.name = x.text("name");
      r.blocks = strings(x.get("blocks"));
      r.release = to_trigger(x.get("release"));
      r.approach_lock_ms = duration(x.text("approachLock"), r.name);
      b.resources.push_back(r);
    }
  }
  if (const Value *layers = logic->get("layers")) {
    for (const auto &x : layers->arr) {
      LayerDef layer;
      layer.name = x.text("name");
      if (const Value *rules = x.get("rules")) {
        for (const auto &r : rules->arr) {
          RuleDef rule;
          rule.trigger = to_trigger(r.get("trigger"));
          if (const Value *checks = r.get("checks"))
            for (const auto &c : checks->arr) rule.checks.push_back(to_cond(c));
          if (const Value *then = r.get("then")) {
            rule.then.mast = then->text("mast");
            rule.then.aspect = then->text("aspect");
            rule.then.reserve = then->text("reserve");
            rule.then.lock = strings(then->get("lock"));
          }
          const Value *cancel = r.get("cancel");
          if (const Value *when = cancel ? cancel->get("when") : nullptr) {
            rule.has_cancel = true;
            rule.cancel = to_cond(*when);
          }
          layer.rules.push_back(rule);
        }
      }
      b.layers.push_back(layer);
    }
  }
  return b;
}


bool board_from_json(const std::string &text, Board *out, std::string *error) {
  Value data;
  error->clear();
  if (!json::Parser(text).parse(&data, error)) return false;
  if (data.type != Value::OBJ) {
    *error = "the rule table is not a JSON object";
    return false;
  }
  g_error = error;
  *out = board_from_value(data);
  g_error = nullptr;
  return error->empty();
}

}  // namespace logic_core
