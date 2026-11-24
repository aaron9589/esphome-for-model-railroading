// The ESPHome side of the logic engine: binds the core (logic_core.h) to this
// board's sensors, masts, turnouts, switch and other boards' topics, talks to
// JMRI and other boards over MQTT, and runs a scan every 100 ms. Spec: "The
// component (Spike A)" and "Generated YAML (shape)" in docs/field-logic-spec.md.
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "esphome/components/binary_sensor/binary_sensor.h"
#include "esphome/components/switch/switch.h"
#include "esphome/components/text_sensor/text_sensor.h"
#include "esphome/core/component.h"

#include "logic_core.h"
#include "logic_table.h"

namespace esphome::mr_logic {

class MrLogicComponent : public Component {
 public:
  void set_table(const char *table) { this->table_ = table; }
  void set_board(const std::string &board) { this->board_ = board; }
  void set_topic_prefix(const std::string &prefix) { this->prefix_ = prefix; }
  void set_version(const std::string &version) { this->version_ = version; }
  void set_logic_switch(switch_::Switch *sw) { this->switch_ = sw; }

  // expander: the sensor's MCP23017 hub, or nullptr. A hub that has failed or
  // warns makes the sensor read occupied (spec, More sensor pins).
  void add_sensor(const std::string &name, binary_sensor::BinarySensor *sensor, Component *expander);
  // set(index): writes the mast's aspect global and runs its show script.
  // jmri: the mast's mqtt_subscribe text sensor, or nullptr.
  void add_mast(const std::string &name, std::function<void(int)> set, text_sensor::TextSensor *jmri);
  // position(): "closed", "thrown" or "moving". lock(on): the field lock.
  // remote_locked(): the Lock topic's flag (or empty). resync(): runs the
  // latch script so a toggle-switch turnout matches its switch (or empty).
  void add_turnout(const std::string &name, std::function<const char *()> position, std::function<void(bool)> lock,
                   std::function<bool()> remote_locked, std::function<void()> resync);
  void add_remote_board(const std::string &board, text_sensor::TextSensor *online);
  void add_remote_sensor(const std::string &board, const std::string &name, bool block, text_sensor::TextSensor *state);
  void add_remote_turnout(const std::string &board, const std::string &name, text_sensor::TextSensor *thrown,
                          text_sensor::TextSensor *moving);
  void add_remote_mast(const std::string &board, const std::string &name, text_sensor::TextSensor *state);

  // A press of a resource's Release button (spec, Manual release).
  void release(const std::string &resource);
  // True once the start-up scan has run: the toggle-switch boot moves wait for it.
  bool started() const { return this->engine_ != nullptr; }
  bool logic_on() const { return this->engine_ ? this->engine_->logic_on() : this->want_logic_(); }

  void setup() override;
  void loop() override;
  void dump_config() override;
  // After the sensors, scripts and switch it reads.
  float get_setup_priority() const override { return setup_priority::DATA; }

 protected:
  struct SensorBinding {
    std::string name;
    binary_sensor::BinarySensor *sensor;
    Component *expander;
    int8_t fed;  // what the engine was last told: -1 nothing yet
    bool expander_bad;
  };
  struct MastBinding {
    std::string name;
    std::function<void(int)> set;
    std::vector<std::string> aspects;
    int stop{-2};
    std::string shown;
  };
  struct TurnoutBinding {
    std::string name;
    std::function<const char *()> position;
    std::function<void(bool)> lock;
    std::function<bool()> remote_locked;
    std::function<void()> resync;
    std::string last;
    int8_t last_remote{-1};
  };
  struct RemoteTurnout {
    std::string board, name;
    text_sensor::TextSensor *thrown, *moving;
  };
  // Remote bindings, kept so the start-up scan sees what has already arrived.
  struct RemoteBoard {
    std::string board;
    text_sensor::TextSensor *online;
  };
  struct RemoteSensor {
    std::string board, name;
    bool block;
    text_sensor::TextSensor *state;
  };
  struct RemoteMast {
    std::string board, name;
    text_sensor::TextSensor *state;
  };
  std::vector<RemoteBoard> remote_boards_;
  std::vector<RemoteSensor> remote_sensors_;
  std::vector<RemoteMast> remote_masts_;
  std::vector<std::pair<std::string, text_sensor::TextSensor *>> jmri_topics_;

  void start_();
  void scan_();
  void apply_(const ::logic_core::ScanOut &out);
  void event_(const ::logic_core::Event &e);
  void show_(MastBinding &m, const std::string &aspect);
  void remote_turnout_(const RemoteTurnout &t);
  void feed_sensor_(SensorBinding &s, bool occupied);
  bool want_logic_() const { return this->switch_ == nullptr || this->switch_->state; }
  void mqtt_setup_();
  void mqtt_publish_(const std::string &topic, const std::string &payload);
  std::string topic_(const std::string &rest) const { return this->prefix_ + rest; }

  const char *table_{nullptr};
  std::string board_;
  std::string prefix_{"trains/"};
  std::string version_;
  switch_::Switch *switch_{nullptr};
  // The compiled table. The engine refers to it, so it lives here, in place.
  ::logic_core::Table table_data_;
  bool table_ok_{false};
  std::unique_ptr<::logic_core::Engine> engine_;
  std::vector<SensorBinding> sensors_;
  std::vector<MastBinding> masts_;
  std::vector<TurnoutBinding> turnouts_;
  std::vector<RemoteTurnout> remote_turnouts_;
  bool broker_{false};
  bool switch_published_{false};
  std::string light_published_;  // the light state this board last published
  uint32_t boot_ms_{0};
  uint32_t last_scan_ms_{0};
  uint32_t scans_{0};
  uint32_t slowest_us_{0};
};

}  // namespace esphome::mr_logic
