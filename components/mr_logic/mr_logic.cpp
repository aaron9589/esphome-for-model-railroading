#include "mr_logic.h"

#include <cstring>

#include "esphome/core/defines.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"

#ifdef USE_MQTT
#include "esphome/components/mqtt/mqtt_client.h"
#endif

namespace esphome::mr_logic {

static const char *const TAG = "logic";
using ::logic_core::Event;
using ::logic_core::LogEvent;
using ::logic_core::Publish;

static constexpr uint32_t SCAN_MS = ::logic_core::Engine::SCAN_MS;
// Detectors have settled once every bound sensor has a state; a sensor still
// without one after this long counts as occupied at the start-up scan.
static constexpr uint32_t SETTLE_LIMIT_MS = 3000;

namespace {
// Remote Online and /State topics carry ACTIVE or INACTIVE (spec, What each board publishes).
int8_t active(text_sensor::TextSensor *ts) {
  if (ts == nullptr || !ts->has_state()) return -1;
  const std::string &v = ts->get_state();
  return v == "ACTIVE" ? 1 : v == "INACTIVE" ? 0 : -1;
}
// A link as typed: without spaces round it.
std::string trim_(const std::string &value) {
  const size_t from = value.find_first_not_of(" \t"), to = value.find_last_not_of(" \t");
  return from == std::string::npos ? "" : value.substr(from, to - from + 1);
}
Event remote_item(const std::string &board, const std::string &kind, const std::string &name, const std::string &value) {
  Event e;
  e.kind = Event::REMOTE_ITEM;
  e.board = board;
  e.item_kind = kind;
  e.name = name;
  e.value = value;
  return e;
}
}  // namespace

// --- bindings (from codegen, before setup) -----------------------------------

void MrLogicComponent::add_sensor(const std::string &name, binary_sensor::BinarySensor *sensor, Component *expander) {
  this->sensors_.push_back({name, sensor, expander, -1, false});
  const size_t index = this->sensors_.size() - 1;
  // Inputs are recorded as they arrive, so a pulse between scans is not lost.
  sensor->add_on_state_callback([this, index](bool occupied) {
    SensorBinding &s = this->sensors_[index];
    // A reading from a hub that has just failed is not trusted, even before the next scan notices.
    if (s.expander != nullptr && (s.expander->is_failed() || s.expander->status_has_warning())) return;
    this->feed_sensor_(s, occupied);
  });
}

void MrLogicComponent::add_mast(const std::string &name, std::function<void(int)> set, text_sensor::TextSensor *jmri) {
  this->masts_.push_back({name, std::move(set), {}, -2, ""});
  if (jmri == nullptr) return;
  this->jmri_topics_.emplace_back(name, jmri);
  jmri->add_on_state_callback([this, name](const std::string &message) {
    if (!this->engine_) return;
    Event e;
    e.kind = Event::JMRI;
    e.name = name;
    e.value = message;
    this->event_(e);
    // With logic off, or on a mast no rule sets, there is no scan to wait for:
    // the message shows at once, as today. With logic on, a field-controlled
    // mast's shows() is unchanged, so this does nothing.
    for (auto &m : this->masts_)
      if (m.name == name) this->show_(m, this->engine_->shows(name));
  });
}

void MrLogicComponent::add_turnout(const std::string &name, std::function<const char *()> position,
                                   std::function<void(bool)> lock, std::function<bool()> remote_locked,
                                   std::function<void()> resync, std::function<void(bool)> panel) {
  this->turnouts_.push_back(
      {name, std::move(position), std::move(lock), std::move(remote_locked), std::move(resync), "", -1, std::move(panel)});
}

void MrLogicComponent::add_remote_board(const std::string &board, text_sensor::TextSensor *online) {
  this->remote_boards_.push_back({board, online});
  online->add_on_state_callback([this, board, online](const std::string &) {
    if (!this->engine_) return;
    Event e;
    e.kind = Event::REMOTE_ONLINE;
    e.board = board;
    e.flag = active(online) == 1;
    this->event_(e);
  });
}

void MrLogicComponent::add_remote_sensor(const std::string &board, const std::string &name, bool block,
                                         text_sensor::TextSensor *state) {
  this->remote_sensors_.push_back({board, name, block, state});
  state->add_on_state_callback([this, board, name, block, state](const std::string &) {
    if (!this->engine_) return;
    int8_t v = active(state);
    this->event_(remote_item(board, block ? "block" : "sensor", name, v == 1 ? "occupied" : v == 0 ? "clear" : "unknown"));
  });
}

void MrLogicComponent::add_remote_turnout(const std::string &board, const std::string &name,
                                          text_sensor::TextSensor *thrown, text_sensor::TextSensor *moving) {
  this->remote_turnouts_.push_back({board, name, thrown, moving});
  const size_t index = this->remote_turnouts_.size() - 1;
  auto update = [this, index](const std::string &) {
    if (this->engine_) this->remote_turnout_(this->remote_turnouts_[index]);
  };
  thrown->add_on_state_callback(update);
  moving->add_on_state_callback(update);
}

// A remote turnout is in a position only when both its /Thrown and /Moving are known.
void MrLogicComponent::remote_turnout_(const RemoteTurnout &t) {
  int8_t thrown = active(t.thrown), moving = active(t.moving);
  const char *value = (thrown < 0 || moving < 0) ? "unknown" : moving ? "moving" : thrown ? "thrown" : "closed";
  this->event_(remote_item(t.board, "turnout", t.name, value));
}

void MrLogicComponent::add_remote_mast(const std::string &board, const std::string &name,
                                       text_sensor::TextSensor *state) {
  this->remote_masts_.push_back({board, name, state});
  state->add_on_state_callback([this, board, name](const std::string &aspect) {
    if (!this->engine_) return;
    Event e;
    e.kind = Event::REMOTE_MAST;
    e.board = board;
    e.name = name;
    e.value = aspect;
    this->event_(e);
  });
}

// --- plant ends (spec, Plant ends) --------------------------------------------
//
// Every change of an end's link goes through its Link text entity, which saves
// it across reboots: the page, the Link topic and a pairing all set the text,
// and its state callback tells the engine. The subscriptions follow the link:
// the linked board's Online, the linked end's Link, and its Block and Mast for
// each of this end's tracks. They are exact topics, and are dropped (the
// client's unsubscribe) when the link moves on. The MQTT client walks its
// subscriptions while it calls them, so a callback only records what it hears
// and loop() changes subscriptions.

void MrLogicComponent::add_end(const std::string &name, text::Text *link, switch_::Switch *led,
                               text_sensor::TextSensor *state) {
  EndBinding b;
  b.name = name;
  b.link = link;
  b.led = led;
  b.state = state;
  this->ends_.push_back(std::move(b));
  const size_t index = this->ends_.size() - 1;
  link->add_on_state_callback([this, index](const std::string &value) {
    if (this->engine_) this->end_link_changed_(this->ends_[index], value);
  });
}

MrLogicComponent::EndBinding *MrLogicComponent::find_end_(const std::string &name) {
  for (auto &b : this->ends_)
    if (b.name == name) return &b;
  return nullptr;
}

void MrLogicComponent::pair(const std::string &end) {
  EndBinding *b = this->find_end_(end);
  if (!this->engine_ || b == nullptr) return;
  Event e;
  e.kind = Event::END_PAIR;
  e.name = end;
  e.value = "pressed";
  this->event_(e);
  b->note.clear();
  b->refused_until = 0;
  ESP_LOGI(TAG, "End %s: pairing for 30 s; press Pair on the end it meets", end.c_str());
  this->ends_refresh_ = true;
}

// A link changed, from any source: the engine learns it, and the end listens
// to the new neighbour.
void MrLogicComponent::end_link_changed_(EndBinding &b, const std::string &value) {
  const std::string link = trim_(value);
  Event e;
  e.kind = Event::END_LINK;
  e.name = b.name;
  e.value = link;
  this->event_(e);
  if (link != b.linked) {
    this->end_unlisten_(b);
    b.linked = link;
    b.note.clear();
    this->end_listen_(b);
    ESP_LOGI(TAG, "End %s: link is %s", b.name.c_str(), link.empty() ? "empty" : link.c_str());
  }
  this->ends_refresh_ = true;
}

// Set the link through its text entity, so it is saved and shown.
void MrLogicComponent::end_set_link_(EndBinding &b, const std::string &link) {
  if (b.link->state == link) return;
  b.link->make_call().set_value(link).perform();
}

void MrLogicComponent::end_listen_(EndBinding &b) {
#ifdef USE_MQTT
  if (mqtt::global_mqtt_client == nullptr || this->board_.empty()) return;
  const std::string &link = b.linked;
  const size_t at = link.rfind('/');
  if (at == std::string::npos || at == 0 || at == link.size() - 1 || link == this->board_ + "/" + b.name) return;
  const std::string board = link.substr(0, at), end = link.substr(at + 1);
  uint16_t tracks = 0;
  const ::logic_core::Table &t = this->table_data_;
  for (const auto &def : t.ends)
    if (t.names.equals(def.name, b.name)) tracks = def.tracks_count;
  b.listens.push_back({this->topic_("track/sensor/board/" + board + "/Online"), Event::END_ONLINE, 0});
  b.listens.push_back({this->end_topic_(board, end, "/Link"), Event::END_THEIR_LINK, 0});
  for (uint16_t j = 1; j <= tracks; j++) {
    b.listens.push_back({this->end_topic_(board, end, "/" + std::to_string(j) + "/Block"), Event::END_BLOCK, j});
    b.listens.push_back({this->end_topic_(board, end, "/" + std::to_string(j) + "/Mast"), Event::END_MAST, j});
  }
  for (const auto &l : b.listens) {
    TopicUse &use = this->end_topics_[l.topic];
    if (use.count++ == 0)
      mqtt::global_mqtt_client->subscribe(
          l.topic, [this](const std::string &topic, const std::string &payload) { this->end_heard_(topic, payload); }, 1);
    // Another end may already hold this topic: its retained message will not come again.
    if (use.has) this->end_dispatch_(b, l, use.payload);
  }
#endif
}

void MrLogicComponent::end_unlisten_(EndBinding &b) {
#ifdef USE_MQTT
  for (const auto &l : b.listens) {
    auto it = this->end_topics_.find(l.topic);
    if (it == this->end_topics_.end() || --it->second.count > 0) continue;
    this->end_topics_.erase(it);
    if (mqtt::global_mqtt_client != nullptr) mqtt::global_mqtt_client->unsubscribe(l.topic);
  }
#endif
  b.listens.clear();
}

// A message on a topic an end listens to: keep it, and tell every end that wants it.
void MrLogicComponent::end_heard_(const std::string &topic, const std::string &payload) {
  auto it = this->end_topics_.find(topic);
  if (it == this->end_topics_.end()) return;
  it->second.has = true;
  it->second.payload = payload;
  if (!this->engine_) return;
  for (auto &b : this->ends_)
    for (const auto &l : b.listens)
      if (l.topic == topic) this->end_dispatch_(b, l, payload);
}

void MrLogicComponent::end_dispatch_(EndBinding &b, const Listen &l, const std::string &payload) {
  if (!this->engine_) return;
  Event e;
  e.kind = static_cast<Event::Kind>(l.kind);
  e.name = b.name;
  e.track = l.track;
  switch (e.kind) {
    case Event::END_ONLINE: e.flag = payload == "ACTIVE"; break;
    case Event::END_THEIR_LINK: e.value = payload; break;
    // Anything but ACTIVE or INACTIVE is not known, so it reads occupied.
    case Event::END_BLOCK: e.value = payload == "ACTIVE" ? "occupied" : payload == "INACTIVE" ? "clear" : "unknown"; break;
    default: e.value = payload; break;
  }
  this->event_(e);
}

// Each end's state in words, and the pattern its LED shows. Worked out about
// once a second, and at once after a press or a link change.
void MrLogicComponent::ends_refresh_state_() {
  const ::logic_core::State s = this->engine_->state();
  const uint32_t now = millis();
  for (auto &b : this->ends_) {
    std::string kind = "empty";
    for (const auto &x : s.ends)
      if (x.first == b.name) kind = x.second;
    std::string text;
    if (kind == "pairing") {
      text = "Pairing: press Pair on the end it meets, within 30 seconds";
      b.mode = 1;
    } else if (kind == "empty") {
      text = "Not paired";
      b.mode = 0;
    } else if (kind == "end") {
      text = "End of the line";
      b.mode = 2;
    } else if (kind == "heard") {
      text = "Paired with " + b.linked + ", heard";
      b.mode = 2;
    } else if (kind == "disagrees") {
      text = "Paired with " + b.linked + ", but that end does not name this one, so it reads as empty";
      b.mode = 3;
    } else {
      text = "Paired with " + b.linked + ", not heard";
      b.mode = 3;
    }
    if (!b.note.empty()) text += ". Last pairing: " + b.note;
    // A refused pairing also shows on the LED for a few seconds.
    if (b.refused_until != 0 && b.mode != 1 && static_cast<int32_t>(b.refused_until - now) > 0) b.mode = 3;
    if (b.state != nullptr && text != b.shown) {
      b.shown = text;
      b.state->publish_state(text);
    }
  }
}

// LED: off = not paired; slow blink = pairing; steady = paired and heard (or
// the end of the line); fast blink = a problem (not heard, disagreeing, or a
// pairing refused in the last 10 s).
void MrLogicComponent::ends_led_() {
  const uint32_t now = millis();
  for (auto &b : this->ends_) {
    if (b.led == nullptr) continue;
    bool on = false;
    switch (b.mode) {
      case 1: on = (now / 500) % 2 == 0; break;
      case 2: on = true; break;
      case 3: on = (now / 125) % 2 == 0; break;
      default: break;
    }
    if (on == b.led_on) continue;
    b.led_on = on;
    if (on)
      b.led->turn_on();
    else
      b.led->turn_off();
  }
}

// --- rule buttons, the Auto/Manual switch and a route's Release ---------------

void MrLogicComponent::add_button(const std::string &name, binary_sensor::BinarySensor *sensor) {
  if (sensor == nullptr) return;
  // Recorded as it arrives, so a press between scans is not lost.
  sensor->add_on_state_callback([this, name](bool pressed) { this->button_(name, pressed); });
}

void MrLogicComponent::add_switch(const std::string &name, binary_sensor::BinarySensor *sensor) {
  if (sensor == nullptr) return;
  this->switches_.push_back({name, sensor});
  // Recorded as it arrives; its value at the start-up scan is in the start.
  sensor->add_on_state_callback([this, name](bool on) {
    if (!this->engine_) return;
    Event e;
    e.kind = Event::SWITCH;
    e.name = name;
    e.value = on ? "on" : "off";
    this->event_(e);
  });
}

void MrLogicComponent::add_lamp(const std::string &name, switch_::Switch *output) {
  if (output == nullptr) return;
  this->lamps_.push_back({name, output, "off"});
}

void MrLogicComponent::press(const std::string &button) {
  this->button_(button, true);
  this->button_(button, false);
}

void MrLogicComponent::button_(const std::string &name, bool pressed) {
  if (!this->engine_) return;
  Event e;
  e.kind = Event::BUTTON;
  e.name = name;
  e.value = pressed ? "pressed" : "released";
  this->event_(e);
}

void MrLogicComponent::release_group(const std::string &group) {
  if (!this->engine_) return;
  Event e;
  e.kind = Event::RELEASE_GROUP;
  e.name = group;
  e.value = "button";
  this->event_(e);
}

void MrLogicComponent::release(const std::string &resource) {
  if (!this->engine_) return;
  Event e;
  e.kind = Event::RELEASE;
  e.name = resource;
  e.value = "button";
  this->event_(e);
}

void MrLogicComponent::event_(const Event &e) { this->engine_->event(e); }

void MrLogicComponent::feed_sensor_(SensorBinding &s, bool occupied) {
  if (!this->engine_ || s.fed == (occupied ? 1 : 0)) return;
  s.fed = occupied ? 1 : 0;
  Event e;
  e.kind = Event::SENSOR;
  e.name = s.name;
  e.value = occupied ? "occupied" : "clear";
  this->event_(e);
}

// --- set-up and the start-up scan --------------------------------------------

void MrLogicComponent::setup() {
  std::string error;
  this->table_ok_ = ::logic_core::compile_table(this->table_, &this->table_data_, &error);
  if (!this->table_ok_) {
    ESP_LOGE(TAG, "The logic table cannot be read: %s. Logic stays off; download the YAML again.", error.c_str());
    this->mark_failed();
    return;
  }
  const ::logic_core::Table &t = this->table_data_;
  for (auto &m : this->masts_) {
    for (const auto &def : t.masts) {
      if (!t.names.equals(def.name, m.name)) continue;
      if (def.stop >= 0) m.stop = def.stop;  // a mast with no aspects keeps -2, dark
      for (uint16_t a = 0; a < def.aspect_count; a++) m.aspects.push_back(t.names[t.aspects[def.aspect_first + a].name]);
    }
    if (m.aspects.empty()) ESP_LOGW(TAG, "Mast %s is bound but not in the logic table; logic will not set it.", m.name.c_str());
  }
  if (this->switch_ != nullptr) {
    this->switch_->add_on_state_callback([this](bool on) {
      if (!this->engine_) return;
      Event e;
      e.kind = Event::LOGIC;
      e.value = on ? "on" : "off";
      this->event_(e);
      this->switch_published_ = false;  // echo the new state on the light topic
    });
  }
  if (this->auto_switch_ != nullptr) {
    this->auto_switch_->add_on_state_callback([this](bool on) {
      if (!this->engine_) return;
      Event e;
      e.kind = Event::AUTO;
      e.value = on ? "on" : "off";
      this->event_(e);
      ESP_LOGI(TAG, "Routes are asked for in %s", on ? "Auto" : "Manual");
      this->auto_published_ = false;  // echo the new state on its light topic
    });
  }
  this->mqtt_setup_();
  ESP_LOGD(TAG, "Logic table: %u bytes of JSON compiled into about %u bytes", (unsigned) strlen(this->table_),
           (unsigned) t.bytes());
  this->boot_ms_ = millis();
}

// The start-up scan's field: everything as it reads now.
void MrLogicComponent::start_() {
  ::logic_core::Start start;
  start.board = this->board_;  // plant ends' links and pairing name it
  start.logic_on = this->want_logic_();
  start.auto_on = this->auto_switch_ == nullptr || this->auto_switch_->state;
#ifdef USE_MQTT
  this->broker_ = mqtt::global_mqtt_client != nullptr && mqtt::global_mqtt_client->is_connected();
#endif
  start.broker_connected = this->broker_;
  for (const auto &b : this->ends_) start.links.emplace_back(b.name, trim_(b.link->state));  // the saved link
  for (auto &s : this->sensors_) {
    s.expander_bad = s.expander != nullptr && (s.expander->is_failed() || s.expander->status_has_warning());
    const bool occupied = s.expander_bad || !s.sensor->has_state() || s.sensor->state;
    start.sensors_occupied[s.name] = occupied;
    s.fed = occupied ? 1 : 0;
  }
  for (const auto &w : this->switches_) start.switches[w.name] = w.sensor->has_state() && w.sensor->state;
  // Every reading, moving included: a servo can still be on its boot move.
  for (auto &t : this->turnouts_) {
    t.last = t.position();
    start.turnouts[t.name] = t.last;
    if (t.remote_locked) {
      t.last_remote = t.remote_locked() ? 1 : 0;
      start.remote_locks[t.name] = t.last_remote == 1;
    }
  }
  for (const auto &j : this->jmri_topics_)
    if (j.second->has_state()) start.jmri.emplace_back(j.first, j.second->get_state());
  for (const auto &b : this->remote_boards_) {
    ::logic_core::RemoteStart r;
    r.board = b.board;
    int8_t online = active(b.online);
    if (online >= 0)
      r.online = online;
    else if (b.online->has_state())
      r.online = 0;
    for (const auto &s : this->remote_sensors_) {
      int8_t v = active(s.state);
      if (s.board == b.board && v >= 0) r.sensors[s.name] = v ? "occupied" : "clear";
    }
    for (const auto &m : this->remote_masts_)
      if (m.board == b.board && m.state->has_state() && !m.state->get_state().empty())
        r.masts[m.name] = m.state->get_state();
    start.remote.push_back(r);
  }
  this->engine_.reset(new ::logic_core::Engine(this->table_data_, start));
  for (const auto &t : this->remote_turnouts_) this->remote_turnout_(t);
  ESP_LOGI(TAG, "Start-up scan, %u ms after boot; the engine holds about %u bytes", (unsigned) (millis() - this->boot_ms_),
           (unsigned) this->engine_->bytes());
  // From power-on a field-controlled mast shows its stop aspect with logic on,
  // and its startup aspect (or JMRI's last) with logic off.
  for (auto &m : this->masts_) this->show_(m, this->engine_->shows(m.name));
  for (auto &b : this->ends_) {
    b.linked = trim_(b.link->state);
    this->end_listen_(b);
  }
  this->ends_refresh_ = true;
}

// --- the scan ----------------------------------------------------------------

void MrLogicComponent::loop() {
  if (!this->table_ok_) return;
  const uint32_t now = millis();
  // Flashing lamps: on and off every half second, together.
  if (!this->lamps_.empty() && now - this->flash_ms_ >= 500) {
    this->flash_ms_ = now;
    this->flash_on_ = !this->flash_on_;
    for (auto &l : this->lamps_) {
      if (l.light != "flash") continue;
      if (this->flash_on_)
        l.output->turn_on();
      else
        l.output->turn_off();
    }
  }
  if (!this->ends_.empty()) {
    // A link heard on its Link topic is applied here, not in the MQTT callback,
    // which may not change subscriptions.
    for (auto &b : this->ends_) {
      if (!b.pending) continue;
      b.pending = false;
      this->end_set_link_(b, b.pending_link);
    }
    this->ends_led_();
  }
  if (!this->engine_) {
    bool settled = true;
    for (const auto &s : this->sensors_) settled = settled && s.sensor->has_state();
    if (!settled && now - this->boot_ms_ < SETTLE_LIMIT_MS) return;
    this->start_();
    this->last_scan_ms_ = now;
  } else if (now - this->last_scan_ms_ < SCAN_MS) {
    return;
  } else {
    // A late loop runs one scan, not a burst to catch up.
    this->last_scan_ms_ = now - ((now - this->last_scan_ms_) % SCAN_MS);
  }
  this->scan_();
}

void MrLogicComponent::scan_() {
#ifdef USE_MQTT
  const bool connected = mqtt::global_mqtt_client != nullptr && mqtt::global_mqtt_client->is_connected();
  if (connected != this->broker_) {
    this->broker_ = connected;
    for (auto &b : this->ends_) b.link_sent = false;
    this->ends_refresh_ = true;
    Event e;
    e.kind = Event::BROKER;
    e.value = connected ? "connected" : "disconnected";
    this->event_(e);
    this->switch_published_ = false;
    this->auto_published_ = false;
  }
#endif
  for (auto &s : this->sensors_) {
    if (s.expander == nullptr) continue;
    const bool bad = s.expander->is_failed() || s.expander->status_has_warning();
    if (bad == s.expander_bad) continue;
    s.expander_bad = bad;
    if (bad)
      ESP_LOGE(TAG, "%s: its expander is not answering; it reads occupied until it does.", s.name.c_str());
    else
      ESP_LOGI(TAG, "%s: its expander answers again.", s.name.c_str());
    this->feed_sensor_(s, bad || !s.sensor->has_state() || s.sensor->state);
  }
  // Turnouts and the remote lock are read once per scan: a throw takes seconds.
  for (auto &t : this->turnouts_) {
    std::string position = t.position();
    if (position != t.last) {
      t.last = position;
      Event e;
      e.kind = Event::TURNOUT;
      e.name = t.name;
      e.value = position;
      this->event_(e);
    }
    if (t.remote_locked) {
      int8_t locked = t.remote_locked() ? 1 : 0;
      if (locked != t.last_remote) {
        t.last_remote = locked;
        Event e;
        e.kind = Event::REMOTE_LOCK;
        e.name = t.name;
        e.value = locked ? "locked" : "unlocked";
        this->event_(e);
      }
    }
  }
  const uint32_t started = micros();
  ::logic_core::ScanOut out = this->engine_->scan();
  const uint32_t took = micros() - started;
  this->apply_(out);
#ifdef USE_MQTT
  // After the scan, so the switch's new state is what goes out. Retained, so
  // JMRI shows the real state after a reboot or a change here.
  if (this->broker_ && !this->switch_published_ && !this->board_.empty()) {
    this->light_published_ = this->engine_->logic_on() ? "ON" : "OFF";
    this->mqtt_publish_(this->topic_("track/light/logic/" + this->board_), this->light_published_);
    if (!this->version_.empty())
      this->mqtt_publish_(this->topic_("track/logic/" + this->board_ + "/Version"), this->version_);
    this->switch_published_ = true;
  }
  if (this->broker_ && this->auto_switch_ != nullptr && !this->auto_published_ && !this->board_.empty()) {
    this->auto_light_published_ = this->auto_switch_->state ? "ON" : "OFF";
    this->mqtt_publish_(this->topic_("track/light/auto/" + this->board_), this->auto_light_published_);
    this->auto_published_ = true;
  }
#endif
  if (!this->ends_.empty() && (this->ends_refresh_ || this->scans_ % 10 == 0)) {
    this->ends_refresh_ = false;
    this->ends_refresh_state_();
  }
  this->scans_++;
  if (took > this->slowest_us_) {
    this->slowest_us_ = took;
    ESP_LOGD(TAG, "Slowest scan so far: %u us", (unsigned) took);
  }
  if (took > SCAN_MS * 1000)
    ESP_LOGW(TAG, "A scan took %u ms, longer than the %u ms cycle", (unsigned) (took / 1000), (unsigned) SCAN_MS);
}

void MrLogicComponent::show_(MastBinding &m, const std::string &aspect) {
  if (aspect.empty() || aspect == m.shown) return;
  int index = -3;
  if (aspect == "dark") index = -2;  // the show script's every-lamp-off branch
  for (size_t i = 0; i < m.aspects.size(); i++)
    if (m.aspects[i] == aspect) index = static_cast<int>(i);
  if (index == -3) {
    // Fail safe: an aspect this mast does not have shows its stop aspect.
    ESP_LOGW(TAG, "Mast %s has no aspect %s; showing its stop aspect.", m.name.c_str(), aspect.c_str());
    index = m.stop;
  }
  m.shown = aspect;
  m.set(index);
}

void MrLogicComponent::apply_(const ::logic_core::ScanOut &out) {
  for (const auto &w : out.writes) {
    if (w.lock) {
      for (auto &t : this->turnouts_)
        if (t.name == w.name) t.lock(w.on);
      continue;
    }
    if (w.panel) {
      for (auto &t : this->turnouts_)
        if (t.name == w.name && t.panel) t.panel(w.on);
      continue;
    }
    if (w.lamp) {
      for (auto &l : this->lamps_) {
        if (l.name != w.name) continue;
        l.light = w.aspect;
        if (l.light == "on" || (l.light == "flash" && this->flash_on_))
          l.output->turn_on();
        else
          l.output->turn_off();
      }
      continue;
    }
    for (auto &m : this->masts_)
      if (m.name == w.name) this->show_(m, w.aspect);
  }
  for (const auto &e : out.events) {
    switch (e.kind) {
      case LogEvent::STARTUP: ESP_LOGI(TAG, "Start-up scan done"); break;
      case LogEvent::GRANT: ESP_LOGI(TAG, "%s: granted to %s", e.what.c_str(), e.rule.c_str()); break;
      case LogEvent::CANCEL: ESP_LOGI(TAG, "%s: %s cancelled", e.what.c_str(), e.rule.c_str()); break;
      case LogEvent::PASS:
        ESP_LOGI(TAG, "%s: passed%s%s", e.what.c_str(), e.rule.empty() ? " (occupied at start-up)" : " by ", e.rule.c_str());
        break;
      case LogEvent::RELEASE:
        if (e.by == "manual")
          ESP_LOGW(TAG, "%s: released by hand", e.what.c_str());
        else
          ESP_LOGI(TAG, "%s: released (%s)", e.what.c_str(), e.by.c_str());
        break;
      case LogEvent::IGNORED: ESP_LOGW(TAG, "%s: a release waiting on the broker was ignored", e.what.c_str()); break;
      case LogEvent::RELEASE_GROUP: ESP_LOGW(TAG, "%s: route released by hand", e.what.c_str()); break;
      case LogEvent::RESYNC:
        for (auto &t : this->turnouts_) {
          if (t.name != e.what || !t.resync) continue;
          ESP_LOGD(TAG, "%s: unlocked; matching its switch", e.what.c_str());
          t.resync();
        }
        break;
      // Plant ends.
      case LogEvent::PAIRING: {
        EndBinding *b = this->find_end_(e.what);
        if (e.by == "paired") {
          ESP_LOGI(TAG, "End %s: paired with %s", e.what.c_str(), e.rule.c_str());
          // The engine has set its link; the Link entity saves and shows it.
          if (b != nullptr) this->end_set_link_(*b, e.rule);
        } else {
          ESP_LOGW(TAG, "End %s: not paired (%s); press Pair again", e.what.c_str(), e.by.c_str());
          if (b != nullptr) {
            b->note = e.by == "alone"     ? "no other end pressed Pair in time"
                      : e.by == "crowded" ? "more than two ends were pairing, so none paired"
                                          : "the two ends have different numbers of tracks";
            // Refused: fast blink on the LED for 10 s.
            b->refused_until = millis() + 10000;
          }
        }
        this->ends_refresh_ = true;
        break;
      }
      case LogEvent::DISAGREES:
        ESP_LOGW(TAG, "End %s: %s names %s, not this end; reading it as empty", e.what.c_str(), e.rule.c_str(),
                 e.by.c_str());
        this->ends_refresh_ = true;
        break;
    }
  }
  if (this->board_.empty()) return;
  for (const auto &p : out.publishes) {
    switch (p.kind) {
      case Publish::HELD:
        this->mqtt_publish_(this->topic_("track/sensor/logic/" + this->board_ + "/" + p.resource + "/Held"), p.value);
        break;
      case Publish::STATE:
        this->mqtt_publish_(this->topic_("track/logic/" + this->board_ + "/" + p.resource + "/State"), p.value);
        break;
      case Publish::RELEASE:
      case Publish::RELEASE_GROUP:
        this->mqtt_publish_(this->topic_("track/turnout/logic/" + this->board_ + "/" + p.resource + "/Release"), p.value);
        break;
      // Plant ends: what each end offers its neighbour, and its link, all
      // retained. The pairing announcement is not.
      case Publish::PAIRING:
        this->mqtt_publish_(this->topic_("track/end/pairing"), p.value, false);
        break;
      case Publish::END_LINK:
        this->mqtt_publish_(this->end_topic_(this->board_, p.resource, "/Link"), p.value);
        if (EndBinding *b = this->find_end_(p.resource)) b->link_sent = true;
        break;
      case Publish::END_BLOCK:
        this->mqtt_publish_(this->end_topic_(this->board_, p.resource, "/" + std::to_string(p.track) + "/Block"), p.value);
        break;
      case Publish::END_MAST:
        this->mqtt_publish_(this->end_topic_(this->board_, p.resource, "/" + std::to_string(p.track) + "/Mast"), p.value);
        break;
    }
  }
}

// --- MQTT: the switch's light, the Release turnouts, and the publishes --------

void MrLogicComponent::mqtt_setup_() {
#ifdef USE_MQTT
  if (mqtt::global_mqtt_client == nullptr || this->board_.empty()) return;
  // The JMRI light: ON / OFF switch logic; the board's own echo changes nothing.
  mqtt::global_mqtt_client->subscribe(
      this->topic_("track/light/logic/" + this->board_),
      [this](const std::string &, const std::string &payload) {
        if (this->switch_ == nullptr) return;
        // After a (re)connect the broker hands back the last retained state,
        // which may be older than a change made here meanwhile: wait until
        // this board has published its own. Its own echo changes nothing.
        if (!this->switch_published_ || payload == this->light_published_) return;
        if (payload == "ON" && !this->switch_->state) this->switch_->turn_on();
        if (payload == "OFF" && this->switch_->state) this->switch_->turn_off();
      },
      1);
  // Plant ends: the pairing announcements, and each end's own retained Link,
  // which takes a new value as the logic switch does. The neighbour's topics
  // follow each end's link (end_listen_).
  if (!this->ends_.empty()) {
    mqtt::global_mqtt_client->subscribe(
        this->topic_("track/end/pairing"),
        [this](const std::string &, const std::string &payload) {
          if (!this->engine_) return;
          Event e;
          e.kind = Event::PAIRING;
          e.value = payload;
          this->event_(e);
        },
        1);
    for (size_t index = 0; index < this->ends_.size(); index++) {
      mqtt::global_mqtt_client->subscribe(
          this->end_topic_(this->board_, this->ends_[index].name, "/Link"),
          [this, index](const std::string &, const std::string &payload) {
            EndBinding &end = this->ends_[index];
            // After a (re)connect the broker hands back the last retained
            // Link, which may be older than a change made here meanwhile: wait
            // until this board has published its own. Its own echo changes nothing.
            if (!end.link_sent) return;
            const std::string link = trim_(payload);
            if (link == end.linked) return;
            end.pending = true;
            end.pending_link = link;
          },
          1);
    }
  }
  // The Auto/Manual switch's JMRI light: ON is Auto, as the logic switch's.
  if (this->auto_switch_ != nullptr) {
    mqtt::global_mqtt_client->subscribe(
        this->topic_("track/light/auto/" + this->board_),
        [this](const std::string &, const std::string &payload) {
          if (!this->auto_published_ || payload == this->auto_light_published_) return;
          if (payload == "ON" && !this->auto_switch_->state) this->auto_switch_->turn_on();
          if (payload == "OFF" && this->auto_switch_->state) this->auto_switch_->turn_off();
        },
        1);
  }
  // Each Release turnout: THROWN presses it; the board answers CLOSED.
  const ::logic_core::Table &t = this->table_data_;
  // A route's: its routes group's.
  for (size_t l = 0; l < t.layers.size(); l++) {
    if (!t.layer_routes[l]) continue;
    const std::string name = t.names[t.layers[l]];
    mqtt::global_mqtt_client->subscribe(
        this->topic_("track/turnout/logic/" + this->board_ + "/" + name + "/Release"),
        [this, name](const std::string &, const std::string &payload) {
          if (payload != "THROWN" || !this->engine_) return;
          Event e;
          e.kind = Event::RELEASE_GROUP;
          e.name = name;
          e.value = "mqtt";
          this->event_(e);
        },
        1);
  }
  for (const auto &res : t.resources) {
    const std::string name = t.names[res.name];
    mqtt::global_mqtt_client->subscribe(
        this->topic_("track/turnout/logic/" + this->board_ + "/" + name + "/Release"),
        [this, name](const std::string &, const std::string &payload) {
          if (payload != "THROWN" || !this->engine_) return;
          Event e;
          e.kind = Event::RELEASE;
          e.name = name;
          e.value = "mqtt";
          this->event_(e);
        },
        1);
  }
#endif
}

void MrLogicComponent::mqtt_publish_(const std::string &topic, const std::string &payload, bool retain) {
#ifdef USE_MQTT
  if (mqtt::global_mqtt_client != nullptr && this->broker_) mqtt::global_mqtt_client->publish(topic, payload, 2, retain);
#endif
}

void MrLogicComponent::dump_config() {
  ESP_LOGCONFIG(TAG, "Logic: %u sensors, %u masts, %u turnouts bound; %u rules in %u groups",
                (unsigned) this->sensors_.size(), (unsigned) this->masts_.size(), (unsigned) this->turnouts_.size(),
                (unsigned) this->table_data_.rules.size(), (unsigned) this->table_data_.layers.size());
  if (!this->version_.empty()) ESP_LOGCONFIG(TAG, "  Logic version %s", this->version_.c_str());
  if (!this->board_.empty()) ESP_LOGCONFIG(TAG, "  Topics for board %s", this->board_.c_str());
  for (const auto &b : this->ends_) ESP_LOGCONFIG(TAG, "  Plant end %s%s", b.name.c_str(), b.led != nullptr ? ", with an LED" : "");
  if (this->is_failed()) ESP_LOGCONFIG(TAG, "  The logic table could not be read.");
}

}  // namespace esphome::mr_logic
