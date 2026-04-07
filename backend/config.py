"""
Clawscope configuration loader.
Reads config.yaml from project root, provides typed access + hot-reload.
"""

import os
import yaml
import copy
from pathlib import Path
from typing import Dict, List, Optional, Any

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"

_config: Dict[str, Any] = {}
_config_mtime: float = 0


def _load():
    """Load config from disk if changed."""
    global _config, _config_mtime
    try:
        mtime = os.path.getmtime(CONFIG_PATH)
        if mtime != _config_mtime:
            with open(CONFIG_PATH, "r") as f:
                _config = yaml.safe_load(f) or {}
            _config_mtime = mtime
    except FileNotFoundError:
        _config = {}
        _config_mtime = 0


def get_raw() -> Dict[str, Any]:
    """Return full config dict (auto-reloads on file change)."""
    _load()
    return copy.deepcopy(_config)


def save_raw(data: Dict[str, Any]):
    """Write full config back to disk."""
    global _config, _config_mtime
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    _config = data
    _config_mtime = os.path.getmtime(CONFIG_PATH)


# -- Typed accessors ----------------------------------------------------------

def get_auth() -> dict:
    _load()
    auth = _config.get("auth", {})
    return {
        "password": auth.get("password", "changeme"),
        "secret_key": auth.get("secret_key", "changeme-generate-a-random-secret"),
        "token_expire_hours": auth.get("token_expire_hours", 24),
    }


def get_sessions_dir() -> str:
    _load()
    paths = _config.get("paths", {})
    return os.path.expanduser(paths.get("sessions_dir", "~/.openclaw/agents/main/sessions"))


def get_agents_base() -> str:
    _load()
    paths = _config.get("paths", {})
    return os.path.expanduser(paths.get("agents_base", "~/.openclaw/agents"))


def get_users() -> List[dict]:
    """Return list of known user dicts: [{id, name, category}]."""
    _load()
    return _config.get("users", []) or []


def get_user_by_sender_id(sender_id: str) -> Optional[dict]:
    for u in get_users():
        if str(u.get("id", "")) == str(sender_id):
            return u
    return None


def get_sender_id_map() -> Dict[str, str]:
    """Return {sender_id: lowercase_name} for collectors."""
    return {str(u["id"]): u["name"].lower() for u in get_users() if u.get("id") and u.get("name")}


def get_channel_map() -> Dict[str, str]:
    """Return {lowercase_name: channel} for collectors."""
    result = {}
    for u in get_users():
        if u.get("name") and u.get("channel"):
            result[u["name"].lower()] = u["channel"]
    # System categories
    result["cron"] = "system"
    result["subagent"] = "system"
    result["unknown"] = "system"
    return result


def get_user_display_map() -> Dict[str, str]:
    """Return {lowercase_name: DisplayName} for collectors."""
    base = {}
    for u in get_users():
        if u.get("name"):
            base[u["name"].lower()] = u["name"]
    # Add system categories
    _load()
    cats = _config.get("user_categories", {})
    for key, label in cats.items():
        base[key] = label
    return base


def get_known_sessions() -> Dict[str, str]:
    _load()
    return _config.get("known_sessions", {}) or {}


def get_api_key_labels() -> Dict[str, str]:
    _load()
    return _config.get("api_key_labels", {}) or {}


def get_model_pricing() -> Dict[str, dict]:
    _load()
    return _config.get("model_pricing", {}) or {}


def get_default_pricing() -> dict:
    _load()
    return _config.get("default_pricing", {
        "input": 3.0, "output": 15.0, "cache_write": 3.75, "cache_read": 0.30
    })


def get_pricing_table() -> Dict[str, dict]:
    """Return full pricing dict compatible with collector PRICING format."""
    table = {}
    for model, prices in get_model_pricing().items():
        table[model] = {
            "input": prices.get("input", 3),
            "output": prices.get("output", 15),
            "cache_write": prices.get("cache_write", 3.75),
            "cache_read": prices.get("cache_read", 0.30),
        }
    return table
