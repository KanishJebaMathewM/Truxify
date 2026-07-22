import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '../../api/src/middleware/logger.js';

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

    async scanDependencies(projectPath = '.') {
        try {
            const command = `snyk test --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command, { cwd: projectPath });
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Dependency scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = JSON.parse(stdout);
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
            const command = `snyk container test ${image} --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command);
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Container scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = JSON.parse(stdout);
            this.scanResults.push({
                type: 'container',
                image,
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

    async scanIaC(path) {
        try {
            const command = `snyk iac test ${path} --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command);
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('IaC scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = JSON.parse(stdout);
            this.scanResults.push({
                type: 'iac',
                path,
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

    async scanCode(path) {
        try {
            const command = `snyk code test ${path} --severity-threshold=high --json`;
            const { stdout, stderr } = await execAsync(command);
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Code scan error:', stderr);
                return { success: false, error: stderr };
            }
            
            const results = JSON.parse(stdout);
            this.scanResults.push({
                type: 'code',
                path,
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