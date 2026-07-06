"""HEMS Non-Intrusive Load Monitoring engine."""
import json

from .event_detector import PhaseEventDetector
from .classifier import KNNClassifier
from .attribution import PhaseAttributor
from .pipeline import NILMPipeline
from .signal import derive_sq, q_from_pf

__all__ = [
    "PhaseEventDetector", "KNNClassifier", "PhaseAttributor",
    "NILMPipeline", "derive_sq", "q_from_pf", "load_config", "phase_map_from_config",
]


def load_config(path="config.json"):
    return json.load(open(path))


def phase_map_from_config(cfg):
    """Group trained appliance labels by phase (the per-phase candidate sets).

    Built only from 'appliances' (the trained library). 'untrained_loads' are
    intentionally excluded so they fail the rejection test and read as unknown.
    """
    pm = {ph: [] for ph in cfg["phases"]}
    for label, spec in cfg["appliances"].items():
        pm[spec["phase"]].append(label)
    return pm
