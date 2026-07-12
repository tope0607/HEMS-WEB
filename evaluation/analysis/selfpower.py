"""System self-power → measured draw if provided, else a datasheet estimate.

If you fed controller-supply readings in over serial (`PWR <V> <A>` →
`#PWR,measured,...`), this reports the measured draw. Otherwise it emits a
datasheet-summed estimate table, explicitly labelled "datasheet estimate
(NOT measured)" per the integrity rule — the component figures are datasheet
typicals, not readings.
"""
import pandas as pd

import common

# Datasheet-typical steady draws on the controller's own low-voltage supply.
# These are ESTIMATES (component datasheets), not measurements.
_DATASHEET = [
    ("ESP32-WROOM-32UE", "~150 mA @ 3.3 V, Wi-Fi active (avg)", 0.50),
    ("PZEM-004T TTL side ×3", "~20 mA @ 5 V each, opto/TTL only", 0.30),
    ("DS3231 RTC", "~1 mA @ 3.3 V active", 0.01),
    ("Relay driver module", "~70 mA @ 5 V, coil energised", 0.35),
    ("Regulator/board overhead", "typical LDO/USB-UART quiescent", 0.20),
]
_NOTE = ("The 18 A contactor's own coil is AC-mains powered through the relay "
         "module, NOT drawn from the controller supply, so it is excluded here.")


def run(buckets, results_dir):
    rows = [r for r in buckets.get("PWR", []) if r and r[0].strip() == "measured"]

    if rows:
        recs = []
        for i, r in enumerate(rows, 1):
            v, a, w = (common.to_float(r[1]), common.to_float(r[2]),
                       common.to_float(r[3]) if len(r) > 3 else float("nan"))
            recs.append({"reading": i, "voltage_v": v, "current_a": a,
                         "power_w": round(w, 3)})
        table = pd.DataFrame(recs)
        mean_w = float(table["power_w"].mean())
        print("\n== System self-power (MEASURED) ==")
        common.save_table(table, f"{results_dir}/selfpower_measured.csv")
        print(f"  mean controller draw: {mean_w:.2f} W  (measured)")
        return {"self_power_w": round(mean_w, 2), "source": "measured"}

    # datasheet estimate
    table = pd.DataFrame(
        [{"component": c, "basis": b, "est_power_w": p} for c, b, p in _DATASHEET])
    total = float(table["est_power_w"].sum())
    table = pd.concat([table, pd.DataFrame(
        [{"component": "TOTAL (datasheet estimate)", "basis": "sum of above",
          "est_power_w": round(total, 2)}])], ignore_index=True)

    print("\n== System self-power (DATASHEET ESTIMATE — NOT measured) ==")
    common.save_table(table, f"{results_dir}/selfpower_estimate.csv")
    print(f"  estimated controller draw: {total:.2f} W  (datasheet estimate, not measured)")
    print(f"  note: {_NOTE}")
    return {"self_power_w": round(total, 2), "source": "datasheet_estimate"}
