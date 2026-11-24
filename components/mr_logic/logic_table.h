// The rule table: a board in the engine cases' format (configurator/test/cases/
// README.md, "board"), as JSON. The configurator writes it into the YAML; the
// component compiles it once at boot into a compact Table. No ESPHome, no
// exceptions, and no JSON tree: the text is read once, straight into the Table.
#pragma once

#include <string>

#include "logic_core.h"

namespace logic_core {

// Compiles a table. On a problem, returns false and says what in *error.
bool compile_table(const char *json, Table *out, std::string *error);
// "0.5s" or "500ms"; empty is 0. Anything else returns false, as logic.js.
bool parse_ms(const std::string &text, uint32_t *out);

}  // namespace logic_core
