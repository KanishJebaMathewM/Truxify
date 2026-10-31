import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Ensure local dir is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from check_services import (
    format_ascii_dashboard,
    probe_service,
    run_health_checks,
)


class TestHealthMonitor(unittest.TestCase):
    @patch("urllib.request.urlopen")
    def test_probe_service_up(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.getcode.return_value = 200
        mock_response.read.return_value = b'{"status": "ok"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        res = probe_service("Test Service", "http://fake-service:8080/health")
        self.assertEqual(res["status"], "UP")
        self.assertEqual(res["status_code"], 200)
        self.assertIsNotNone(res["latency_ms"])
        self.assertEqual(res["details"], {"status": "ok"})

    @patch("urllib.request.urlopen")
    def test_probe_service_down(self, mock_urlopen):
        mock_urlopen.side_effect = ConnectionRefusedError("Connection refused")

        res = probe_service("Test Service", "http://fake-service:8080/health")
        self.assertEqual(res["status"], "DOWN")
        self.assertEqual(res["status_code"], 0)
        self.assertIn("Connection refused", str(res["error"]))

    @patch("check_services.probe_service")
    def test_run_health_checks_healthy(self, mock_probe):
        mock_probe.return_value = {
            "name": "API",
            "url": "http://test",
            "status": "UP",
            "status_code": 200,
            "latency_ms": 12.5,
            "error": None,
            "details": {},
        }
        report = run_health_checks([{"name": "API", "url": "http://test"}])
        self.assertEqual(report["system_status"], "HEALTHY")
        self.assertEqual(report["services_up"], 1)

    def test_format_ascii_dashboard(self):
        report = {
            "system_status": "HEALTHY",
            "services_total": 1,
            "services_up": 1,
            "services": [
                {
                    "name": "Backend API",
                    "status": "UP",
                    "status_code": 200,
                    "latency_ms": 15.0,
                    "error": None,
                }
            ],
        }
        text = format_ascii_dashboard(report)
        self.assertIn("TRUXIFY PLATFORM HEALTH READINESS DASHBOARD", text)
        self.assertIn("Backend API", text)
        self.assertIn("UP", text)


if __name__ == "__main__":
    unittest.main()
