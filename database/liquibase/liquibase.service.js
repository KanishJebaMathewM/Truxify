import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../backend/api/src/middleware/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The Liquibase changelogs describe a legacy standalone demo schema (BIGINT ids,
// 'PENDING'/'OFFLINE' defaults) that cannot coexist with the application schema
// (uuid ids, lowercase status CHECKs) in the same database. They must never run
// against the application database ("truxify", or Supabase's "postgres"), whose
// schema is owned by supabase/migrations. Liquibase therefore always targets a
// dedicated database, independent of DATABASE_URL.
const LIQUIBASE_DATABASE = process.env.LIQUIBASE_DATABASE || 'truxify_liquibase';
const APPLICATION_DATABASES = ['truxify', 'postgres'];

function databaseNameFromUrl(rawUrl) {
    if (!rawUrl) return '';
    const base = rawUrl.split('?', 1)[0];
    const match = base.match(/[/]([^/]+)$/);
    return match ? match[1] : '';
}

function resolveLiquibaseUrl(rawUrl) {
    if (!rawUrl) return null;
    const [base, query] = rawUrl.split('?', 2);
    const swapped = base.replace(/[/][^/]+$/, `/${LIQUIBASE_DATABASE}`);
    return query ? `${swapped}?${query}` : swapped;
}

function isApplicationDatabase(rawUrl) {
    return APPLICATION_DATABASES.includes(databaseNameFromUrl(rawUrl));
}

function credentialsFromUrl(rawUrl) {
    const match = (rawUrl || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^:]*):([^@]*)@/i);
    if (!match) return {};
    return {
        username: decodeURIComponent(match[1]),
        password: decodeURIComponent(match[2]),
    };
}

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
        const rawDatabaseUrl = process.env.DATABASE_URL;
        this.dbUrl = resolveLiquibaseUrl(rawDatabaseUrl);

        const urlCredentials = credentialsFromUrl(rawDatabaseUrl);
        this.username = process.env.DB_USERNAME || urlCredentials.username;
        this.password = process.env.DB_PASSWORD || urlCredentials.password;

        if (!this.dbUrl || !this.username || !this.password) {
            throw new Error('DATABASE_URL, DB_USERNAME, and DB_PASSWORD environment variables are required');
        }

        if (isApplicationDatabase(this.dbUrl)) {
            throw new Error(
                `Refusing to run Liquibase against the application database '${databaseNameFromUrl(this.dbUrl)}'. ` +
                'The app schema is owned by supabase/migrations; set LIQUIBASE_DATABASE to a separate database (e.g. truxify_liquibase).'
            );
        }

        logger.info('✅ Liquibase Service initialized');
    }

    async runMigrations() {
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