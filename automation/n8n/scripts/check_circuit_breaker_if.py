
#!/usr/bin/env python3
"""
Regression checks for Truxify circuit_breaker.json (issue #11499).

Validates that the financially-critical "If Anomaly > Threshold" IF node:

1. Exists exactly once.
2. Is an n8n IF node.
3. Contains at least one boolean condition.
4. Uses an explicitly supported boolean operation.
5. Has usable comparison operands.
6. Has a connected TRUE output (the emergency-pause path).
7. Optionally reaches an expected emergency-pause node.

The script is intentionally dependency-free.

Usage:
    python automation/n8n/scripts/check_circuit_breaker_if.py

Optional:
    EXPECTED_PAUSE_NODE="Pause Trading" \
        python automation/n8n/scripts/check_circuit_breaker_if.py

Exit codes:
    0 = all checks passed
    1 = workflow validation failed
    2 = workflow file or JSON could not be loaded
"""

from __future__ import annotations

import json
import os
import sys

from collections import deque
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent

WORKFLOW = (
    Path(os.environ["CIRCUIT_BREAKER_WORKFLOW"])
    if os.environ.get("CIRCUIT_BREAKER_WORKFLOW")
    else SCRIPT_DIR.parent / "workflows" / "circuit_breaker.json"
)

IF_NODE_NAME = "If Anomaly > Threshold"
IF_NODE_TYPE = "n8n-nodes-base.if"

# Keep this allowlist deliberately narrow.
VALID_BOOLEAN_OPS = frozenset({
    "equal",
    "notEqual",
})

EXPECTED_PAUSE_NODE = os.environ.get("EXPECTED_PAUSE_NODE", "").strip()


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

class ValidationError(Exception):
    """Raised when the workflow does not satisfy a regression check."""


def fail(message: str) -> None:
    raise ValidationError(message)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_workflow(path: Path) -> dict[str, Any]:
    """Load and validate the basic workflow JSON structure."""

    if not path.is_file():
        raise FileNotFoundError(f"Workflow file not found: {path}")

    try:
        with path.open("r", encoding="utf-8") as file:
            workflow = json.load(file)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Invalid workflow JSON at line {exc.lineno}, "
            f"column {exc.colno}: {exc.msg}"
        ) from exc

    check(
        isinstance(workflow, dict),
        "Workflow root must be a JSON object",
    )

    check(
        isinstance(workflow.get("nodes"), list),
        "Workflow must contain a nodes array",
    )

    check(
        isinstance(workflow.get("connections"), dict),
        "Workflow must contain a connections object",
    )

    return workflow


def find_if_node(workflow: dict[str, Any]) -> dict[str, Any]:
    """Find exactly one target IF node."""

    matches = [
        node
        for node in workflow["nodes"]
        if isinstance(node, dict)
        and node.get("name") == IF_NODE_NAME
    ]

    check(
        len(matches) == 1,
        f"Expected exactly one '{IF_NODE_NAME}' node; "
        f"found {len(matches)}",
    )

    node = matches[0]

    check(
        node.get("type") == IF_NODE_TYPE,
        f"'{IF_NODE_NAME}' has unexpected node type: "
        f"{node.get('type')!r}",
    )

    return node


def validate_boolean_conditions(node: dict[str, Any]) -> int:
    """Validate boolean conditions and their comparison operands."""

    parameters = node.get("parameters")

    check(
        isinstance(parameters, dict),
        "IF node parameters must be an object",
    )

    conditions = parameters.get("conditions")

    check(
        isinstance(conditions, dict),
        "IF node conditions must be an object",
    )

    booleans = conditions.get("boolean")

    check(
        isinstance(booleans, list) and len(booleans) > 0,
        "No boolean conditions configured on IF node",
    )

    for index, condition in enumerate(booleans):
        prefix = f"Boolean condition #{index}"

        check(
            isinstance(condition, dict),
            f"{prefix} must be a JSON object",
        )

        operation = condition.get("operation")

        check(
            isinstance(operation, str)
            and operation in VALID_BOOLEAN_OPS,
            f"{prefix} has missing or unsupported operation: "
            f"{operation!r}",
        )

        # Support the common n8n comparison operand field names.
        # Both operands are required for equal/notEqual comparisons.
        left = condition.get(
            "value1",
            condition.get("leftValue"),
        )

        right = condition.get(
            "value2",
            condition.get("rightValue"),
        )

        check(
            left is not None and left != "",
            f"{prefix} is missing its left comparison operand",
        )

        check(
            right is not None and right != "",
            f"{prefix} is missing its right comparison operand",
        )

        print(
            f"OK: {prefix}: operation={operation!r}, "
            "comparison operands present"
        )

    return len(booleans)


# ---------------------------------------------------------------------------
# Connection validation
# ---------------------------------------------------------------------------

def get_true_branch_connections(
    workflow: dict[str, Any],
    node: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Get the IF node's TRUE output connections.

    In n8n IF nodes:
      main[0] = TRUE output
      main[1] = FALSE output
    """

    connections = workflow["connections"].get(node["name"])

    check(
        isinstance(connections, dict),
        f"No connections configured for '{IF_NODE_NAME}'",
    )

    main = connections.get("main")

    check(
        isinstance(main, list) and len(main) >= 1,
        f"'{IF_NODE_NAME}' has no TRUE output connection definition",
    )

    true_connections = main[0]

    check(
        isinstance(true_connections, list)
        and len(true_connections) > 0,
        "Emergency-pause TRUE branch has no outgoing connections",
    )

    for connection in true_connections:
        check(
            isinstance(connection, dict)
            and isinstance(connection.get("node"), str)
            and connection["node"].strip(),
            "TRUE branch contains an invalid node connection",
        )

    return true_connections


def reachable_nodes(
    workflow: dict[str, Any],
    starting_connections: list[dict[str, Any]],
) -> set[str]:
    """Find nodes reachable through outgoing main connections."""

    visited: set[str] = set()
    queue = deque(
        connection["node"]
        for connection in starting_connections
    )

    while queue:
        node_name = queue.popleft()

        if node_name in visited:
            continue

        visited.add(node_name)

        node_connections = workflow["connections"].get(
            node_name,
            {},
        )

        if not isinstance(node_connections, dict):
            continue

        for output_group in node_connections.values():
            if not isinstance(output_group, list):
                continue

            for output in output_group:
                if not isinstance(output, list):
                    continue

                for connection in output:
                    if not isinstance(connection, dict):
                        continue

                    target = connection.get("node")

                    if isinstance(target, str) and target:
                        if target not in visited:
                            queue.append(target)

    return visited


def validate_emergency_pause_path(
    workflow: dict[str, Any],
    true_connections: list[dict[str, Any]],
) -> None:
    """Validate the TRUE branch and optionally its expected destination."""

    direct_targets = {
        connection["node"]
        for connection in true_connections
    }

    print(
        "OK: emergency-pause TRUE branch connected to: "
        + ", ".join(sorted(direct_targets))
    )

    if not EXPECTED_PAUSE_NODE:
        return

    reachable = reachable_nodes(workflow, true_connections)

    check(
        EXPECTED_PAUSE_NODE in reachable,
        f"Expected emergency-pause node "
        f"{EXPECTED_PAUSE_NODE!r} is not reachable from the TRUE branch",
    )

    print(
        f"OK: expected emergency-pause node "
        f"{EXPECTED_PAUSE_NODE!r} is reachable"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("Checking Truxify circuit breaker workflow...")
    print(f"Workflow: {WORKFLOW}")

    try:
        workflow = load_workflow(WORKFLOW)

        if_node = find_if_node(workflow)
        print(f"OK: found '{IF_NODE_NAME}'")

        condition_count = validate_boolean_conditions(if_node)

        true_connections = get_true_branch_connections(
            workflow,
            if_node,
        )

        validate_emergency_pause_path(
            workflow,
            true_connections,
        )

        print()
        print("PASS: circuit breaker regression checks passed")
        print(f"      Boolean conditions: {condition_count}")
        print(f"      TRUE branch targets: {len(true_connections)}")

        return 0

    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    except ValidationError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    except OSError as exc:
        print(f"ERROR: unable to read workflow: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
