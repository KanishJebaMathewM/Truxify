"""
Structural regression validator for oracle_sync.json (issue #11552).

n8n has no built-in unit-test framework, so this script loads the workflow JSON
and asserts, at the structural level, that the fix for the gas oracle is present:

  (a) The "Compute Idempotency & Format" Code node contains the hex-validation
      guard (regex /^0x[0-9a-fA-F]+$/) and the isFinite(gasGwei) check, so an
      invalid/null JSON-RPC `result` can never emit a NaN gasGwei.
  (b) An "IF" node ("Gas Result Valid?") exists and routes the invalid branch
      (false output) away from the DB/API writer ("Sync Gas Price") to an
      error-alert sink ("Alert: Invalid Gas Result").

Run: python automation/n8n/validate_oracle_sync.py
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKFLOW_PATH = os.path.join(HERE, "workflows", "oracle_sync.json")

HEX_GUARD_RE = re.compile(r"/\^0x\[0-9a-fA-F\]\+\$/")
IS_FINITE_RE = re.compile(r"isFinite\s*\(\s*gasGwei\s*\)")


def fail(msg):
    print("FAIL: " + msg)
    sys.exit(1)


def main():
    with open(WORKFLOW_PATH, "r", encoding="utf-8") as fh:
        workflow = json.load(fh)

    nodes = workflow.get("nodes", [])
    connections = workflow.get("connections", {})

    # --- (a) Code node guard + isFinite check ---
    code_node = next((n for n in nodes if n.get("name") == "Compute Idempotency & Format"), None)
    if code_node is None:
        fail('Could not find "Compute Idempotency & Format" node in oracle_sync.json')

    js_code = code_node.get("parameters", {}).get("jsCode", "")
    if not HEX_GUARD_RE.search(js_code):
        fail('Code node missing hex-validation guard /^0x[0-9a-fA-F]+$/')
    if not IS_FINITE_RE.search(js_code):
        fail('Code node missing isFinite(gasGwei) check after parseInt')

    # --- (b) IF node routing invalid results away from DB writer ---
    if_node = next((n for n in nodes if n.get("type") == "n8n-nodes-base.if"), None)
    if if_node is None:
        fail('No "IF" node present to route invalid gas results')

    if_conns = connections.get(if_node.get("name"))
    if not if_conns:
        fail('IF node "%s" has no outgoing connections' % if_node.get("name"))

    main_outputs = if_conns.get("main", [])
    # n8n IF node: index 0 = true output, index 1 = false/invalid output.
    if len(main_outputs) < 2:
        fail('IF node "%s" does not expose both true (0) and false (1) outputs' % if_node.get("name"))

    true_targets = [c.get("node") for c in main_outputs[0]]
    false_targets = [c.get("node") for c in main_outputs[1]]

    writer = "Sync Gas Price"
    alert = "Alert: Invalid Gas Result"

    if writer not in true_targets:
        fail('Valid (true) branch does not feed the DB writer "%s"' % writer)
    if alert not in false_targets:
        fail('Invalid (false) branch does not feed the error alert "%s"' % alert)
    if writer in false_targets:
        fail('DB writer "%s" is reachable from the invalid branch (would corrupt records)' % writer)

    print("PASS: Code node contains hex-validation guard and isFinite check")
    print('PASS: IF node "%s" routes valid -> "%s", invalid -> "%s"'
          % (if_node.get("name"), writer, alert))
    print("\nAll oracle_sync structural validations passed.")


if __name__ == "__main__":
    main()
