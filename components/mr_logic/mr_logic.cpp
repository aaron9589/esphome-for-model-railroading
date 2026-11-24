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
                                   std::function<void()> resync) {
  this->turnouts_.push_back(
      {name, std::move(position), std::move(lock), std::move(remote_locked), std::move(resync), "", -1});
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
  this->mqtt_setup_();
  ESP_LOGD(TAG, "Logic table: %u bytes of JSON compiled into about %u bytes", (unsigned) strlen(this->table_),
           (unsigned) t.bytes());
  this->boot_ms_ = millis();
}

// The start-up scan's field: everything as it reads now.
void MrLogicComponent::start_() {
  ::logic_core::Start start;
  start.logic_on = this->want_logic_();
#ifdef USE_MQTT
  this->broker_ = mqtt::global_mqtt_client != nullptr && mqtt::global_mqtt_client->is_connected();
#endif
  start.broker_connected = this->broker_;
  for (auto &s : this->sensors_) {
    s.expander_bad = s.expander != nullptr && (s.expander->is_failed() || s.expander->status_has_warning());
    const bool occupied = s.expander_bad || !s.sensor->has_state() || s.sensor->state;
    start.sensors_occupied[s.name] = occupied;
    s.fed = occupied ? 1 : 0;
  }
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
}

// --- the scan ----------------------------------------------------------------

void MrLogicComponent::loop() {
  if (!this->table_ok_) return;
  const uint32_t now = millis();
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
    Event e;
    e.kind = Event::BROKER;
    e.value = connected ? "connected" : "disconnected";
    this->event_(e);
    this->switch_published_ = false;
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
#endif
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
      case LogEvent::RESYNC:
        for (auto &t : this->turnouts_) {
          if (t.name != e.what || !t.resync) continue;
          ESP_LOGD(TAG, "%s: unlocked; matching its switch", e.what.c_str());
          t.resync();
        }
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
        this->mqtt_publish_(this->topic_("track/turnout/logic/" + this->board_ + "/" + p.resource + "/Release"), p.value);
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
  // Each Release turnout: THROWN presses it; the board answers CLOSED.
  const ::logic_core::Table &t = this->table_data_;
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

void MrLogicComponent::mqtt_publish_(const std::string &topic, const std::string &payload) {
#ifdef USE_MQTT
  if (mqtt::global_mqtt_client != nullptr && this->broker_) mqtt::global_mqtt_client->publish(topic, payload, 2, true);
#endif
}

void MrLogicComponent::dump_config() {
  ESP_LOGCONFIG(TAG, "Logic: %u sensors, %u masts, %u turnouts bound; %u rules in %u groups",
                (unsigned) this->sensors_.size(), (unsigned) this->masts_.size(), (unsigned) this->turnouts_.size(),
                (unsigned) this->table_data_.rules.size(), (unsigned) this->table_data_.layers.size());
  if (!this->board_.empty()) ESP_LOGCONFIG(TAG, "  Topics for board %s", this->board_.c_str());
  if (this->is_failed()) ESP_LOGCONFIG(TAG, "  The logic table could not be read.");
}

}  // namespace esphome::mr_logic
