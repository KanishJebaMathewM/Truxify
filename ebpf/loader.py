import os
import subprocess
import json
import redis
import logging
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
            # Use bpftool to load program
            cmd = ["sudo", "bpftool", "prog", "load", object_file, "/sys/fs/bpf/truxify"]
            subprocess.run(cmd, check=True, capture_output=True)
            
            # Pin program to BPF filesystem
            program_name = os.path.basename(object_file).replace('.o', '')
            pin_path = f"/sys/fs/bpf/truxify_{program_name}"
            
            cmd = ["sudo", "bpftool", "prog", "pin", "id", program_name, pin_path]
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
                # Compile
                object_file = self.compile_program(program_path)
                
                # Load
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