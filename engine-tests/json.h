// A small JSON reader for the engine cases: enough for configurator/test/cases,
// so the tests need nothing outside this repo. Objects keep their key order.
#pragma once

#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace json {

struct Value {
  enum Type { NUL, BOOL, NUM, STR, ARR, OBJ };
  Type type = NUL;
  bool b = false;
  double num = 0;
  std::string str;
  std::vector<Value> arr;
  std::vector<std::pair<std::string, Value>> obj;

  const Value *get(const std::string &key) const {
    for (const auto &p : obj)
      if (p.first == key) return &p.second;
    return nullptr;
  }
  bool has(const std::string &key) const { return get(key) != nullptr; }
  std::string text(const std::string &key, const std::string &fallback = "") const {
    const Value *v = get(key);
    return v && v->type == STR ? v->str : fallback;
  }
};

class Parser {
 public:
  explicit Parser(const std::string &text) : s_(text) {}
  bool parse(Value *out, std::string *error) {
    if (!value(out)) {
      *error = "bad JSON near offset " + std::to_string(i_);
      return false;
    }
    space();
    return true;
  }

 private:
  const std::string &s_;
  size_t i_ = 0;

  void space() {
    while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\n' || s_[i_] == '\r' || s_[i_] == '\t')) i_++;
  }
  bool literal(const char *word) {
    size_t n = std::char_traits<char>::length(word);
    if (s_.compare(i_, n, word) != 0) return false;
    i_ += n;
    return true;
  }
  bool string(std::string *out) {
    if (s_[i_] != '"') return false;
    i_++;
    while (i_ < s_.size() && s_[i_] != '"') {
      char c = s_[i_++];
      if (c != '\\') {
        out->push_back(c);
        continue;
      }
      char e = s_[i_++];
      switch (e) {
        case 'n': out->push_back('\n'); break;
        case 't': out->push_back('\t'); break;
        case 'r': out->push_back('\r'); break;
        case 'b': out->push_back('\b'); break;
        case 'f': out->push_back('\f'); break;
        case 'u': {
          unsigned code = std::strtoul(s_.substr(i_, 4).c_str(), nullptr, 16);
          i_ += 4;
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
        default: out->push_back(e);
      }
    }
    if (i_ >= s_.size()) return false;
    i_++;
    return true;
  }
  bool value(Value *v) {
    space();
    if (i_ >= s_.size()) return false;
    char c = s_[i_];
    if (c == '{') {
      v->type = Value::OBJ;
      i_++;
      space();
      if (s_[i_] == '}') {
        i_++;
        return true;
      }
      while (true) {
        space();
        std::string k;
        if (!string(&k)) return false;
        space();
        if (s_[i_++] != ':') return false;
        Value inner;
        if (!value(&inner)) return false;
        v->obj.emplace_back(k, inner);
        space();
        if (s_[i_] == ',') {
          i_++;
          continue;
        }
        if (s_[i_] == '}') {
          i_++;
          return true;
        }
        return false;
      }
    }
    if (c == '[') {
      v->type = Value::ARR;
      i_++;
      space();
      if (s_[i_] == ']') {
        i_++;
        return true;
      }
      while (true) {
        Value inner;
        if (!value(&inner)) return false;
        v->arr.push_back(inner);
        space();
        if (s_[i_] == ',') {
          i_++;
          continue;
        }
        if (s_[i_] == ']') {
          i_++;
          return true;
        }
        return false;
      }
    }
    if (c == '"') {
      v->type = Value::STR;
      return string(&v->str);
    }
    if (literal("true")) {
      v->type = Value::BOOL;
      v->b = true;
      return true;
    }
    if (literal("false")) {
      v->type = Value::BOOL;
      return true;
    }
    if (literal("null")) return true;
    char *end = nullptr;
    v->num = std::strtod(s_.c_str() + i_, &end);
    if (end == s_.c_str() + i_) return false;
    v->type = Value::NUM;
    i_ = end - s_.c_str();
    return true;
  }
};

// Deep equality; object key order does not count.
inline bool equal(const Value &a, const Value &b) {
  if (a.type != b.type) return false;
  switch (a.type) {
    case Value::NUL: return true;
    case Value::BOOL: return a.b == b.b;
    case Value::NUM: return a.num == b.num;
    case Value::STR: return a.str == b.str;
    case Value::ARR:
      if (a.arr.size() != b.arr.size()) return false;
      for (size_t i = 0; i < a.arr.size(); i++)
        if (!equal(a.arr[i], b.arr[i])) return false;
      return true;
    case Value::OBJ:
      if (a.obj.size() != b.obj.size()) return false;
      for (const auto &p : a.obj) {
        const Value *other = b.get(p.first);
        if (!other || !equal(p.second, *other)) return false;
      }
      return true;
  }
  return false;
}

inline std::string dump(const Value &v) {
  switch (v.type) {
    case Value::NUL: return "null";
    case Value::BOOL: return v.b ? "true" : "false";
    case Value::NUM: return std::to_string(v.num);
    case Value::STR: {
      std::string out = "\"";
      for (char c : v.str) {
        if (c == '"' || c == '\\') out += '\\';
        if (c == '\n') {
          out += "\\n";
          continue;
        }
        out += c;
      }
      return out + "\"";
    }
    case Value::ARR: {
      std::string out = "[";
      for (size_t i = 0; i < v.arr.size(); i++) out += (i ? "," : "") + dump(v.arr[i]);
      return out + "]";
    }
    case Value::OBJ: {
      std::string out = "{";
      for (size_t i = 0; i < v.obj.size(); i++) out += (i ? "," : "") + ("\"" + v.obj[i].first + "\":") + dump(v.obj[i].second);
      return out + "}";
    }
  }
  return "";
}

inline Value str(const std::string &s) {
  Value v;
  v.type = Value::STR;
  v.str = s;
  return v;
}
inline Value boolean(bool b) {
  Value v;
  v.type = Value::BOOL;
  v.b = b;
  return v;
}
inline Value object(std::vector<std::pair<std::string, Value>> fields) {
  Value v;
  v.type = Value::OBJ;
  v.obj = std::move(fields);
  return v;
}

}  // namespace json
