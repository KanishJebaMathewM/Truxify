import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Node.js loader script attaching eBPF socket filter (SO_ATTACH_BPF)
 */
export class EbpfSocketLoader {
  constructor(options = {}) {
    this.objPath = options.objPath || path.join(__dirname, 'socket_buffer_filter.o');
    this.trustedPort = options.trustedPort || 0;
  }

  /**
   * Attach eBPF program to a socket using bpftool
   * @param {number} socketFd - File descriptor of the socket
   * @returns {Promise<boolean>} True if attachment succeeded
   */
  async attachToSocket(socketFd) {
    if (!fs.existsSync(this.objPath)) {
      throw new Error(`eBPF object file not found: ${this.objPath}. Run build step first.`);
    }

    // Check if bpftool is available
    const bpftoolAvailable = await this._checkBpftool();
    if (!bpftoolAvailable) {
      throw new Error('bpftool not found in PATH. Required for eBPF program loading.');
    }

    // Load the program using bpftool
    const progId = await this._loadProgram();
    if (!progId) {
      throw new Error('Failed to load eBPF program via bpftool');
    }

    // Attach to socket
    const attached = await this._attachToSocket(socketFd, progId);
    if (!attached) {
      throw new Error(`Failed to attach eBPF program ${progId} to socket ${socketFd}`);
    }

    // Configure trusted port if set
    if (this.trustedPort !== 0) {
      await this._setTrustedPort(progId);
    }

    console.log(`[eBPF Socket Loader] Successfully attached program ${progId} to socket ${socketFd}`);
    return true;
  }

  async _checkBpftool() {
    return new Promise((resolve) => {
      const child = spawn('bpftool', ['version'], { stdio: 'ignore' });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  async _loadProgram() {
    return new Promise((resolve) => {
      // bpftool prog load <obj> <pin_path> type socket
      const pinPath = '/sys/fs/bpf/truxify_telemetry_filter';
      const child = spawn('bpftool', ['prog', 'load', this.objPath, pinPath, 'type', 'socket'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.on('close', (code) => {
        if (code !== 0) {
          console.error(`[eBPF Socket Loader] bpftool prog load failed: ${stdout}`);
          resolve(null);
          return;
        }
        // Parse program ID from output (e.g., "prog 1234")
        const match = stdout.match(/prog (\d+)/);
        resolve(match ? parseInt(match[1], 10) : null);
      });
    });
  }

  async _attachToSocket(socketFd, progId) {
    return new Promise((resolve) => {
      // bpftool prog attach <prog_id> /proc/self/fd/<socketFd>
      const fdPath = `/proc/self/fd/${socketFd}`;
      const child = spawn('bpftool', ['prog', 'attach', progId.toString(), fdPath], {
        stdio: 'ignore'
      });
      child.on('close', (code) => resolve(code === 0));
    });
  }

  async _setTrustedPort(progId) {
    return new Promise((resolve) => {
      // bpftool map update pinned /sys/fs/bpf/truxify_trusted_port key 0 0 8443
      const pinPath = '/sys/fs/bpf/truxify_trusted_port';
      const child = spawn('bpftool', ['map', 'update', 'pinned', pinPath, 'key', '0', '0', this.trustedPort.toString()], {
        stdio: 'ignore'
      });
      child.on('close', (code) => resolve(code === 0));
    });
  }

  /**
   * Check ring buffer for dropped events
   * @returns {Promise<{ dropped: number }>} Drop counter
   */
  async getRingBufferStats() {
    return new Promise((resolve) => {
      // bpftool map dump pinned /sys/fs/bpf/truxify_telemetry_ringbuf
      const pinPath = '/sys/fs/bpf/truxify_telemetry_ringbuf';
      const child = spawn('bpftool', ['map', 'dump', 'pinned', pinPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.on('close', (code) => {
        if (code !== 0) {
          resolve({ dropped: -1, error: 'bpftool map dump failed' });
          return;
        }
        // Parse discarded count from output
        const match = stdout.match(/"discarded"\s*:\s*(\d+)/);
        const dropped = match ? parseInt(match[1], 10) : 0;
        resolve({ dropped });
      });
    });
  }
}

export const socketLoader = new EbpfSocketLoader();