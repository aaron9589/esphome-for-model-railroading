#include "mr_logic.h"

#include <cstring>

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

#include "logic_table.h"

namespace esphome::mr_logic {

static const char *const TAG = "logic";
static constexpr uint32_t SCAN_MS = ::logic_core::Engine::SCAN_MS;
// Detectors have settled once every bound sensor has a state; a sensor still
// without one after this long counts as occupied at the start-up scan.
static constexpr uint32_t SETTLE_LIMIT_MS = 3000;

void MrLogicComponent::add_sensor(const std::string &name, binary_sensor::BinarySensor *sensor) {
  this->sensors_.push_back({name, sensor});
  // Inputs are recorded as they arrive, so a pulse between scans is not lost.
  sensor->add_on_state_callback([this, name](bool occupied) {
    if (!this->engine_) return;
    ::logic_core::Event e;
    e.kind = ::logic_core::Event::SENSOR;
    e.name = name;
    e.value = occupied ? "occupied" : "clear";
    this->event_(e);
  });
}

void MrLogicComponent::add_mast(const std::string &name, std::function<void(int)> set) {
  this->masts_.push_back({name, std::move(set), {}});
}

void MrLogicComponent::add_turnout(const std::string &name, std::function<const char *()> position,
                                   std::function<void(bool)> lock) {
  this->turnouts_.push_back({name, std::move(position), std::move(lock), ""});
}

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
  this->rule_count_ = t.rules.size();
  this->group_count_ = t.layers.size();
  ESP_LOGD(TAG, "Logic table: %u bytes of JSON compiled into about %u bytes", (unsigned) strlen(this->table_),
           (unsigned) t.bytes());
  this->boot_ms_ = millis();
}

void MrLogicComponent::event_(const ::logic_core::Event &e) { this->engine_->event(e); }

// The start-up scan's field: every bound sensor as it reads now.
void MrLogicComponent::start_() {
  ::logic_core::Start start;
  start.logic_on = true;
  start.broker_connected = false;
  for (const auto &s : this->sensors_)
    start.sensors_occupied[s.name] = !s.sensor->has_state() || s.sensor->state;
  // Every reading, moving included: a servo can still be on its boot move.
  for (auto &t : this->turnouts_) {
    t.last = t.position();
    start.turnouts[t.name] = t.last;
  }
  this->engine_.reset(new ::logic_core::Engine(this->table_data_, start));
  ESP_LOGI(TAG, "Start-up scan, %u ms after boot; the engine holds about %u bytes", (unsigned) (millis() - this->boot_ms_),
           (unsigned) this->engine_->bytes());
}

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
  // Turnouts are read once per scan: a throw takes seconds.
  for (auto &t : this->turnouts_) {
    std::string position = t.position();
    if (position == t.last) continue;
    t.last = position;
    ::logic_core::Event e;
    e.kind = ::logic_core::Event::TURNOUT;
    e.name = t.name;
    e.value = position;
    this->event_(e);
  }
  const uint32_t started = micros();
  ::logic_core::ScanOut out = this->engine_->scan();
  const uint32_t took = micros() - started;
  this->apply_(out);
  this->scans_++;
  if (took > this->slowest_us_) {
    this->slowest_us_ = took;
    ESP_LOGD(TAG, "Slowest scan so far: %u us", (unsigned) took);
  }
  if (took > SCAN_MS * 1000) ESP_LOGW(TAG, "A scan took %u ms, longer than the %u ms cycle", (unsigned) (took / 1000), (unsigned) SCAN_MS);
}

void MrLogicComponent::apply_(const ::logic_core::ScanOut &out) {
  using ::logic_core::LogEvent;
  for (const auto &w : out.writes) {
    if (w.lock) {
      for (auto &t : this->turnouts_)
        if (t.name == w.name) t.lock(w.on);
      continue;
    }
    for (auto &m : this->masts_) {
      if (m.name != w.name) continue;
      int index = -3;
      if (w.aspect == "dark") index = -2;  // the show script's every-lamp-off branch
      for (size_t i = 0; i < m.aspects.size(); i++)
        if (m.aspects[i] == w.aspect) index = static_cast<int>(i);
      if (index == -3) {
        // Fail safe: an aspect this mast does not have shows its stop aspect.
        ESP_LOGW(TAG, "Mast %s has no aspect %s; showing its stop aspect.", m.name.c_str(), w.aspect.c_str());
        index = m.stop;
      }
      m.set(index);
    }
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
      case LogEvent::RESYNC: ESP_LOGD(TAG, "%s: unlocked", e.what.c_str()); break;
    }
  }
}

void MrLogicComponent::dump_config() {
  ESP_LOGCONFIG(TAG, "Logic: %u sensors, %u masts, %u turnouts bound; %u rules in %u groups", (unsigned) this->sensors_.size(),
                (unsigned) this->masts_.size(), (unsigned) this->turnouts_.size(),
                (unsigned) this->rule_count_, (unsigned) this->group_count_);
  if (this->is_failed()) ESP_LOGCONFIG(TAG, "  The logic table could not be read.");
}

}  // namespace esphome::mr_logic
