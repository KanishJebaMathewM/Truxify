import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../api/src/middleware/logger.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class LiquibaseService {
    constructor() {
        this.liquibasePath = path.join(__dirname, '../../database/liquibase');
        this.dbUrl = process.env.DATABASE_URL || 'jdbc:postgresql://localhost:5432/truxify';
        this.username = process.env.DB_USERNAME || 'postgres';
        this.password = process.env.DB_PASSWORD || 'password';
        
        logger.info('✅ Liquibase Service initialized');
    }

    async runMigrations() {
        try {
            const command = `liquibase --changeLogFile=${this.liquibasePath}/changelog-master.xml --url="${this.dbUrl}" --username=${this.username} --password=${this.password} update`;
            
            const { stdout, stderr } = await execAsync(command);
            
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
            const command = `liquibase --changeLogFile=${this.liquibasePath}/changelog-master.xml --url="${this.dbUrl}" --username=${this.username} --password=${this.password} rollbackCount ${rollbackCount}`;
            
            const { stdout, stderr } = await execAsync(command);
            
            if (stderr && !stderr.includes('WARNING')) {
                logger.error('Rollback error:', stderr);
                return { success: false, error: stderr };
            }
            
            logger.info(`✅ Rollback ${rollbackCount} changes completed`);
            return { success: true, output: stdout };
        } catch (error) {
            logger.error('Rollback failed:', error);
            return { success: false, error: error.message };
        }
    }

    async getStatus() {
        try {
            const command = `liquibase --changeLogFile=${this.liquibasePath}/changelog-master.xml --url="${this.dbUrl}" --username=${this.username} --password=${this.password} status`;
            
            const { stdout, stderr } = await execAsync(command);
            
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
            const command = `liquibase --changeLogFile=${this.liquibasePath}/changelog-master.xml --url="${this.dbUrl}" --username=${this.username} --password=${this.password} validate`;
            
            const { stdout, stderr } = await execAsync(command);
            
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