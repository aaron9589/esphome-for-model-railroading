// The rule table: a board in the engine cases' format (configurator/test/cases/
// README.md, "board"), read from JSON. The configurator writes it into the
// YAML; the component reads it once at boot. No ESPHome, no exceptions.
#pragma once

#include <string>

#include "logic_core.h"
#include "logic_json.h"

namespace logic_core {

// Reads a board. On a problem, returns false and says what in *error.
bool board_from_json(const std::string &text, Board *out, std::string *error);
// The same from a value already read; *error says what was wrong, or is empty.
Board board_from_value(const json::Value &v, std::string *error);
bool parse_ms(const std::string &text, uint32_t *out);

}  // namespace logic_core
