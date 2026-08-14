import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '../backend/api/src/middleware/logger.js';

const execAsync = promisify(exec);

class SnykService {
    constructor() {
        this.snykToken = process.env.SNYK_TOKEN;
        this.snykOrgId = process.env.SNYK_ORG_ID;
        this.snykApiUrl = process.env.SNYK_API_URL || 'https://api.snyk.io/v1';
        
        this.scanResults = [];
        this.vulnerabilities = [];
        
        logger.info('✅ Snyk Service initialized');
    }

    _sanitizePath(inputPath) {
        if (!inputPath || typeof inputPath !== 'string') return '.';
        const sanitized = inputPath.replace(/[^a-zA-Z0-9_\-\.\/]/g, '');
        return sanitized || '.';
    }

    _sanitizeImage(image) {
        if (!image || typeof image !== 'string') throw new Error('Invalid image name');
        const sanitized = image.replace(/[^a-zA-Z0-9_\-\.\/\:@]/g, '');
        if (!sanitized) throw new Error('Invalid image name');
        return sanitized;
    }

    // The snyk CLI can emit non-JSON lines (progress/spinner frames, warnings,
    // plain-text summaries) around the JSON payload. Never let a bare
    // JSON.parse turn that into a hard scan failure: try the full output, then
    // the last JSON document found within it, and otherwise return null so the
    // caller can report a structured failure with the raw output logged.
    _parseJsonOutput(stdout) {
        try {
            return JSON.parse(stdout);
        } catch {
            // fall through to scan-for-JSON below
        }
        for (const pair of [['{', '}'], ['[', ']']]) {
            const [open, close] = pair;
            const start = stdout.indexOf(open);
            if (start === -1) continue;
            let end = -1;
            for (let i = stdout.length - 1; i >= start; i--) {
                if (stdout[i] === close) {
                    end = i;
                    break;
                }
            }
            if (end === -1) continue;
            try {
                return JSON.parse(stdout.slice(start, end + 1));
            } catch {
                // keep scanning
            }
        }
        logger.error('Snyk produced non-JSON output:', stdout);
        return null;
    }

    async scanDependencies(projectPath = '.') {
        try {
            const safePath = this._sanitizePath(projectPath);
            const command = `snyk test --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command, { cwd: safePath });
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Dependency scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = this._parseJsonOutput(stdout);
            if (results === null) {
                return { success: false, error: 'Snyk dependency scan produced non-JSON output (see logs)' };
            }
            this.scanResults.push({
                type: 'dependencies',
                timestamp: new Date().toISOString(),
                results
            });
            
            return {
                success: true,
                data: results,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Dependency scan failed:', error);
            return { success: false, error: error.message };
        }
    }

    async scanContainer(image) {
        try {
            const safeImage = this._sanitizeImage(image);
            const command = `snyk container test ${safeImage} --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command);
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Container scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = this._parseJsonOutput(stdout);
            if (results === null) {
                return { success: false, error: 'Snyk container scan produced non-JSON output (see logs)' };
            }
            this.scanResults.push({
                type: 'container',
                image: safeImage,
                timestamp: new Date().toISOString(),
                results
            });
            
            return {
                success: true,
                data: results,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Container scan failed:', error);
            return { success: false, error: error.message };
        }
    }

    async scanIaC(inputPath) {
        try {
            const safePath = this._sanitizePath(inputPath);
            const command = `snyk iac test ${safePath} --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command);
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('IaC scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = this._parseJsonOutput(stdout);
            if (results === null) {
                return { success: false, error: 'Snyk IaC scan produced non-JSON output (see logs)' };
            }
            this.scanResults.push({
                type: 'iac',
                path: safePath,
                timestamp: new Date().toISOString(),
                results
            });
            
            return {
                success: true,
                data: results,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('IaC scan failed:', error);
            return { success: false, error: error.message };
        }
    }

    async scanCode(inputPath) {
        try {
            const safePath = this._sanitizePath(inputPath);
            const command = `snyk code test ${safePath} --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command);
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Code scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = this._parseJsonOutput(stdout);
            if (results === null) {
                return { success: false, error: 'Snyk code scan produced non-JSON output (see logs)' };
            }
            this.scanResults.push({
                type: 'code',
                path: safePath,
                timestamp: new Date().toISOString(),
                results
            });
            
            return {
                success: true,
                data: results,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Code scan failed:', error);
            return { success: false, error: error.message };
        }
    }

    async monitorProject(projectPath = '.') {
        try {
            const command = `snyk monitor --org=${this.snykOrgId}`;
            const { stdout, stderr } = await execAsync(command, { cwd: projectPath });
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Monitor error:', stderr);
                return { success: false, error: stderr };
            }
            
            return {
                success: true,
                message: stdout,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Monitor failed:', error);
            return { success: false, error: error.message };
        }
    }

    async getVulnerabilities(projectId) {
        try {
            const response = await axios.get(
                `${this.snykApiUrl}/org/${this.snykOrgId}/projects/${projectId}/issues`,
                {
                    headers: {
                        'Authorization': `token ${this.snykToken}`
                    }
                }
            );
            
            return {
                success: true,
                data: response.data,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Get vulnerabilities failed:', error);
            return { success: false, error: error.message };
        }
    }

    async createFixPR(projectId) {
        try {
            const response = await axios.post(
                `${this.snykApiUrl}/org/${this.snykOrgId}/projects/${projectId}/fix-pr`,
                {},
                {
                    headers: {
                        'Authorization': `token ${this.snykToken}`
                    }
                }
            );
            
            return {
                success: true,
                data: response.data,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Create fix PR failed:', error);
            return { success: false, error: error.message };
        }
    }

    async getProjects() {
        try {
            const response = await axios.get(
                `${this.snykApiUrl}/org/${this.snykOrgId}/projects`,
                {
                    headers: {
                        'Authorization': `token ${this.snykToken}`
                    }
                }
            );
            
            return {
                success: true,
                data: response.data,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Get projects failed:', error);
            return { success: false, error: error.message };
        }
    }

    async getStats() {
        const stats = {
            totalScans: this.scanResults.length,
            vulnerabilitiesFound: 0,
            criticalVulnerabilities: 0,
            highVulnerabilities: 0,
            fixedVulnerabilities: 0
        };
        
        for (const scan of this.scanResults) {
            if (scan.results && scan.results.vulnerabilities) {
                const vulns = scan.results.vulnerabilities;
                stats.vulnerabilitiesFound += vulns.length;
                
                for (const vuln of vulns) {
                    if (vuln.severity === 'critical') {
                        stats.criticalVulnerabilities++;
                    } else if (vuln.severity === 'high') {
                        stats.highVulnerabilities++;
                    }
                }
            }
        }
        
        return {
            ...stats,
            timestamp: new Date().toISOString()
        };
    }
}

export default new SnykService();