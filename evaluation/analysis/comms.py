"""Communication reliability test → upload success rate + reconnect time.

Reads #COMM rows:
  attempt,<uid>,<ms>          every Firebase upload started
  result,<uid>,<ok|fail>,<ms> every upload's terminal outcome
  wifi,<up|down>,<ms>         Wi-Fi transitions (manual drop test)

Success rate = successful results / results. Reconnection time pairs each
`wifi,down` with the next `wifi,up`; recovery-to-first-upload pairs that `up`
with the next successful `result`.
"""
import numpy as np
import pandas as pd

import common

# auth callbacks aren't uploads; keep the metric to actual data writes
_UPLOAD_PREFIXES = ("live", "history", "event", "evt:")


def _is_upload(uid):
    return any(uid.startswith(p) for p in _UPLOAD_PREFIXES)


def run(buckets, results_dir):
    rows = buckets.get("COMM", [])
    if not rows:
        return common.nodata("comms",
                             "no #COMM rows — capture a normal run (uploads log automatically)")

    results, wifi = [], []
    for r in rows:
        kind = r[0].strip()
        if kind == "result" and len(r) >= 4:
            uid, status, ms = r[1].strip(), r[2].strip(), common.to_float(r[3])
            if _is_upload(uid):
                results.append({"uid": uid, "ok": status == "ok", "ms": ms})
        elif kind == "wifi" and len(r) >= 3:
            wifi.append({"state": r[1].strip(), "ms": common.to_float(r[2])})

    if not results:
        return common.nodata("comms", "no upload results found in #COMM stream")

    res = pd.DataFrame(results)
    total = int(res.shape[0])
    ok = int(res["ok"].sum())
    rate = 100.0 * ok / total

    # reconnection: each down → next up
    recon = []
    w = pd.DataFrame(wifi)
    if not w.empty:
        downs = w[w["state"] == "down"]["ms"].tolist()
        ups = w[w["state"] == "up"]["ms"].tolist()
        for d in downs:
            later_ups = [u for u in ups if u > d]
            if later_ups:
                up = min(later_ups)
                # first successful upload after coming back
                after = res[(res["ms"] > up) & (res["ok"])]["ms"]
                first_ok = float(after.min()) if not after.empty else np.nan
                recon.append({
                    "down_ms": d, "up_ms": up,
                    "reconnect_ms": round(up - d, 0),
                    "recovery_to_first_upload_ms":
                        round(first_ok - d, 0) if np.isfinite(first_ok) else np.nan,
                })

    print("\n== Communication reliability ==")
    summary = pd.DataFrame([{
        "upload_attempts_logged": int(sum(1 for r in rows if r[0].strip() == "attempt"
                                          and len(r) >= 2 and _is_upload(r[1].strip()))),
        "upload_results": total,
        "successes": ok,
        "failures": total - ok,
        "success_rate_pct": round(rate, 1),
    }])
    common.save_table(summary, f"{results_dir}/comms_summary.csv")
    print(f"  upload success rate: {ok}/{total} = {rate:.1f}%")

    out = {"comms_success_pct": round(rate, 1)}
    if recon:
        rt = pd.DataFrame(recon)
        common.save_table(rt, f"{results_dir}/comms_reconnect.csv")
        avg = float(rt["reconnect_ms"].mean())
        print(f"  average reconnection time: {avg/1000:.1f} s over {len(recon)} drop(s)")
        out["avg_reconnect_s"] = round(avg / 1000.0, 1)
    else:
        print("  (no Wi-Fi drop events captured — run the drop test to measure reconnect time)")

    return out
