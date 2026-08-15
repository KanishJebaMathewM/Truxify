import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import logger from '../../backend/api/src/middleware/logger.js';

const execAsync = promisify(exec);

class OPAService {
    constructor() {
        this.policiesDir = path.join(__dirname, '../../k8s/opa/policies');
        this.policyCache = new Map();
        this.isInitialized = false;

        this.initialize();
        logger.info('✅ OPA Service initialized');
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // Load all policies
            await this.loadPolicies();
            this.isInitialized = true;
            logger.info('✅ OPA policies loaded');
        } catch (error) {
            logger.error('❌ OPA initialization failed:', error);
        }
    }

    async loadPolicies() {
        const files = fs.readdirSync(this.policiesDir);
        
        for (const file of files) {
            if (file.endsWith('.rego')) {
                const policyPath = path.join(this.policiesDir, file);
                const content = fs.readFileSync(policyPath, 'utf-8');
                this.policyCache.set(file, content);
                logger.info(`✅ Loaded policy: ${file}`);
            }
        }
    }

    // OPA CLI output can carry non-JSON noise (runtime warnings, notices)
    // before the payload. Never let a bare JSON.parse abort an authorization
    // decision — on failure, log the raw output and return null so the caller
    // can produce a deny result instead of an unhandled exception.
    _parseOpaOutput(stdout, policyName) {
        try {
            return JSON.parse(stdout);
        } catch (err) {
            logger.error(`OPA evaluation produced non-JSON output for policy ${policyName}: ${err.message}`);
            logger.error(`Raw OPA output: ${stdout}`);
            return null;
        }
    }

    async evaluatePolicy(policyName, input) {
        try {
            const policy = this.policyCache.get(`${policyName}.rego`);
            if (!policy) {
                throw new Error(`Policy ${policyName} not found`);
            }

            // Write input to a unique temp file per call
            const inputPath = path.join(os.tmpdir(), `opa_input_${crypto.randomUUID()}.json`);
            fs.writeFileSync(inputPath, JSON.stringify(input));

            try {
                // Evaluate policy
                const { stdout, stderr } = await execAsync(
                    `opa eval --data ${path.join(this.policiesDir, policyName + '.rego')} --input ${inputPath} "data.${policyName}.allow"`
                );

                if (stderr) {
                    logger.error('OPA evaluation error:', stderr);
                    throw new Error(stderr);
                }

                const result = this._parseOpaOutput(stdout, policyName);
                if (!result) {
                    return {
                        allowed: false,
                        error: `OPA returned no parseable result for policy ${policyName}`,
                        policy: policyName,
                        timestamp: new Date().toISOString()
                    };
                }
                const allowed = result.result && result.result[0]?.value === true;

                // Get violations
                const violations = [];
                if (!allowed) {
                    const { stdout: denyStdout } = await execAsync(
                        `opa eval --data ${path.join(this.policiesDir, policyName + '.rego')} --input ${inputPath} "data.${policyName}.deny"`
                    );
                    const denyResult = this._parseOpaOutput(denyStdout, policyName);
                    if (denyResult && denyResult.result) {
                        for (const r of denyResult.result) {
                            violations.push(r.value);
                        }
                    }
                }

                return {
                    allowed,
                    violations,
                    policy: policyName,
                    timestamp: new Date().toISOString()
                };
            } finally {
                // Cleanup temp file
                fs.unlinkSync(inputPath);
            }
        } catch (error) {
            logger.error('Policy evaluation failed:', error);
            return {
                allowed: false,
                error: error.message,
                policy: policyName,
                timestamp: new Date().toISOString()
            };
        }
    }

    async evaluateSecurity(input) {
        return await this.evaluatePolicy('security', input);
    }

    async evaluateCompliance(input) {
        return await this.evaluatePolicy('compliance', input);
    }

    async evaluateNetwork(input) {
        return await this.evaluatePolicy('network', input);
    }

    async evaluateData(input) {
        return await this.evaluatePolicy('data', input);
    }

    async evaluateAll(input) {
        const results = {
            security: await this.evaluateSecurity(input),
            compliance: await this.evaluateCompliance(input),
            network: await this.evaluateNetwork(input),
            data: await this.evaluateData(input)
        };

        const allPassed = Object.values(results).every(r => r.allowed === true);
        const violations = [];

        for (const [policy, result] of Object.entries(results)) {
            if (result.violations) {
                for (const v of result.violations) {
                    violations.push({ policy, message: v });
                }
            }
        }

        return {
            allowed: allPassed,
            results,
            violations,
            timestamp: new Date().toISOString()
        };
    }

    async checkKubernetesResource(resource) {
        const input = {
            review: {
                object: resource
            }
        };

        return await this.evaluateAll(input);
    }

    async deployPolicy(policyName, policyContent) {
        try {
            const policyPath = path.join(this.policiesDir, `${policyName}.rego`);
            fs.writeFileSync(policyPath, policyContent);
            this.policyCache.set(`${policyName}.rego`, policyContent);
            
            logger.info(`✅ Policy deployed: ${policyName}`);
            return {
                success: true,
                policy: policyName,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Policy deployment failed:', error);
            return {
                success: false,
                error: error.message,
                policy: policyName,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getPolicies() {
        const policies = [];
        for (const [name, content] of this.policyCache) {
            policies.push({
                name: name.replace('.rego', ''),
                content,
                size: content.length,
                timestamp: new Date().toISOString()
            });
        }
        return policies;
    }

    async getStats() {
        return {
            totalPolicies: this.policyCache.size,
            policies: Array.from(this.policyCache.keys()),
            isInitialized: this.isInitialized,
            timestamp: new Date().toISOString()
        };
    }
}

export default new OPAService();