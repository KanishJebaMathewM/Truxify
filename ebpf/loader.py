import os
import subprocess
import json
import redis
import logging
import struct
import threading
from typing import Dict, List, Any, Optional
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
        self._pruner_thread = None
        self._pruner_stop = threading.Event()
        
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
        """Load eBPF program into kernel and pin it to the BPF filesystem"""
        program_name = os.path.basename(object_file).replace('.o', '')
        pin_path = f"/sys/fs/bpf/truxify_{program_name}"

        try:
            # Load the object to a unique per-program path. Sharing a single
            # /sys/fs/bpf/truxify path makes the second load fail with
            # "File exists" before pinning even starts.
            load_path = f"{pin_path}.load"
            cmd = ["sudo", "bpftool", "prog", "load", object_file, load_path]
            subprocess.run(cmd, check=True, capture_output=True)

            # bpftool prog pin id takes the numeric kernel program id, not the
            # program name. Resolve it from `bpftool prog list` for this object.
            prog_id = self._resolve_prog_id(load_path)
            if prog_id is None:
                raise RuntimeError(f"could not resolve kernel id for {program_name}")

            cmd = ["sudo", "bpftool", "prog", "pin", "id", str(prog_id), pin_path]
            subprocess.run(cmd, check=True, capture_output=True)
            subprocess.run(["sudo", "rm", "-f", load_path], check=True, capture_output=True)

            self.loaded_programs.append(pin_path)
            logger.info(f"✅ Loaded: {program_name} (id {prog_id}, {pin_path})")
            return True

        except Exception as e:
            logger.error(f"Loading failed for {program_name}: {e}")
            raise

    def _resolve_prog_id(self, pinned_path: str) -> Any:
        """Resolve the numeric kernel id of the program pinned at pinned_path."""
        try:
            result = subprocess.run(
                ["sudo", "bpftool", "prog", "list", "--json"],
                check=True, capture_output=True, text=True
            )
            for prog in json.loads(result.stdout):
                pinned = prog.get("pinned") or []
                if isinstance(pinned, str):
                    pinned = [pinned]
                if pinned_path in pinned:
                    return prog.get("id")
        except Exception as e:
            logger.error(f"Resolving program id failed for {pinned_path}: {e}")
        return None
    
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
    
    def trace_events(self, event_type: str, duration: int = 10) -> List[Dict]:
        """Trace events for duration"""
        events = []
        
        # Read from perf event array
        # In production: use bpf_tool to read events
        
        return events
    
    def get_stats(self) -> Dict:
        """Get eBPF statistics"""
        stats = {
            'loaded_programs': self.loaded_programs,
            'total_events': 0,
            'syscalls': {},
            'network': {},
            'security': {}
        }
        
        # Get syscall counts
        # In production: read from BPF maps
        
        return stats
    
    def _extract_last_time_ns(self, value: Any) -> Optional[int]:
        """Extract last_time_ns from a telemetry_rate_map entry value.
        With BTF the value is a dict; without it the value is a raw little-
        endian byte array where last_time_ns (u64) sits at offset 4 after the
        leading __u32 lock field."""
        if isinstance(value, dict):
            return value.get("last_time_ns")
        if isinstance(value, list):
            try:
                raw = bytes(value)
                if len(raw) < 12:
                    return None
                return struct.unpack_from("<Q", raw, 4)[0]
            except (struct.error, TypeError):
                return None
        return None

    def _extract_last_seen_ns(self, value: Any) -> Optional[int]:
        """Extract last_seen from a network_monitor rate_limit entry value.
        With BTF the value is a dict; without it the value is a raw little-
        endian byte array where last_seen (u64) sits at offset 8 after the
        leading __u32 lock field and its 4 bytes of padding."""
        if isinstance(value, dict):
            return value.get("last_seen")
        if isinstance(value, list):
            try:
                raw = bytes(value)
                if len(raw) < 16:
                    return None
                return struct.unpack_from("<Q", raw, 8)[0]
            except (struct.error, TypeError):
                return None
        return None

    def _prune_bpftool_map(self, map_name: str, extract_ts, idle_ns: int, now_ns: int) -> int:
        """Delete every entry of *map_name* idle past idle_ns. Returns the
        number of entries pruned. Shared by the telemetry and network-monitor
        rate-limit maps so both are bounded by a time window."""
        pruned = 0
        try:
            dump = subprocess.run(
                ["sudo", "bpftool", "map", "dump", "name", map_name],
                check=True, capture_output=True, text=True
            )
            for entry in json.loads(dump.stdout):
                key = entry.get("key")
                last_ts = extract_ts(entry.get("value"))
                if key is None or last_ts is None:
                    continue
                if now_ns - last_ts <= idle_ns:
                    continue
                key_hex = bytes(key).hex()
                subprocess.run(
                    ["sudo", "bpftool", "map", "delete", "name", map_name,
                     "key", key_hex],
                    check=True, capture_output=True, text=True
                )
                pruned += 1
        except Exception as e:
            logger.warning(f"Rate-limit map '{map_name}' prune failed: {e}")
        return pruned

    def prune_rate_limit_entries(self, idle_window_seconds: int = 60) -> int:
        """Delete telemetry_rate_map entries idle past the rate-limit window.
        Called periodically so the per-IP map never fills with stale sources
        (LRU_HASH bounds memory as a backstop, this keeps it healthy in
        normal operation). Returns the number of entries pruned."""
        if idle_window_seconds <= 0:
            raise ValueError("idle_window_seconds must be positive")
        idle_ns = idle_window_seconds * 1_000_000_000
        now_ns = time.time_ns()
        pruned = 0
        try:
            dump = subprocess.run(
                ["sudo", "bpftool", "map", "dump", "name", "telemetry_rate_map"],
                check=True, capture_output=True, text=True
            )
            for entry in json.loads(dump.stdout):
                key = entry.get("key")
                last_time_ns = self._extract_last_time_ns(entry.get("value"))
                if key is None or last_time_ns is None:
                    continue
                if now_ns - last_time_ns <= idle_ns:
                    continue
                key_hex = bytes(key).hex()
                subprocess.run(
                    ["sudo", "bpftool", "map", "delete", "name", "telemetry_rate_map",
                     "key", key_hex],
                    check=True, capture_output=True, text=True
                )
                pruned += 1
        except Exception as e:
            logger.warning(f"Rate-limit map prune failed: {e}")
        return pruned

    def prune_network_rate_limit_entries(self, idle_window_seconds: int = 60) -> int:
        """Delete network_monitor rate_limit entries (keyed on daddr:dport)
        idle past the rate-limit window. Same windowed decay as the telemetry
        map, so per-destination counters reset instead of saturating."""
        if idle_window_seconds <= 0:
            raise ValueError("idle_window_seconds must be positive")
        idle_ns = idle_window_seconds * 1_000_000_000
        now_ns = time.time_ns()
        return self._prune_bpftool_map(
            "rate_limit", self._extract_last_seen_ns, idle_ns, now_ns
        )
    
    def start_rate_limit_pruner(self, interval_seconds: int = 60, idle_window_seconds: int = 60):
        """Start a periodic userspace sweep of telemetry_rate_map. Entries idle
        past idle_window_seconds are deleted every interval_seconds."""
        if self._pruner_thread and self._pruner_thread.is_alive():
            return
        self._pruner_stop.clear()
        self._pruner_thread = threading.Thread(
            target=self._rate_limit_pruner_loop,
            args=(interval_seconds, idle_window_seconds),
            daemon=True
        )
        self._pruner_thread.start()
        logger.info("✅ Rate-limit map pruner started")
    
    def stop_rate_limit_pruner(self):
        """Stop the periodic telemetry_rate_map sweep."""
        self._pruner_stop.set()
        if self._pruner_thread:
            self._pruner_thread.join(timeout=5)
            self._pruner_thread = None
        logger.info("✅ Rate-limit map pruner stopped")
    
    def _rate_limit_pruner_loop(self, interval_seconds: int, idle_window_seconds: int):
        while not self._pruner_stop.wait(interval_seconds):
            self.prune_rate_limit_entries(idle_window_seconds)
            self.prune_network_rate_limit_entries(idle_window_seconds)
    
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
            
            # Compile
            object_file = self.compile_program(program_path)
            
            # Load
            success = self.load_program(object_file)
            results[program] = success
        
        return results
    
    def cleanup(self):
        """Remove pinned eBPF programs and any legacy shared pin path."""
        for pin_path in self.loaded_programs:
            try:
                subprocess.run(["sudo", "rm", "-f", pin_path], check=True)
                logger.info(f"✅ Cleaned up: {pin_path}")
            except Exception as e:
                logger.error(f"Cleanup failed for {pin_path}: {e}")
        
        # Remove the legacy shared pin path used by the old loader so a
        # redeploy does not collide with it.
        try:
            subprocess.run(["sudo", "rm", "-f", "/sys/fs/bpf/truxify"], check=True)
        except Exception as e:
            logger.error(f"Legacy pin cleanup failed: {e}")
        
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
        results = self.loader.load_all_programs()
        failed = [p for p, ok in results.items() if not ok]
        if failed:
            self.running = False
            raise RuntimeError(f"eBPF monitoring failed to load: {', '.join(failed)}")
        
        logger.info("✅ eBPF monitoring started")
    
    def stop_monitoring(self):
        """Stop system monitoring"""
        self.running = False
        self.loader.cleanup()
        
        logger.info("✅ eBPF monitoring stopped")
    
    def get_system_metrics(self) -> Dict:
        """Get system metrics"""
        metrics = {
            'cpu': self._get_cpu_metrics(),
            'memory': self._get_memory_metrics(),
            'network': self._get_network_metrics(),
            'processes': self._get_process_metrics()
        }
        
        return metrics
    
    def _get_cpu_metrics(self) -> Dict:
        """Get CPU metrics"""
        # In production: read from BPF maps
        return {
            'usage': 45.5,
            'user': 30.2,
            'system': 15.3,
            'idle': 54.5
        }
    
    def _get_memory_metrics(self) -> Dict:
        """Get memory metrics"""
        return {
            'total': 16384,  # MB
            'used': 8192,
            'free': 8192,
            'cache': 2048
        }
    
    def _get_network_metrics(self) -> Dict:
        """Get network metrics"""
        return {
            'bytes_in': 1024 * 1024,
            'bytes_out': 512 * 1024,
            'connections': 42,
            'packets': 1000
        }
    
    def _get_process_metrics(self) -> Dict:
        """Get process metrics"""
        return {
            'total': 120,
            'running': 5,
            'sleeping': 100,
            'zombie': 1
        }
    
    def get_security_events(self, limit: int = 100) -> List[Dict]:
        """Get security events"""
        events = []
        
        # Read security events from BPF map
        # In production: read from perf event array
        
        return events
    
    def get_performance_profile(self) -> Dict:
        """Get performance profile"""
        return {
            'syscalls': self._get_syscall_profile(),
            'network': self._get_network_profile(),
            'memory': self._get_memory_profile()
        }
    
    def _get_syscall_profile(self) -> Dict:
        """Get syscall profile"""
        # In production: read from syscall_counts map
        return {
            'read': 1000,
            'write': 800,
            'open': 200,
            'close': 150,
            'mmap': 50
        }
    
    def _get_network_profile(self) -> Dict:
        """Get network profile"""
        return {
            'tcp_connections': 42,
            'udp_packets': 1200,
            'bytes_transferred': 1024 * 1024
        }
    
    def _get_memory_profile(self) -> Dict:
        """Get memory profile"""
        return {
            'page_allocations': 500,
            'page_faults': 100,
            'swap_usage': 256
        }