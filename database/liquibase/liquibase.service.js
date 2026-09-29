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

class LiquibaseService {
  constructor() {
    this.liquibasePath = path.join(__dirname, '../../database/liquibase');
    logger.info('✅ Liquibase Service initialized');
  }

  /**
   * Lazily reads process.env variables at method execution time
   * to ensure root .env variables loaded after module import are properly read.
   */
  _getCredentials() {
    return {
      dbUrl: process.env.DATABASE_URL,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
    };
  }

  /**
   * Validates configuration dynamically before executing any operation.
   */
  _validateConfig() {
    const { dbUrl, username, password } = this._getCredentials();
    if (!dbUrl || !username || !password) {
      return 'DATABASE_URL, DB_USERNAME, and DB_PASSWORD environment variables are required for Liquibase operations';
    }
    return null;
  }

  async runMigrations() {
    const configError = this._validateConfig();
    if (configError) {
      logger.error('Migration failed:', configError);
      return { success: false, error: configError };
    }

    const { dbUrl, username, password } = this._getCredentials();

    try {
      const args = [
        `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
        `--url=${dbUrl}`,
        `--username=${username}`,
        'update',
      ];

      const { stdout, stderr } = await runLiquibase(args, password);

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
    const configError = this._validateConfig();
    if (configError) {
      logger.error('Rollback failed:', configError);
      return { success: false, error: configError };
    }

    const { dbUrl, username, password } = this._getCredentials();

    try {
      const parsedCount = parseInt(rollbackCount, 10);
      if (!Number.isFinite(parsedCount) || parsedCount < 1) {
        throw new Error('rollbackCount must be a positive integer');
      }

      const args = [
        `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
        `--url=${dbUrl}`,
        `--username=${username}`,
        'rollback',
        `--rollbackCount=${parsedCount}`,
      ];

      const { stdout, stderr } = await runLiquibase(args, password);

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
    const configError = this._validateConfig();
    if (configError) {
      logger.error('Status check failed:', configError);
      return { success: false, error: configError };
    }

    const { dbUrl, username, password } = this._getCredentials();

    try {
      const args = [
        `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
        `--url=${dbUrl}`,
        `--username=${username}`,
        'status',
      ];

      const { stdout, stderr } = await runLiquibase(args, password);

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
    const configError = this._validateConfig();
    if (configError) {
      logger.error('Validation failed:', configError);
      return { success: false, error: configError };
    }

    const { dbUrl, username, password } = this._getCredentials();

    try {
      const args = [
        `--changeLogFile=${this.liquibasePath}/changelog-master.xml`,
        `--url=${dbUrl}`,
        `--username=${username}`,
        'validate',
      ];

      const { stdout, stderr } = await runLiquibase(args, password);

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
