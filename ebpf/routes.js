import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit';
import logger from '../../api/src/middleware/logger.js';

const execAsync = promisify(exec);
const router = express.Router();

// ============ Rate Limiters ============

// Rate limiter for load/unload endpoints (strict)
const ebpfActionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per 15 minutes
    message: {
        success: false,
        error: 'Too many eBPF operations. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for metrics endpoints (moderate)
const ebpfMetricsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: {
        success: false,
        error: 'Too many metrics requests. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// ============ System Metrics ============

// System metrics
router.get('/ebpf/metrics', ebpfMetricsLimiter, async (req, res) => {
    try {
        // In production: get metrics from eBPF
        const metrics = {
            cpu: {
                usage: 45.5,
                user: 30.2,
                system: 15.3
            },
            memory: {
                total: 16384,
                used: 8192,
                free: 8192
            },
            network: {
                bytes_in: 1024 * 1024,
                bytes_out: 512 * 1024,
                connections: 42
            },
            processes: {
                total: 120,
                running: 5,
                sleeping: 100
            }
        };
        
        res.json({
            success: true,
            data: metrics,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Metrics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System calls
router.get('/ebpf/syscalls', ebpfMetricsLimiter, async (req, res) => {
    try {
        // In production: read from BPF map
        const syscalls = {
            read: 1000,
            write: 800,
            open: 200,
            close: 150,
            mmap: 50,
            fork: 30,
            exec: 20
        };
        
        res.json({
            success: true,
            data: syscalls,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Syscalls error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Network stats
router.get('/ebpf/network', ebpfMetricsLimiter, async (req, res) => {
    try {
        // In production: read from BPF map
        const network = {
            tcp_connections: 42,
            udp_packets: 1200,
            bytes_transferred: 1024 * 1024,
            active_connections: 15
        };
        
        res.json({
            success: true,
            data: network,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Network error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Security events
router.get('/ebpf/security', ebpfMetricsLimiter, async (req, res) => {
    try {
        const events = [
            {
                type: 'file_access',
                file: '/etc/passwd',
                pid: 1234,
                timestamp: new Date().toISOString()
            },
            {
                type: 'process_exec',
                command: '/bin/bash',
                pid: 5678,
                timestamp: new Date().toISOString()
            }
        ];
        
        res.json({
            success: true,
            data: events,
            count: events.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Security error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Performance profile
router.get('/ebpf/profile', ebpfMetricsLimiter, async (req, res) => {
    try {
        const profile = {
            syscalls: {
                read: 1000,
                write: 800,
                open: 200
            },
            network: {
                tcp_connections: 42,
                udp_packets: 1200
            },
            memory: {
                page_allocations: 500,
                page_faults: 100
            }
        };
        
        res.json({
            success: true,
            data: profile,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ eBPF Load/Unload with Rate Limiting ============

// Load eBPF programs (with rate limiting)
router.post('/ebpf/load', ebpfActionLimiter, async (req, res) => {
    try {
        // Validate request
        const { program } = req.body;
        if (!program) {
            return res.status(400).json({
                success: false,
                error: 'program name required'
            });
        }

        // Validate program name (security: prevent command injection)
        const allowedPrograms = ['trace_syscalls', 'trace_network', 'trace_security'];
        if (!allowedPrograms.includes(program)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid program name'
            });
        }

        // Execute with sanitized input
        const result = await execAsync(`sudo bpftool prog load /ebpf/programs/${program}.o /sys/fs/bpf/truxify_${program}`);
        
        res.json({
            success: true,
            message: `eBPF program ${program} loaded`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Load error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Unload eBPF programs (with rate limiting)
router.post('/ebpf/unload', ebpfActionLimiter, async (req, res) => {
    try {
        // Validate request
        const { program } = req.body;
        if (!program) {
            return res.status(400).json({
                success: false,
                error: 'program name required'
            });
        }

        // Validate program name (security: prevent command injection)
        const allowedPrograms = ['trace_syscalls', 'trace_network', 'trace_security'];
        if (!allowedPrograms.includes(program)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid program name'
            });
        }

        // Execute with sanitized input
        await execAsync(`sudo rm -f /sys/fs/bpf/truxify_${program}`);
        
        res.json({
            success: true,
            message: `eBPF program ${program} unloaded`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Unload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Unload all eBPF programs (with rate limiting)
router.post('/ebpf/unload-all', ebpfActionLimiter, async (req, res) => {
    try {
        await execAsync('sudo rm -f /sys/fs/bpf/truxify_*');
        
        res.json({
            success: true,
            message: 'All eBPF programs unloaded',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Unload all error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;