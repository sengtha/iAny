#!/usr/bin/env python3
"""Run the iAny Decide evaluation set through Jev — the missing column.

Two ways in, same payloads either way:

  1. Through the deployed iAny worker (default) — exercises the production
     path end to end. --fresh (default) salts the cache key so every call
     reaches the model instead of the KV cache.

        python run_jev.py

  2. Straight at TypeSafe's API (GA since 2026-09-21, $5 free credit at
     console.typesafe.ai). Check their docs for the exact endpoint path; the
     body posted is the bare {state, questions} request.

        python run_jev.py --api typesafe --url https://<their-endpoint> \
                          --auth "Bearer sk-..."

The gate, agreement and report logic are imported from run_laya.py so the
three columns (device / Laya / Jev) are judged by identical rules — the whole
point of the exercise. All twelve scenarios cost well under one US cent.
"""
import argparse
import json
import pathlib
import secrets
import time
import urllib.request

from run_laya import gate  # identical gate for every column, by construction

WRAPPERS = ("result", "response", "output", "data")


def find_answers(node, depth=0):
    """Same envelope walk as normalizeJevResponse in src/decide/jev.ts."""
    if depth > 4 or not isinstance(node, dict):
        return None
    if isinstance(node.get("answers"), dict):
        return node
    for k in WRAPPERS:
        if k in node:
            return find_answers(node[k], depth + 1)
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="worker", choices=["worker", "typesafe"])
    ap.add_argument("--url", default="https://iany.app/api/decide")
    ap.add_argument("--auth", default="", help='e.g. "Bearer sk-..." for --api typesafe')
    ap.add_argument("--payloads", default=str(pathlib.Path(__file__).parent / "payloads.json"))
    ap.add_argument("--out", default="jev_results.json")
    ap.add_argument("--fresh", action=argparse.BooleanOptionalAction, default=True,
                    help="salt the cache key so the model answers, not the KV cache")
    args = ap.parse_args()

    scenarios = json.load(open(args.payloads))["scenarios"]
    salt = secrets.token_hex(4)

    results, used, agreed = [], 0, 0
    for sc in scenarios:
        if args.api == "worker":
            body = {"key": f"eval:{salt}:{sc['id']}" if args.fresh else sc["id"],
                    "request": sc["request"]}
        else:
            body = sc["request"]

        req = urllib.request.Request(
            args.url, data=json.dumps(body).encode(),
            headers={"content-type": "application/json",
                     **({"authorization": args.auth} if args.auth else {})},
            method="POST")
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = json.loads(r.read())
                source = r.headers.get("x-decide-source", "?")
        except Exception as e:  # noqa: BLE001 — report the scenario, keep going
            print(f"── {sc['id']}: FAILED — {e}")
            results.append({"id": sc["id"], "error": str(e)})
            continue
        ms = (time.perf_counter() - t0) * 1000

        res = find_answers(raw)
        if not res:
            print(f"── {sc['id']}: no answers in response {list(raw)[:6]}")
            results.append({"id": sc["id"], "error": "no-answers", "keys": list(raw)[:6]})
            continue

        pick = res["answers"].get("pick", {})
        probs = pick.get("probabilities") or {}
        if not probs and pick.get("choice"):
            probs = {pick["choice"]: pick.get("confidence", 0.5)}
        if not probs:
            print(f"── {sc['id']}: pick carried no probabilities")
            results.append({"id": sc["id"], "error": "no-probabilities"})
            continue

        ranked = sorted(probs.items(), key=lambda kv: -kv[1])
        top_alias, top_p = ranked[0]
        conf = float(pick.get("confidence", 0))
        n = sc["options"]
        verdict = gate(conf, top_p, n)
        used += verdict == "ok"
        dev_top = sc["device"][0]["alias"]
        same = top_alias == dev_top
        agreed += same

        results.append({
            "id": sc["id"], "jev_top": top_alias, "device_top": dev_top,
            "agree": same, "top_p": round(top_p, 4), "confidence": conf,
            "lift": round(top_p * n, 2), "gate": verdict, "ms": round(ms, 1),
            "source": source,
            "effort": res["answers"].get("effort", {}).get("score"),
            "needs_variety": res["answers"].get("needs_variety", {}).get("noul"),
            "probabilities": probs,
        })
        mark = "=" if same else "≠"
        print(f"── {sc['id']:<18} Jev → {sc['legend'].get(top_alias, top_alias):28s} "
              f"p={top_p:.2f} conf={conf:.2f} lift={top_p * n:.2f} gate={verdict} "
              f"({ms:.0f} ms, {source})")
        print(f"   device{mark} {sc['legend'].get(dev_top, dev_top)}")

    done = [r for r in results if "error" not in r]
    print("\n" + "=" * 64)
    print(f"answered           : {len(done)}/{len(scenarios)}")
    if done:
        print(f"gate would USE     : {used}/{len(done)}")
        print(f"agrees with device : {agreed}/{len(done)}")
        lat = sorted(r["ms"] for r in done)
        print(f"median latency     : {lat[len(lat) // 2]:.0f} ms")
    json.dump({"api": args.api, "url": args.url, "results": results}, open(args.out, "w"), indent=2)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
