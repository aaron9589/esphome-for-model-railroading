"""mr_logic: the logic engine as an ESPHome external component.

The configurator writes the rule table (a board in the engine cases' format,
as JSON) and binds the engine's names to this board's ESPHome objects by id.
The component never edits a foundational item: it writes mast aspect globals,
runs their show scripts, and writes field-lock globals, all through generated
lambdas, so it does not depend on the globals' or scripts' C++ types (spec,
"The component (Spike A)").
"""

import json

import esphome.codegen as cg
from esphome.components import binary_sensor, script, switch, text, text_sensor
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_NAME, CONF_SENSOR, CONF_VERSION
import esphome.final_validate as fv

CODEOWNERS = []
DEPENDENCIES = []
AUTO_LOAD = ["binary_sensor", "switch", "text", "text_sensor"]

CONF_TABLE = "table"
CONF_BOARD = "board"
CONF_TOPIC_PREFIX = "topic_prefix"
CONF_LOGIC_SWITCH = "logic_switch"
CONF_SENSORS = "sensors"
CONF_EXPANDER = "expander"
CONF_MASTS = "masts"
CONF_ASPECT = "aspect"
CONF_SHOW = "show"
CONF_JMRI = "jmri"
CONF_TURNOUTS = "turnouts"
CONF_THROWN = "thrown"
CONF_MOVING = "moving"
CONF_THROW_CLOSED = "throw_closed"
CONF_THROW_THROWN = "throw_thrown"
CONF_FIELD_LOCKED = "field_locked"
CONF_REMOTE_LOCKED = "remote_locked"
CONF_RESYNC = "resync"
CONF_REMOTE = "remote"
CONF_ONLINE = "online"
CONF_BLOCKS = "blocks"
CONF_STATE = "state"
CONF_ENDS = "ends"
CONF_LINK = "link"
CONF_LED = "led"

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
        # The sensor's MCP23017 hub: while it fails or warns, the sensor reads occupied.
        cv.Optional(CONF_EXPANDER): cv.use_id(cg.Component),
    }
)

MAST_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NAME): cv.string_strict,
        # A globals id (int): the aspect index the show script draws.
        cv.Required(CONF_ASPECT): cv.use_id(cg.Component),
        cv.Required(CONF_SHOW): cv.use_id(script.Script),
        # The mast's mqtt_subscribe text sensor: JMRI's messages, for holds and logic off.
        cv.Optional(CONF_JMRI): cv.use_id(text_sensor.TextSensor),
    }
)

TURNOUT_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NAME): cv.string_strict,
        # A globals id (bool): the saved position, true when thrown.
        cv.Required(CONF_THROWN): cv.use_id(cg.Component),
        cv.Required(CONF_THROW_CLOSED): cv.use_id(script.Script),
        cv.Required(CONF_THROW_THROWN): cv.use_id(script.Script),
        # Globals ids (bool): the engine's lock, and the Lock topic's.
        cv.Optional(CONF_FIELD_LOCKED): cv.use_id(cg.Component),
        cv.Optional(CONF_REMOTE_LOCKED): cv.use_id(cg.Component),
        # The toggle switch's latch script (bool force): run when the turnout unlocks.
        cv.Optional(CONF_RESYNC): cv.use_id(script.Script),
    }
)

REMOTE_ITEM_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NAME): cv.string_strict,
        cv.Required(CONF_STATE): cv.use_id(text_sensor.TextSensor),
    }
)

REMOTE_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_BOARD): cv.string_strict,
        cv.Required(CONF_ONLINE): cv.use_id(text_sensor.TextSensor),
        cv.Optional(CONF_SENSORS, default=[]): cv.ensure_list(REMOTE_ITEM_SCHEMA),
        cv.Optional(CONF_BLOCKS, default=[]): cv.ensure_list(REMOTE_ITEM_SCHEMA),
        cv.Optional(CONF_TURNOUTS, default=[]): cv.ensure_list(
            cv.Schema(
                {
                    cv.Required(CONF_NAME): cv.string_strict,
                    cv.Required(CONF_THROWN): cv.use_id(text_sensor.TextSensor),
                    cv.Required(CONF_MOVING): cv.use_id(text_sensor.TextSensor),
                }
            )
        ),
        cv.Optional(CONF_MASTS, default=[]): cv.ensure_list(REMOTE_ITEM_SCHEMA),
    }
)

END_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NAME): cv.string_strict,
        # The end's Link text entity (saved across reboots): every change of link goes through it.
        cv.Required(CONF_LINK): cv.use_id(text.Text),
        # An optional LED: a gpio switch the component blinks.
        cv.Optional(CONF_LED): cv.use_id(switch.Switch),
        # An optional text sensor for the end's state in words.
        cv.Optional(CONF_STATE): cv.use_id(text_sensor.TextSensor),
    }
)

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(MrLogicComponent),
        cv.Required(CONF_TABLE): validate_table,
        # This board's name, for the logic topics. Without it, nothing goes over MQTT.
        cv.Optional(CONF_BOARD): cv.string_strict,
        cv.Optional(CONF_TOPIC_PREFIX, default="trains/"): cv.string_strict,
        cv.Optional(CONF_VERSION): cv.string_strict,
        # The Field logic / MSS logic switch. Without one, logic is always on.
        cv.Optional(CONF_LOGIC_SWITCH): cv.use_id(switch.Switch),
        cv.Optional(CONF_SENSORS, default=[]): cv.ensure_list(SENSOR_SCHEMA),
        cv.Optional(CONF_MASTS, default=[]): cv.ensure_list(MAST_SCHEMA),
        cv.Optional(CONF_TURNOUTS, default=[]): cv.ensure_list(TURNOUT_SCHEMA),
        cv.Optional(CONF_REMOTE, default=[]): cv.ensure_list(REMOTE_SCHEMA),
        cv.Optional(CONF_ENDS, default=[]): cv.ensure_list(END_SCHEMA),
    }
).extend(cv.COMPONENT_SCHEMA)


def _check_global(fconf, id_, want, where):
    path = fconf.get_path_for_id(id_)
    if not path or path[0] != "globals":
        raise cv.Invalid(f"{where}: {id_} must be the id of a globals entry.")
    declared = fconf.get_config_for_path(path[:-1])
    if declared.get("type") != want:
        raise cv.Invalid(f"{where}: globals {id_} must have type {want}, not {declared.get('type')}.")


def _final_validate(config):
    fconf = fv.full_config.get()
    for item in config[CONF_MASTS]:
        _check_global(fconf, item[CONF_ASPECT], "int", f"mast {item[CONF_NAME]}")
    for item in config[CONF_TURNOUTS]:
        _check_global(fconf, item[CONF_THROWN], "bool", f"turnout {item[CONF_NAME]}")
        for key in (CONF_FIELD_LOCKED, CONF_REMOTE_LOCKED):
            if key in item:
                _check_global(fconf, item[key], "bool", f"turnout {item[CONF_NAME]}")
    return config


FINAL_VALIDATE_SCHEMA = _final_validate


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_table(config[CONF_TABLE]))
    if CONF_BOARD in config:
        cg.add(var.set_board(config[CONF_BOARD]))
    cg.add(var.set_topic_prefix(config[CONF_TOPIC_PREFIX]))
    if CONF_VERSION in config:
        cg.add(var.set_version(config[CONF_VERSION]))
    if CONF_LOGIC_SWITCH in config:
        cg.add(var.set_logic_switch(await cg.get_variable(config[CONF_LOGIC_SWITCH])))
    for item in config[CONF_SENSORS]:
        sens = await cg.get_variable(item[CONF_SENSOR])
        hub = await cg.get_variable(item[CONF_EXPANDER]) if CONF_EXPANDER in item else cg.nullptr
        cg.add(var.add_sensor(item[CONF_NAME], sens, hub))
    for item in config[CONF_MASTS]:
        aspect = await cg.get_variable(item[CONF_ASPECT])
        show = await cg.get_variable(item[CONF_SHOW])
        jmri = await cg.get_variable(item[CONF_JMRI]) if CONF_JMRI in item else cg.nullptr
        cg.add(
            var.add_mast(
                item[CONF_NAME],
                cg.RawExpression(f"[](int value) {{ {aspect}->value() = value; {show}->execute(true); }}"),
                jmri,
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
        lock = "[](bool) {}"
        if CONF_FIELD_LOCKED in item:
            locked = await cg.get_variable(item[CONF_FIELD_LOCKED])
            lock = f"[](bool on) {{ {locked}->value() = on; }}"
        remote = "std::function<bool()>()"
        if CONF_REMOTE_LOCKED in item:
            remote_locked = await cg.get_variable(item[CONF_REMOTE_LOCKED])
            remote = f"[]() -> bool {{ return {remote_locked}->value(); }}"
        resync = "std::function<void()>()"
        if CONF_RESYNC in item:
            latch = await cg.get_variable(item[CONF_RESYNC])
            resync = f"[]() {{ {latch}->execute(false); }}"
        cg.add(
            var.add_turnout(
                item[CONF_NAME],
                cg.RawExpression(position),
                cg.RawExpression(lock),
                cg.RawExpression(remote),
                cg.RawExpression(resync),
            )
        )
    for board in config[CONF_REMOTE]:
        name = board[CONF_BOARD]
        cg.add(var.add_remote_board(name, await cg.get_variable(board[CONF_ONLINE])))
        for key, block in ((CONF_SENSORS, False), (CONF_BLOCKS, True)):
            for item in board[key]:
                cg.add(var.add_remote_sensor(name, item[CONF_NAME], block, await cg.get_variable(item[CONF_STATE])))
        for item in board[CONF_TURNOUTS]:
            cg.add(
                var.add_remote_turnout(
                    name,
                    item[CONF_NAME],
                    await cg.get_variable(item[CONF_THROWN]),
                    await cg.get_variable(item[CONF_MOVING]),
                )
            )
        for item in board[CONF_MASTS]:
            cg.add(var.add_remote_mast(name, item[CONF_NAME], await cg.get_variable(item[CONF_STATE])))
    for item in config[CONF_ENDS]:
        link = await cg.get_variable(item[CONF_LINK])
        led = await cg.get_variable(item[CONF_LED]) if CONF_LED in item else cg.nullptr
        state = await cg.get_variable(item[CONF_STATE]) if CONF_STATE in item else cg.nullptr
        cg.add(var.add_end(item[CONF_NAME], link, led, state))
