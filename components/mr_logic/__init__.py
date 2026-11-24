"""mr_logic: the logic engine as an ESPHome external component.

The configurator writes the rule table (a board in the engine cases' format,
as JSON) and binds the engine's names to this board's ESPHome objects by id.
The component never edits a foundational item: it writes mast aspect globals,
runs their show scripts, and writes field-lock globals, all through generated
lambdas, so it does not depend on the globals' or scripts' C++ types.
"""

import json

import esphome.codegen as cg
from esphome.components import binary_sensor, script
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_NAME, CONF_SENSOR

CODEOWNERS = []
DEPENDENCIES = []

CONF_TABLE = "table"
CONF_SENSORS = "sensors"
CONF_MASTS = "masts"
CONF_TURNOUTS = "turnouts"
CONF_ASPECT = "aspect"
CONF_SHOW = "show"
CONF_THROWN = "thrown"
CONF_THROW_CLOSED = "throw_closed"
CONF_THROW_THROWN = "throw_thrown"
CONF_FIELD_LOCKED = "field_locked"

mr_logic_ns = cg.esphome_ns.namespace("mr_logic")
MrLogicComponent = mr_logic_ns.class_("MrLogicComponent", cg.Component)


def validate_table(value):
    """The rule table: a JSON object. The engine checks the rest at boot, and
    the configurator has validated it before writing it here."""
    value = cv.string_strict(value)
    try:
        data = json.loads(value)
    except json.JSONDecodeError as err:
        raise cv.Invalid(f"The logic table is not valid JSON: {err}") from err
    if not isinstance(data, dict):
        raise cv.Invalid("The logic table must be a JSON object.")
    return value


SENSOR_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NAME): cv.string_strict,
        cv.Required(CONF_SENSOR): cv.use_id(binary_sensor.BinarySensor),
    }
)

MAST_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NAME): cv.string_strict,
        # A globals id (int): the aspect index the show script draws.
        cv.Required(CONF_ASPECT): cv.use_id(cg.Component),
        cv.Required(CONF_SHOW): cv.use_id(script.Script),
    }
)

TURNOUT_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NAME): cv.string_strict,
        # A globals id (bool): the saved position, true when thrown.
        cv.Required(CONF_THROWN): cv.use_id(cg.Component),
        cv.Required(CONF_THROW_CLOSED): cv.use_id(script.Script),
        cv.Required(CONF_THROW_THROWN): cv.use_id(script.Script),
        # A globals id (bool): the engine's lock.
        cv.Optional(CONF_FIELD_LOCKED): cv.use_id(cg.Component),
    }
)

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(MrLogicComponent),
        cv.Required(CONF_TABLE): validate_table,
        cv.Optional(CONF_SENSORS, default=[]): cv.ensure_list(SENSOR_SCHEMA),
        cv.Optional(CONF_MASTS, default=[]): cv.ensure_list(MAST_SCHEMA),
        cv.Optional(CONF_TURNOUTS, default=[]): cv.ensure_list(TURNOUT_SCHEMA),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_table(config[CONF_TABLE]))
    for item in config[CONF_SENSORS]:
        sens = await cg.get_variable(item[CONF_SENSOR])
        cg.add(var.add_sensor(item[CONF_NAME], sens))
    for item in config[CONF_MASTS]:
        aspect = await cg.get_variable(item[CONF_ASPECT])
        show = await cg.get_variable(item[CONF_SHOW])
        cg.add(
            var.add_mast(
                item[CONF_NAME],
                cg.RawExpression(f"[](int value) {{ {aspect}->value() = value; {show}->execute(true); }}"),
            )
        )
    for item in config[CONF_TURNOUTS]:
        thrown = await cg.get_variable(item[CONF_THROWN])
        closing = await cg.get_variable(item[CONF_THROW_CLOSED])
        throwing = await cg.get_variable(item[CONF_THROW_THROWN])
        position = (
            f"[]() -> const char * {{ return ({closing}->is_running() || {throwing}->is_running()) ? \"moving\""
            f" : ({thrown}->value() ? \"thrown\" : \"closed\"); }}"
        )
        if CONF_FIELD_LOCKED in item:
            locked = await cg.get_variable(item[CONF_FIELD_LOCKED])
            lock = f"[](bool on) {{ {locked}->value() = on; }}"
        else:
            lock = "[](bool) {}"
        cg.add(var.add_turnout(item[CONF_NAME], cg.RawExpression(position), cg.RawExpression(lock)))
