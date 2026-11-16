import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../backend/api/src/middleware/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runLiquibase(args, password) {
  return new Promise((resolve, reject) => {
    const child = spawn('liquibase', args, {
      env: { ...process.env, LIQUIBASE_PASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `liquibase exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

const MISSING_CONFIG_MESSAGE =
    'DATABASE_URL, DB_USERNAME, and DB_PASSWORD environment variables are required';

class LiquibaseService {
    constructor() {
        this.liquibasePath = path.join(__dirname, '../../database/liquibase');
        this.dbUrl = process.env.DATABASE_URL;
        this.username = process.env.DB_USERNAME;
        this.password = process.env.DB_PASSWORD;

        // This is a module-level singleton that src/index.js loads through the
        // admin routes, so throwing here stopped the whole API from starting on
        // any deployment without these variables (DB_USERNAME is not even in
        // .env.example). Report it where it matters: on each Liquibase call.
        if (this.isConfigured()) {
            logger.info('✅ Liquibase Service initialized');
        } else {
            logger.warn('Liquibase disabled: ' + MISSING_CONFIG_MESSAGE);
        }
    }

    isConfigured() {
        return Boolean(this.dbUrl && this.username && this.password);
    }

    async runMigrations() {
        if (!this.isConfigured()) {
            return { success: false, error: MISSING_CONFIG_MESSAGE };
        }
        try {
            const args = [
                `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
                `--url=${this.dbUrl}`,
                `--username=${this.username}`,
                'update',
            ];

            const { stdout, stderr } = await runLiquibase(args, this.password);

            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Migration error:', stderr);
                return { success: false, error: stderr };
            }

            logger.info('✅ Migrations completed');
            return { success: true, output: stdout };
        } catch (error) {
            logger.error('Migration failed:', error);
            return { success: false, error: error.message };
        }
    }

    async rollback(rollbackCount = 1) {
        if (!this.isConfigured()) {
            return { success: false, error: MISSING_CONFIG_MESSAGE };
        }
        try {
            const parsedCount = parseInt(rollbackCount, 10);
            if (!Number.isFinite(parsedCount) || parsedCount < 1) {
                throw new Error('rollbackCount must be a positive integer');
            }

            const args = [
                `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
                `--url=${this.dbUrl}`,
                `--username=${this.username}`,
                'rollback',
                `--rollbackCount=${parsedCount}`,
            ];

            const { stdout, stderr } = await runLiquibase(args, this.password);

            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Rollback error:', stderr);
                return { success: false, error: stderr };
            }

            logger.info(`✅ Rollback ${parsedCount} changes completed`);
            return { success: true, output: stdout };
        } catch (error) {
            logger.error('Rollback failed:', error);
            return { success: false, error: error.message };
        }
    }

    async getStatus() {
        if (!this.isConfigured()) {
            return { success: false, error: MISSING_CONFIG_MESSAGE };
        }
        try {
            const args = [
                `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
                `--url=${this.dbUrl}`,
                `--username=${this.username}`,
                'status',
            ];

            const { stdout, stderr } = await runLiquibase(args, this.password);

            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Status error:', stderr);
                return { success: false, error: stderr };
            }

            return { success: true, status: stdout };
        } catch (error) {
            logger.error('Status check failed:', error);
            return { success: false, error: error.message };
        }
    }

    async validate() {
        if (!this.isConfigured()) {
            return { success: false, error: MISSING_CONFIG_MESSAGE };
        }
        try {
            const args = [
                `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
                `--url=${this.dbUrl}`,
                `--username=${this.username}`,
                'validate',
            ];

            const { stdout, stderr } = await runLiquibase(args, this.password);

            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Validation error:', stderr);
                return { success: false, error: stderr };
            }

            logger.info('✅ Validation completed');
            return { success: true, output: stdout };
        } catch (error) {
            logger.error('Validation failed:', error);
            return { success: false, error: error.message };
        }
    }
}

export default new LiquibaseService();