import os
import subprocess
import json
import struct
import redis
import logging
import psutil
from typing import Dict, List, Any
from datetime import datetime
import time

logger = logging.getLogger(__name__)

class eBPFLoader:
    """Load and manage eBPF programs"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        self.programs_dir = os.path.dirname(__file__) + "/programs"
        self.loaded_programs = []
        self.stats = {}
        
        logger.info("✅ eBPF Loader initialized")
    
    def compile_program(self, program_file: str) -> str:
        """Compile eBPF program"""
        try:
            output_file = program_file.replace('.c', '.o')
            
            cmd = [
                "clang",
                "-O2",
                "-target", "bpf",
                "-D__TARGET_ARCH_x86",
                "-I/usr/include/x86_64-linux-gnu",
                "-c",
                program_file,
                "-o",
                output_file
            ]
            
            subprocess.run(cmd, check=True, capture_output=True)
            logger.info(f"✅ Compiled: {program_file}")
            return output_file
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Compilation failed: {e.stderr}")
            raise
    
    def load_program(self, object_file: str) -> bool:
        """Load eBPF program into kernel"""
        try:
            program_name = os.path.basename(object_file).replace('.o', '')
            pin_path = f"/sys/fs/bpf/truxify_{program_name}"
            cmd = ["sudo", "bpftool", "prog", "load", object_file, pin_path]
            subprocess.run(cmd, check=True, capture_output=True)

            self.loaded_programs.append(program_name)
            logger.info(f"✅ Loaded: {program_name}")
            return True

        except subprocess.CalledProcessError as e:
            logger.error(f"Loading failed: {e.stderr}")
            return False
    
    def attach_program(self, program_name: str, event: str) -> bool:
        """Attach eBPF program to event"""
        try:
            cmd = ["sudo", "bpftool", "prog", "attach", program_name, event]
            subprocess.run(cmd, check=True, capture_output=True)
            
            logger.info(f"✅ Attached: {program_name} -> {event}")
            return True
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Attachment failed: {e.stderr}")
            return False
    
    def _extract_last_time_ns(self, value) -> int | None:
        """
        Extracts last_time_ns from a rate_limit_entry struct map value.
        
        struct rate_limit_entry {
            __u32 lock;          // Offset 0..4 (4 bytes)
            // 4 bytes padding     // Offset 4..8 (4 bytes)
            __u64 last_time_ns;  // Offset 8..16 (8 bytes)
            __u32 packet_count;  // Offset 16..20 (4 bytes)
        };
        """
        raw = bytes(value)
        if len(raw) < 16:
            return None
        return struct.unpack_from("<Q", raw, 8)[0]
    
    def trace_events(self, event_type: str, duration: int = 10) -> List[Dict]:
        """Trace events for duration"""
        events = []
        return events
    
    def get_stats(self) -> Dict:
        """Get eBPF statistics"""
        return {
            'loaded_programs': self.loaded_programs,
            'total_events': 0,
            'syscalls': {},
            'network': {},
            'security': {}
        }
    
    def load_all_programs(self) -> Dict:
        """Load all eBPF programs"""
        results = {}
        programs = [
            'trace_syscalls.c',
            'trace_network.c',
            'trace_security.c'
        ]
        
        for program in programs:
            program_path = os.path.join(self.programs_dir, program)
            
            if not os.path.exists(program_path):
                logger.warning(f"Program not found: {program_path}")
                continue
            
            try:
                object_file = self.compile_program(program_path)
                success = self.load_program(object_file)
                results[program] = success
            except Exception as e:
                logger.error(f"Failed to process {program}: {e}")
                results[program] = False
        
        return results
    
    def cleanup(self):
        """Remove loaded eBPF programs"""
        for program in self.loaded_programs:
            try:
                pin_path = f"/sys/fs/bpf/truxify_{program}"
                subprocess.run(["sudo", "rm", "-f", pin_path], check=True)
                logger.info(f"✅ Cleaned up: {program}")
            except Exception as e:
                logger.error(f"Cleanup failed for {program}: {e}")
        
        self.loaded_programs = []

class eBPFMonitor:
    """eBPF-based system monitoring"""
    
    def __init__(self, loader: eBPFLoader):
        self.loader = loader
        self.running = False
        self.metrics = {}
        
        logger.info("✅ eBPF Monitor initialized")
    
    def start_monitoring(self):
        """Start system monitoring"""
        self.running = True
        self.loader.load_all_programs()
        logger.info("✅ eBPF monitoring started")
    
    def stop_monitoring(self):
        """Stop system monitoring"""
        self.running = False
        self.loader.cleanup()
        logger.info("✅ eBPF monitoring stopped")
    
    def get_system_metrics(self) -> Dict:
        """Get current host system metrics."""
        return {
            'cpu': self._get_cpu_metrics(),
            'memory': self._get_memory_metrics(),
            'network': self._get_network_metrics(),
            'processes': self._get_process_metrics()
        }
    
    def _get_cpu_metrics(self) -> Dict:
        cpu_times = psutil.cpu_times_percent(interval=0.1)
        return {
            'usage': round(100.0 - cpu_times.idle, 2),
            'user': cpu_times.user,
            'system': cpu_times.system,
            'idle': cpu_times.idle
        }
    
    def _get_memory_metrics(self) -> Dict:
        memory = psutil.virtual_memory()
        mib = 1024 * 1024
        return {
            'total': round(memory.total / mib, 2),
            'used': round(memory.used / mib, 2),
            'free': round(memory.available / mib, 2),
            'cache': round(getattr(memory, 'cached', 0) / mib, 2)
        }
    
    def _get_network_metrics(self) -> Dict:
        counters = psutil.net_io_counters()
        try:
            connections = len(psutil.net_connections(kind='inet'))
        except psutil.AccessDenied:
            connections = 0
        return {
            'bytes_in': counters.bytes_recv,
            'bytes_out': counters.bytes_sent,
            'connections': connections,
            'packets': counters.packets_recv + counters.packets_sent
        }
    
    def _get_process_metrics(self) -> Dict:
        status_counts = {
            'running': 0,
            'sleeping': 0,
            'zombie': 0
        }
        for process in psutil.process_iter(['status']):
            status = process.info.get('status')
            if status == psutil.STATUS_RUNNING:
                status_counts['running'] += 1
            elif status == psutil.STATUS_SLEEPING:
                status_counts['sleeping'] += 1
            elif status == psutil.STATUS_ZOMBIE:
                status_counts['zombie'] += 1

        return {
            'total': len(psutil.pids()),
            **status_counts
        }
    
    def get_security_events(self, limit: int = 100) -> List[Dict]:
        return []
    
    def get_performance_profile(self) -> Dict:
        return {
            'syscalls': self._get_syscall_profile(),
            'network': self._get_network_profile(),
            'memory': self._get_memory_profile()
        }
    
    def _get_syscall_profile(self) -> Dict:
        return {
            'read': 1000,
            'write': 800,
            'open': 200,
            'close': 150,
            'mmap': 50
        }
    
    def _get_network_profile(self) -> Dict:
        return {
            'tcp_connections': 42,
            'udp_packets': 1200,
            'bytes_transferred': 1024 * 1024
        }
    
    def _get_memory_profile(self) -> Dict:
        return {
            'page_allocations': 500,
            'page_faults': 100,
            'swap_usage': 256
        }
