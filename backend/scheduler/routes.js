import express from 'express';
import RenderScheduler, { Priority, PriorityNames } from './RenderScheduler.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Initialize scheduler
const scheduler = new RenderScheduler({ maxConcurrent: 4 });

// Schedule render task
router.post('/scheduler/schedule', async (req, res) => {
    try {
        const { priority, component, metadata } = req.body;
        
        if (!component) {
            return res.status(400).json({
                success: false,
                error: 'component required'
            });
        }
        
        // Convert priority name to value
        let priorityValue = Priority.MEDIUM;
        if (priority) {
            const prioMap = {
                'CRITICAL': Priority.CRITICAL,
                'HIGH': Priority.HIGH,
                'MEDIUM': Priority.MEDIUM,
                'LOW': Priority.LOW,
                'IDLE': Priority.IDLE
            };
            priorityValue = prioMap[priority.toUpperCase()] || Priority.MEDIUM;
        }
        
        const taskId = scheduler.schedule(component, priorityValue, metadata);
        
        res.json({
            success: true,
            data: {
                taskId,
                priority: PriorityNames[priorityValue],
                status: 'pending'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Schedule error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cancel task
router.delete('/scheduler/task/:taskId', (req, res) => {
    try {
        const { taskId } = req.params;
        const success = scheduler.cancel(parseInt(taskId));
        
        res.json({
            success,
            data: { taskId, cancelled: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Cancel error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cancel all tasks
router.delete('/scheduler/tasks', (req, res) => {
    try {
        const { priority } = req.query;
        let priorityValue = null;
        
        if (priority) {
            const prioMap = {
                'CRITICAL': Priority.CRITICAL,
                'HIGH': Priority.HIGH,
                'MEDIUM': Priority.MEDIUM,
                'LOW': Priority.LOW,
                'IDLE': Priority.IDLE
            };
            priorityValue = prioMap[priority.toUpperCase()];
        }
        
        const count = scheduler.cancelAll(priorityValue);
        
        res.json({
            success: true,
            data: { cancelled: count },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Cancel all error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Change priority
router.post('/scheduler/task/:taskId/priority', (req, res) => {
    try {
        const { taskId } = req.params;
        const { priority } = req.body;
        
        if (!priority) {
            return res.status(400).json({
                success: false,
                error: 'priority required'
            });
        }
        
        const prioMap = {
            'CRITICAL': Priority.CRITICAL,
            'HIGH': Priority.HIGH,
            'MEDIUM': Priority.MEDIUM,
            'LOW': Priority.LOW,
            'IDLE': Priority.IDLE
        };
        const priorityValue = prioMap[priority.toUpperCase()];
        
        if (priorityValue === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Invalid priority'
            });
        }
        
        const success = scheduler.changePriority(parseInt(taskId), priorityValue);
        
        res.json({
            success,
            data: {
                taskId,
                newPriority: priority,
                changed: success
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Change priority error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add dependency
router.post('/scheduler/task/:taskId/dependency', (req, res) => {
    try {
        const { taskId } = req.params;
        const { dependencyId } = req.body;
        
        if (!dependencyId) {
            return res.status(400).json({
                success: false,
                error: 'dependencyId required'
            });
        }
        
        const success = scheduler.addDependency(parseInt(taskId), parseInt(dependencyId));
        
        res.json({
            success,
            data: {
                taskId,
                dependencyId,
                added: success
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Add dependency error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove dependency
router.delete('/scheduler/task/:taskId/dependency/:dependencyId', (req, res) => {
    try {
        const { taskId, dependencyId } = req.params;
        const success = scheduler.removeDependency(parseInt(taskId), parseInt(dependencyId));
        
        res.json({
            success,
            data: {
                taskId,
                dependencyId,
                removed: success
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Remove dependency error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get task
router.get('/scheduler/task/:taskId', (req, res) => {
    try {
        const { taskId } = req.params;
        const task = scheduler.getTask(parseInt(taskId));
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                id: task.id,
                priority: PriorityNames[task.priority],
                status: task.status,
                createdAt: task.createdAt,
                startedAt: task.startedAt,
                completedAt: task.completedAt,
                executionTime: task.executionTime,
                waitTime: task.waitTime,
                attempts: task.attempts,
                dependencies: task.dependencies,
                dependents: task.dependents,
                result: task.result,
                error: task.error
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get task error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get tasks
router.get('/scheduler/tasks', (req, res) => {
    try {
        const { status } = req.query;
        const tasks = scheduler.getTasks(status);
        
        res.json({
            success: true,
            data: tasks.map(task => ({
                id: task.id,
                priority: PriorityNames[task.priority],
                status: task.status,
                createdAt: task.createdAt,
                executionTime: task.executionTime
            })),
            count: tasks.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get tasks error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/scheduler/stats', (req, res) => {
    try {
        const stats = scheduler.getStats();
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Control scheduler
router.post('/scheduler/control', (req, res) => {
    try {
        const { action } = req.body;
        
        switch (action) {
            case 'pause':
                scheduler.pause();
                break;
            case 'resume':
                scheduler.resume();
                break;
            case 'clear':
                scheduler.clear();
                break;
            case 'reset':
                scheduler.reset();
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
        }
        
        res.json({
            success: true,
            data: { action },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Control error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;