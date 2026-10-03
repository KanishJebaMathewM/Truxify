import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from loader import eBPFMonitor


class TestEBPFMonitorMetrics(unittest.TestCase):
    def setUp(self):
        self.monitor = eBPFMonitor(MagicMock())

    @patch('loader.psutil.process_iter')
    @patch('loader.psutil.pids')
    @patch('loader.psutil.net_connections')
    @patch('loader.psutil.net_io_counters')
    @patch('loader.psutil.virtual_memory')
    @patch('loader.psutil.cpu_times_percent')
    def test_system_metrics_use_live_host_data(
        self,
        cpu_times_percent,
        virtual_memory,
        net_io_counters,
        net_connections,
        pids,
        process_iter,
    ):
        cpu_times_percent.return_value = SimpleNamespace(
            user=21.5,
            system=8.25,
            idle=70.25,
        )
        virtual_memory.return_value = SimpleNamespace(
            total=16 * 1024 * 1024 * 1024,
            used=7 * 1024 * 1024 * 1024,
            available=8 * 1024 * 1024 * 1024,
            cached=2 * 1024 * 1024 * 1024,
        )
        net_io_counters.return_value = SimpleNamespace(
            bytes_recv=123456,
            bytes_sent=654321,
            packets_recv=111,
            packets_sent=222,
        )
        net_connections.return_value = [object(), object(), object()]
        pids.return_value = [101, 102, 103, 104]
        process_iter.return_value = [
            SimpleNamespace(info={'status': 'running'}),
            SimpleNamespace(info={'status': 'sleeping'}),
            SimpleNamespace(info={'status': 'sleeping'}),
            SimpleNamespace(info={'status': 'zombie'}),
        ]

        metrics = self.monitor.get_system_metrics()

        self.assertEqual(metrics['cpu'], {
            'usage': 29.75,
            'user': 21.5,
            'system': 8.25,
            'idle': 70.25,
        })
        self.assertEqual(metrics['memory'], {
            'total': 16384.0,
            'used': 7168.0,
            'free': 8192.0,
            'cache': 2048.0,
        })
        self.assertEqual(metrics['network'], {
            'bytes_in': 123456,
            'bytes_out': 654321,
            'connections': 3,
            'packets': 333,
        })
        self.assertEqual(metrics['processes'], {
            'total': 4,
            'running': 1,
            'sleeping': 2,
            'zombie': 1,
        })

        cpu_times_percent.assert_called_once_with(interval=0.1)
        virtual_memory.assert_called_once_with()
        net_io_counters.assert_called_once_with()
        net_connections.assert_called_once_with(kind='inet')
        pids.assert_called_once_with()
        process_iter.assert_called_once_with(['status'])

    @patch('loader.psutil.net_connections', side_effect=__import__('loader').psutil.AccessDenied())
    @patch('loader.psutil.net_io_counters')
    def test_network_metrics_degrade_without_connection_permissions(
        self,
        net_io_counters,
        net_connections,
    ):
        net_io_counters.return_value = SimpleNamespace(
            bytes_recv=10,
            bytes_sent=20,
            packets_recv=3,
            packets_sent=4,
        )

        metrics = self.monitor._get_network_metrics()

        self.assertEqual(metrics, {
            'bytes_in': 10,
            'bytes_out': 20,
            'connections': 0,
            'packets': 7,
        })
        net_connections.assert_called_once_with(kind='inet')


if __name__ == '__main__':
    unittest.main()
