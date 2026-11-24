# Builds the logic engine's C++ core (components/mr_logic/logic_core.*) on a computer,
# with no ESPHome, and replays the shared engine cases against it.
#   cmake -S engine-tests -B engine-tests/build && cmake --build engine-tests/build
#   ctest --test-dir engine-tests/build --output-on-failure
cmake_minimum_required(VERSION 3.16)
project(mr_logic_engine_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The core must build as the board builds it: no exceptions, no RTTI.
add_library(mr_logic_core STATIC ../components/mr_logic/logic_core.cpp ../components/mr_logic/logic_table.cpp)
target_compile_options(mr_logic_core PRIVATE -Wall -Wextra -Werror -fno-exceptions -fno-rtti)

add_executable(engine_tests main.cpp)
target_link_libraries(engine_tests PRIVATE mr_logic_core)
target_compile_options(engine_tests PRIVATE -Wall -Wextra -Werror)

enable_testing()
add_test(NAME cases COMMAND engine_tests ${CMAKE_CURRENT_SOURCE_DIR}/../configurator/test/cases)
# The harness must fail a case whose expectation is wrong.
add_test(NAME harness_fails_a_wrong_case COMMAND engine_tests ${CMAKE_CURRENT_SOURCE_DIR}/self-check)
set_tests_properties(harness_fails_a_wrong_case PROPERTIES WILL_FAIL TRUE)
