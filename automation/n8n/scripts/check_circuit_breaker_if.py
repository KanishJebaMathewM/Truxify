#!/usr/bin/env python3
"""Regression check for Truxify circuit_breaker.json (issue #11499).

n8n workflows ship no unit-test framework, so this is a static validation
that the financially-critical "If Anomaly > Threshold" IF node actually has a
usable boolean condition operation. Without it, the emergency pause never trips.

Usage: python automation/n8n/scripts/check_circuit_breaker_if.py
Exits non-zero if the operation is missing/invalid.
"""
import json
import os
import sys

WORKFLOW = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "workflows",
    "circuit_breaker.json",
)

VALID_BOOLEAN_OPS = {"equal", "notEqual"}


def main() -> int:
    with open(WORKFLOW, "r", encoding="utf-8") as fh:
        workflow = json.load(fh)

    if_node = next(
        (n for n in workflow.get("nodes", []) if n.get("name") == "If Anomaly > Threshold"),
        None,
    )
    if if_node is None:
        print("FAIL: 'If Anomaly > Threshold' node not found")
        return 1

    conditions = if_node.get("parameters", {}).get("conditions", {})
    booleans = conditions.get("boolean", [])
    if not booleans:
        print("FAIL: no boolean conditions on IF node")
        return 1

    ok = True
    for i, cond in enumerate(booleans):
        op = cond.get("operation")
        if not op or op not in VALID_BOOLEAN_OPS:
            print(f"FAIL: boolean condition #{i} missing/invalid operation: {op!r}")
            ok = False
        else:
            print(f"OK: boolean condition #{i} operation = {op!r}")

    if not ok:
        return 1

    print("PASS: circuit breaker IF node has a valid operation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
