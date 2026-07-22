import { EventEmitter } from 'events';
import logger from '../../api/src/middleware/logger.js';

// Priority levels
export const Priority = {
    CRITICAL: 0,   // UI notifications, loading indicators
    HIGH: 1,       // User interactions, real-time updates
    MEDIUM: 2,     // Charts, tables, lists
    LOW: 3,        // Background updates, analytics
    IDLE: 4        // Pre-rendering, prefetching
};

export const PriorityNames = {
    [Priority.CRITICAL]: 'CRITICAL',
    [Priority.HIGH]: 'HIGH',
    [Priority.MEDIUM]: 'MEDIUM',
    [Priority.LOW]: 'LOW',
    [Priority.IDLE]: 'IDLE'
};

class RenderTask {
    constructor(id, component, priority = Priority.MEDIUM, metadata = {}) {
        this.id = id;
        this.component = component;
        this.priority = priority;
        this.metadata = metadata;
        this.status = 'pending'; // pending, running, completed, failed, cancelled
        this.createdAt = Date.now();
        this.startedAt = null;
        this.completedAt = null;
        this.attempts = 0;
        this.maxAttempts = 3;
        this.dependencies = [];
        this.dependents = [];
        this.result = null;
        this.error = null;
    }
    
    get age() {
        return Date.now() - this.createdAt;
    }
    
    get waitTime() {
        return this.startedAt ? this.startedAt - this.createdAt : null;
    }
    
    get executionTime() {
        return this.completedAt && this.startedAt ? this.completedAt - this.startedAt : null;
    }
}

class RenderScheduler extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.maxConcurrent = config.maxConcurrent || 4;
        this.queues = {
            [Priority.CRITICAL]: [],
            [Priority.HIGH]: [],
            [Priority.MEDIUM]: [],
            [Priority.LOW]: [],
            [Priority.IDLE]: []
        };
        
        this.running = new Map();
        this.completed = [];
        this.taskMap = new Map();
        this.nextTaskId = 1;
        this.isProcessing = false;
        this.stats = {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            cancelledTasks: 0,
            averageWaitTime: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0
        };
        
        // Start processing loop
        this.startProcessing();
        
        logger.info(`✅ RenderScheduler initialized (maxConcurrent: ${this.maxConcurrent})`);
    }
    
    // ============ Task Management ============
    
    schedule(component, priority = Priority.MEDIUM, metadata = {}) {
        const taskId = this.nextTaskId++;
        const task = new RenderTask(taskId, component, priority, metadata);
        
        // Add to queue
        this.queues[priority].push(task);
        this.taskMap.set(taskId, task);
        this.stats.totalTasks++;
        
        this.emit('taskScheduled', { taskId, priority: PriorityNames[priority] });
        logger.debug(`Task ${taskId} scheduled with priority ${PriorityNames[priority]}`);
        
        return taskId;
    }
    
    cancel(taskId) {
        const task = this.taskMap.get(taskId);
        if (!task) return false;
        
        if (task.status === 'pending') {
            // Remove from queue
            const queue = this.queues[task.priority];
            const index = queue.indexOf(task);
            if (index !== -1) {
                queue.splice(index, 1);
                task.status = 'cancelled';
                this.stats.cancelledTasks++;
                this.taskMap.delete(taskId);
                this.emit('taskCancelled', { taskId });
                logger.debug(`Task ${taskId} cancelled`);
                return true;
            }
        }
        
        if (task.status === 'running') {
            // Can't cancel running tasks
            return false;
        }
        
        return false;
    }
    
    cancelAll(priority = null) {
        let count = 0;
        
        if (priority !== null) {
            const queue = this.queues[priority];
            const tasks = [...queue];
            for (const task of tasks) {
                if (this.cancel(task.id)) count++;
            }
        } else {
            for (const p of Object.values(Priority)) {
                const queue = this.queues[p];
                const tasks = [...queue];
                for (const task of tasks) {
                    if (this.cancel(task.id)) count++;
                }
            }
        }
        
        this.emit('tasksCancelled', { count });
        logger.info(`${count} tasks cancelled`);
        return count;
    }
    
    // ============ Priority Management ============
    
    changePriority(taskId, newPriority) {
        const task = this.taskMap.get(taskId);
        if (!task || task.status !== 'pending') return false;
        
        // Remove from current queue
        const oldQueue = this.queues[task.priority];
        const index = oldQueue.indexOf(task);
        if (index === -1) return false;
        oldQueue.splice(index, 1);
        
        // Add to new queue
        task.priority = newPriority;
        this.queues[newPriority].push(task);
        
        this.emit('priorityChanged', { taskId, oldPriority: PriorityNames[task.priority], newPriority: PriorityNames[newPriority] });
        logger.debug(`Task ${taskId} priority changed to ${PriorityNames[newPriority]}`);
        
        return true;
    }
    
    getQueueLength(priority = null) {
        if (priority !== null) {
            return this.queues[priority].length;
        }
        
        let total = 0;
        for (const p of Object.values(Priority)) {
            total += this.queues[p].length;
        }
        return total;
    }
    
    // ============ Processing ============
    
    startProcessing() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.processLoop();
    }
    
    async processLoop() {
        while (this.isProcessing) {
            // Check if we can run more tasks
            if (this.running.size >= this.maxConcurrent) {
                await this.sleep(100);
                continue;
            }
            
            // Get next task
            const task = this.getNextTask();
            if (!task) {
                await this.sleep(100);
                continue;
            }
            
            // Run task
            this.runTask(task);
        }
    }
    
    getNextTask() {
        // Check priorities in order
        for (const priority of [
            Priority.CRITICAL,
            Priority.HIGH,
            Priority.MEDIUM,
            Priority.LOW,
            Priority.IDLE
        ]) {
            const queue = this.queues[priority];
            
            // Check for tasks without dependencies
            for (let i = 0; i < queue.length; i++) {
                const task = queue[i];
                if (this.areDependenciesMet(task)) {
                    queue.splice(i, 1);
                    return task;
                }
            }
        }
        
        return null;
    }
    
    areDependenciesMet(task) {
        for (const depId of task.dependencies) {
            const dep = this.taskMap.get(depId);
            if (!dep || dep.status !== 'completed') {
                return false;
            }
        }
        return true;
    }
    
    async runTask(task) {
        task.status = 'running';
        task.startedAt = Date.now();
        task.attempts++;
        
        this.running.set(task.id, task);
        this.emit('taskStarted', { taskId: task.id });
        logger.debug(`Task ${task.id} started`);
        
        try {
            // Execute task
            const result = await this.executeTask(task);
            
            // Complete task
            task.status = 'completed';
            task.completedAt = Date.now();
            task.result = result;
            
            this.running.delete(task.id);
            this.completed.push(task);
            this.stats.completedTasks++;
            
            // Update stats
            const execTime = task.executionTime;
            if (execTime !== null) {
                this.stats.totalExecutionTime += execTime;
                this.stats.averageExecutionTime = this.stats.totalExecutionTime / this.stats.completedTasks;
            }
            
            // Update wait time stats
            const waitTime = task.waitTime;
            if (waitTime !== null) {
                this.stats.averageWaitTime = 
                    (this.stats.averageWaitTime * (this.stats.completedTasks - 1) + waitTime) / this.stats.completedTasks;
            }
            
            this.emit('taskCompleted', { taskId: task.id, result, executionTime: execTime });
            logger.debug(`Task ${task.id} completed in ${execTime}ms`);
            
            // Process dependents
            this.processDependents(task);
            
        } catch (error) {
            // Handle error
            task.status = 'failed';
            task.error = error.message;
            
            this.running.delete(task.id);
            
            if (task.attempts < task.maxAttempts) {
                // Retry
                task.status = 'pending';
                this.queues[task.priority].push(task);
                this.emit('taskRetry', { taskId: task.id, attempts: task.attempts });
                logger.warn(`Task ${task.id} retry ${task.attempts}/${task.maxAttempts}`);
            } else {
                this.stats.failedTasks++;
                this.emit('taskFailed', { taskId: task.id, error: error.message });
                logger.error(`Task ${task.id} failed: ${error.message}`);
            }
        }
    }
    
    async executeTask(task) {
        // Execute component render function
        if (typeof task.component === 'function') {
            return await task.component();
        } else if (task.component && typeof task.component.render === 'function') {
            return await task.component.render();
        } else {
            return await task.component;
        }
    }
    
    processDependents(task) {
        for (const depId of task.dependents) {
            const dep = this.taskMap.get(depId);
            if (dep && dep.status === 'pending') {
                this.emit('dependentReady', { taskId: dep.id, dependencyId: task.id });
            }
        }
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ============ Task Dependencies ============
    
    addDependency(taskId, dependencyId) {
        const task = this.taskMap.get(taskId);
        const dep = this.taskMap.get(dependencyId);
        
        if (!task || !dep) return false;
        
        task.dependencies.push(dependencyId);
        dep.dependents.push(taskId);
        
        this.emit('dependencyAdded', { taskId, dependencyId });
        return true;
    }
    
    removeDependency(taskId, dependencyId) {
        const task = this.taskMap.get(taskId);
        if (!task) return false;
        
        const index = task.dependencies.indexOf(dependencyId);
        if (index === -1) return false;
        
        task.dependencies.splice(index, 1);
        
        const dep = this.taskMap.get(dependencyId);
        if (dep) {
            const depIndex = dep.dependents.indexOf(taskId);
            if (depIndex !== -1) {
                dep.dependents.splice(depIndex, 1);
            }
        }
        
        this.emit('dependencyRemoved', { taskId, dependencyId });
        return true;
    }
    
    // ============ Queries ============
    
    getTask(taskId) {
        return this.taskMap.get(taskId);
    }
    
    getTasks(status = null) {
        const tasks = Array.from(this.taskMap.values());
        if (status !== null) {
            return tasks.filter(t => t.status === status);
        }
        return tasks;
    }
    
    getRunningTasks() {
        return Array.from(this.running.values());
    }
    
    getCompletedTasks(limit = 100) {
        return this.completed.slice(-limit);
    }
    
    getQueueStats() {
        const stats = {};
        for (const [priority, queue] of Object.entries(this.queues)) {
            stats[PriorityNames[priority]] = queue.length;
        }
        return stats;
    }
    
    getStats() {
        return {
            ...this.stats,
            running: this.running.size,
            queued: this.getQueueLength(),
            maxConcurrent: this.maxConcurrent,
            queues: this.getQueueStats(),
            uptime: Date.now() - this.stats.startTime || 0
        };
    }
    
    // ============ Control ============
    
    pause() {
        this.isProcessing = false;
        this.emit('paused');
        logger.info('Scheduler paused');
    }
    
    resume() {
        if (!this.isProcessing) {
            this.isProcessing = true;
            this.processLoop();
            this.emit('resumed');
            logger.info('Scheduler resumed');
        }
    }
    
    clear() {
        this.cancelAll();
        for (const priority of Object.values(Priority)) {
            this.queues[priority] = [];
        }
        this.emit('cleared');
        logger.info('Scheduler cleared');
    }
    
    reset() {
        this.clear();
        this.completed = [];
        this.taskMap.clear();
        this.stats = {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            cancelledTasks: 0,
            averageWaitTime: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0
        };
        this.emit('reset');
        logger.info('Scheduler reset');
    }
}

export default RenderScheduler;
export { Priority, PriorityNames };