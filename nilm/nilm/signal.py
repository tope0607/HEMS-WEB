"""Electrical signal helpers shared by the simulator and the live engine.

A PZEM-004T reports V, I, active power P, power factor, frequency and
cumulative energy. It does NOT report reactive power, so we derive it.
Real and reactive power are additive across loads, which is exactly why
the NILM feature vector uses (dP, dQ) and not dPF.
"""
import math


def derive_sq(v, i, p):
    """Return (apparent_power S, reactive_power Q) from V, I, active P.

    Q is taken as a magnitude: the PZEM gives no leading/lagging sign, and
    office loads are inductive or resistive, never capacitive, so |Q| is fine.
    """
    s = v * i
    q2 = s * s - p * p
    q = math.sqrt(q2) if q2 > 0.0 else 0.0
    return s, q


def q_from_pf(p, pf):
    """Reactive power VAR from active power and power factor (for the simulator)."""
    pf = max(min(pf, 1.0), 1e-6)
    phi = math.acos(pf)
    return p * math.tan(phi)
