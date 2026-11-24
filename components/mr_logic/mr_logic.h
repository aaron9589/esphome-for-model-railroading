// The ESPHome side of the logic engine: binds the core (logic_core.h) to this
// board's sensors, masts and turnouts, and runs a scan every 100 ms.
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "esphome/components/binary_sensor/binary_sensor.h"
#include "esphome/core/component.h"

#include "logic_core.h"

namespace esphome::mr_logic {

class MrLogicComponent : public Component {
 public:
  void set_table(const char *table) { this->table_ = table; }
  void add_sensor(const std::string &name, binary_sensor::BinarySensor *sensor);
  // set(index): writes the mast's aspect global and runs its show script.
  void add_mast(const std::string &name, std::function<void(int)> set);
  // position(): "closed", "thrown" or "moving". lock(on): the field lock.
  void add_turnout(const std::string &name, std::function<const char *()> position, std::function<void(bool)> lock);

  void setup() override;
  void loop() override;
  void dump_config() override;
  // After the sensors and scripts it reads.
  float get_setup_priority() const override { return setup_priority::DATA; }

  bool started() const { return this->engine_ != nullptr; }

 protected:
  struct SensorBinding {
    std::string name;
    binary_sensor::BinarySensor *sensor;
  };
  struct MastBinding {
    std::string name;
    std::function<void(int)> set;
    std::vector<std::string> aspects;
  };
  struct TurnoutBinding {
    std::string name;
    std::function<const char *()> position;
    std::function<void(bool)> lock;
    std::string last;
  };

  void start_();
  void apply_(const ::logic_core::ScanOut &out);
  void event_(const ::logic_core::Event &e);

  const char *table_{nullptr};
  ::logic_core::Board board_;
  bool table_ok_{false};
  std::unique_ptr<::logic_core::Engine> engine_;
  std::vector<SensorBinding> sensors_;
  std::vector<MastBinding> masts_;
  std::vector<TurnoutBinding> turnouts_;
  uint32_t boot_ms_{0};
  uint32_t last_scan_ms_{0};
  uint32_t scans_{0};
  uint32_t slowest_us_{0};
};

}  // namespace esphome::mr_logic
