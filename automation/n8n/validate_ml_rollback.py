#!/usr/bin/env python3
"""Regression check for ml-rollback-workflow.json (issue #11553).

n8n has no unit-test framework, so this standalone validator asserts the
structural invariants of the fix: the rollback HTTP response status must be
checked by an IF node before any alert is sent, and a failure alert must exist
for the non-success branch.

Run: python automation/n8n/validate_ml_rollback.py
"""

import json
import sys
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parent / "ml-rollback-workflow.json"

EXPECTED_IF_NODE = "rollback-http-ok"
SUCCESS_ALERT = "send-alert"
FAILURE_ALERT = "send-failure-alert"
ROLLBACK_NODE = "execute-rollback"


def main() -> int:
    data = json.loads(WORKFLOW.read_text())
    nodes = {n["id"]: n for n in data["nodes"]}
    connections = data["connections"]

    errors = []

    if EXPECTED_IF_NODE not in nodes:
        errors.append("missing IF node '%s' that checks rollback HTTP status" % EXPECTED_IF_NODE)

    if FAILURE_ALERT not in nodes:
        errors.append("missing failure alert node '%s'" % FAILURE_ALERT)

    # Execute Rollback must NOT directly feed the success alert.
    rollback_targets = [
        c["node"]
        for branch in connections.get(ROLLBACK_NODE, {}).get("main", [])
        for c in (branch or [])
    ]
    if SUCCESS_ALERT in rollback_targets:
        errors.append("'%s' still reports success directly from '%s' (status not checked)" % (SUCCESS_ALERT, ROLLBACK_NODE))

    # The status-check IF node must feed both a success and a failure alert.
    if EXPECTED_IF_NODE in connections:
        if_node_conns = connections[EXPECTED_IF_NODE]["main"]
        true_targets = [c["node"] for c in (if_node_conns[0] or [])]
        false_targets = [c["node"] for c in (if_node_conns[1] or [])]
        if SUCCESS_ALERT not in true_targets:
            errors.append("success alert not wired to the true (2xx) branch of '%s'" % EXPECTED_IF_NODE)
        if FAILURE_ALERT not in false_targets:
            errors.append("failure alert not wired to the false (non-2xx) branch of '%s'" % EXPECTED_IF_NODE)

    if errors:
        for e in errors:
            print("FAIL: %s" % e)
        return 1

    print("PASS: ml-rollback reports real rollback result (status-checked alert branches)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
