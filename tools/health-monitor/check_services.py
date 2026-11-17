#!/usr/bin/env python3
"""
Automated Health Probe and Service Readiness Dashboard CLI.
Probes distributed services (Backend API, ML Service, Gateways) to verify
operational readiness, measure round-trip latency, and produce JSON metrics or ASCII summaries.
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from typing import Dict, List, Optional


DEFAULT_TARGETS = [
    {"name": "Backend API", "url": "http://127.0.0.1:5000/api/health", "timeout": 2.0},
    {"name": "ML Service Engine", "url": "http://127.0.0.1:8000/health", "timeout": 2.0},
    {"name": "Web Gateway", "url": "http://127.0.0.1:3000/health", "timeout": 2.0},
]


def probe_service(name: str, url: str, timeout: float = 2.0) -> Dict[str, Optional[object]]:
    start_time = time.perf_counter()
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "TruxifyHealthProbe/1.0", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
            status_code = response.getcode()
            body = response.read().decode("utf-8", errors="replace")
            try:
                parsed_body = json.loads(body)
            except Exception:
                parsed_body = {"raw": body[:100]}

            return {
                "name": name,
                "url": url,
                "status": "UP" if status_code == 200 else "DEGRADED",
                "status_code": status_code,
                "latency_ms": latency_ms,
                "error": None,
                "details": parsed_body,
            }
    except urllib.error.HTTPError as e:
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "name": name,
            "url": url,
            "status": "DEGRADED",
            "status_code": e.code,
            "latency_ms": latency_ms,
            "error": str(e),
            "details": None,
        }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "name": name,
            "url": url,
            "status": "DOWN",
            "status_code": 0,
            "latency_ms": latency_ms,
            "error": str(exc),
            "details": None,
        }


def run_health_checks(targets: List[Dict[str, object]]) -> Dict[str, object]:
    results = []
    up_count = 0

    for target in targets:
        name = str(target.get("name", "Service"))
        url = str(target.get("url", ""))
        timeout = float(target.get("timeout", 2.0))
        res = probe_service(name, url, timeout=timeout)
        results.append(res)
        if res["status"] == "UP":
            up_count += 1

    total = len(results)
    if up_count == total and total > 0:
        system_status = "HEALTHY"
    elif up_count > 0:
        system_status = "DEGRADED"
    else:
        system_status = "CRITICAL"

    return {
        "timestamp": time.time(),
        "system_status": system_status,
        "services_total": total,
        "services_up": up_count,
        "services": results,
    }


def format_ascii_dashboard(report: Dict[str, object]) -> str:
    lines = [
        "=" * 64,
        f" TRUXIFY PLATFORM HEALTH READINESS DASHBOARD - [{report['system_status']}]",
        "=" * 64,
        f"Services Checked: {report['services_total']} | Operational: {report['services_up']}/{report['services_total']}",
        "-" * 64,
        f"{'Service Name':<22} | {'Status':<10} | {'Latency':<10} | {'Details':<14}",
        "-" * 64,
    ]
    for svc in report["services"]:
        name = svc["name"][:20]
        st = svc["status"]
        lat = f"{svc['latency_ms']}ms" if svc["latency_ms"] is not None else "N/A"
        detail = f"HTTP {svc['status_code']}" if svc["status_code"] else (svc["error"] or "Error")[:14]
        lines.append(f"{name:<22} | {st:<10} | {lat:<10} | {detail:<14}")
    lines.append("=" * 64)
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe microservices and display readiness dashboard.")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of ASCII dashboard")
    parser.add_argument("--url", help="Probe a specific single endpoint URL")
    args = parser.parse_args()

    targets = [{"name": "Custom Endpoint", "url": args.url, "timeout": 2.0}] if args.url else DEFAULT_TARGETS
    report = run_health_checks(targets)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(format_ascii_dashboard(report))

    return 0 if report["system_status"] in ["HEALTHY", "DEGRADED"] else 1


if __name__ == "__main__":
    sys.exit(main())
