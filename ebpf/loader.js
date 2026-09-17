import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * eBPF XDP Loader Module for Truxify Telemetry Rate Limiting
 */
export class EbpfTelemetryLoader {
  constructor(iface = 'eth0') {
    this.iface = iface;
    this.isLoaded = false;
    this.ebpfObjPath = path.join(process.cwd(), 'ebpf', 'telemetry_filter.o');
  }

  async load() {
    if (!fs.existsSync(this.ebpfObjPath)) {
      console.warn(`[eBPF Loader] Object file not found at ${this.ebpfObjPath}. Operating in user-space fallback mode.`);
      return false;
    }

    try {
      console.log(`[eBPF Loader] Attaching XDP filter to interface ${this.iface}...`);
      const child = spawn('ip', ['link', 'set', 'dev', this.iface, 'xdp', 'obj', this.ebpfObjPath, 'sec', 'xdp']);
      
      return new Promise((resolve) => {
        child.on('exit', (code) => {
          if (code === 0) {
            this.isLoaded = true;
            console.log(`[eBPF Loader] XDP filter successfully attached to ${this.iface}`);
            resolve(true);
          } else {
            console.warn(`[eBPF Loader] Failed to attach XDP filter (exit code ${code}). Running without eBPF kernel offload.`);
            resolve(false);
          }
        });
      });
    } catch (err) {
      console.error('[eBPF Loader] Error attaching XDP filter:', err.message);
      return false;
    }
  }

  async unload() {
    if (!this.isLoaded) return;
    try {
      spawn('ip', ['link', 'set', 'dev', this.iface, 'xdp', 'off']);
      this.isLoaded = false;
      console.log(`[eBPF Loader] Detached XDP filter from ${this.iface}`);
    } catch (err) {
      console.error('[eBPF Loader] Error detaching XDP filter:', err.message);
    }
  }
}

export const ebpfLoader = new EbpfTelemetryLoader(process.env.EBPF_IFACE || 'eth0');
