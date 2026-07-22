import { EventEmitter } from 'events';
import logger from '../../api/src/middleware/logger.js';

class StoreTransaction {
    constructor(store) {
        this.store = store;
        this.snapshot = null;
        this.isActive = false;
        this.operations = [];
        this.error = null;
        this.startTime = null;
        this.endTime = null;
        this.id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    begin() {
        if (this.isActive) {
            throw new Error('Transaction already active');
        }
        
        this.snapshot = this.store.createSnapshot();
        this.isActive = true;
        this.startTime = Date.now();
        this.store.emit('transactionStarted', { id: this.id });
        logger.debug(`Transaction ${this.id} started`);
        
        return this;
    }
    
    addOperation(operation) {
        if (!this.isActive) {
            throw new Error('Transaction not active');
        }
        
        this.operations.push(operation);
        return this;
    }
    
    async execute(operation) {
        if (!this.isActive) {
            throw new Error('Transaction not active');
        }
        
        try {
            const result = await operation();
            this.operations.push({ type: 'execute', result });
            return result;
        } catch (error) {
            this.error = error;
            await this.rollback();
            throw error;
        }
    }
    
    async commit() {
        if (!this.isActive) {
            throw new Error('Transaction not active');
        }
        
        this.endTime = Date.now();
        this.isActive = false;
        
        this.store.emit('transactionCommitted', {
            id: this.id,
            duration: this.endTime - this.startTime,
            operationCount: this.operations.length
        });
        
        logger.debug(`Transaction ${this.id} committed (${this.operations.length} operations)`);
        
        return {
            id: this.id,
            duration: this.endTime - this.startTime,
            operationCount: this.operations.length
        };
    }
    
    async rollback() {
        if (!this.isActive) {
            throw new Error('Transaction not active');
        }
        
        if (this.snapshot) {
            this.store.restoreSnapshot(this.snapshot);
        }
        
        this.endTime = Date.now();
        this.isActive = false;
        
        this.store.emit('transactionRolledBack', {
            id: this.id,
            duration: this.endTime - this.startTime,
            error: this.error
        });
        
        logger.warn(`Transaction ${this.id} rolled back`, { error: this.error });
        
        return {
            id: this.id,
            duration: this.endTime - this.startTime,
            error: this.error
        };
    }
}

class GlobalStore extends EventEmitter {
    constructor(initialState = {}) {
        super();
        this.state = initialState;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 100;
        this.activeTransaction = null;
        this.transactionHistory = [];
        this.isTracking = true;
        this.listeners = new Map();
        this.id = `store_${Date.now()}`;
        
        logger.info('✅ GlobalStore initialized');
    }
    
    // ============ State Management ============
    
    get(key) {
        if (key !== undefined) {
            return this.state[key];
        }
        return this.state;
    }
    
    set(key, value) {
        if (!this.isTracking) {
            this.state[key] = value;
            return;
        }
        
        // Save history for undo
        this.saveHistory();
        
        const oldValue = this.state[key];
        this.state[key] = value;
        
        this.emit('stateChanged', { key, oldValue, newValue: value });
        this.notifyListeners(key, value);
        
        logger.debug(`State updated: ${key} = ${JSON.stringify(value)}`);
    }
    
    update(updates) {
        if (!this.isTracking) {
            Object.assign(this.state, updates);
            return;
        }
        
        this.saveHistory();
        const oldState = { ...this.state };
        Object.assign(this.state, updates);
        
        this.emit('stateUpdated', { oldState, newState: this.state });
        
        for (const [key, value] of Object.entries(updates)) {
            this.notifyListeners(key, value);
        }
        
        logger.debug(`State updated: ${Object.keys(updates).join(', ')}`);
    }
    
    saveHistory() {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        this.history.push({ ...this.state });
        this.historyIndex = this.history.length - 1;
        
        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.historyIndex--;
        }
    }
    
    // ============ Transaction Support ============
    
    transaction(fn) {
        if (this.activeTransaction) {
            throw new Error('Nested transactions not supported');
        }
        
        const transaction = new StoreTransaction(this);
        
        try {
            transaction.begin();
            this.activeTransaction = transaction;
            
            const result = fn(transaction);
            
            // Handle promise
            if (result && typeof result.then === 'function') {
                return result
                    .then(async (res) => {
                        await transaction.commit();
                        this.activeTransaction = null;
                        this.transactionHistory.push({
                            id: transaction.id,
                            type: 'commit',
                            timestamp: Date.now()
                        });
                        return res;
                    })
                    .catch(async (error) => {
                        await transaction.rollback();
                        this.activeTransaction = null;
                        this.transactionHistory.push({
                            id: transaction.id,
                            type: 'rollback',
                            error: error.message,
                            timestamp: Date.now()
                        });
                        throw error;
                    });
            }
            
            // Sync result
            transaction.commit();
            this.activeTransaction = null;
            this.transactionHistory.push({
                id: transaction.id,
                type: 'commit',
                timestamp: Date.now()
            });
            
            return result;
            
        } catch (error) {
            transaction.rollback();
            this.activeTransaction = null;
            this.transactionHistory.push({
                id: transaction.id,
                type: 'rollback',
                error: error.message,
                timestamp: Date.now()
            });
            throw error;
        }
    }
    
    async transactionAsync(fn) {
        return this.transaction(fn);
    }
    
    createSnapshot() {
        return {
            state: { ...this.state },
            timestamp: Date.now(),
            id: `snapshot_${Date.now()}`
        };
    }
    
    restoreSnapshot(snapshot) {
        if (!snapshot || !snapshot.state) {
            throw new Error('Invalid snapshot');
        }
        
        const oldState = { ...this.state };
        this.state = { ...snapshot.state };
        
        this.emit('snapshotRestored', { oldState, newState: this.state });
        logger.debug(`Snapshot restored: ${snapshot.id}`);
    }
    
    // ============ Undo/Redo ============
    
    undo() {
        if (this.historyIndex <= 0) {
            logger.warn('Nothing to undo');
            return false;
        }
        
        this.historyIndex--;
        const oldState = { ...this.state };
        this.state = { ...this.history[this.historyIndex] };
        
        this.emit('undo', { oldState, newState: this.state });
        logger.debug('Undo performed');
        
        return true;
    }
    
    redo() {
        if (this.historyIndex >= this.history.length - 1) {
            logger.warn('Nothing to redo');
            return false;
        }
        
        this.historyIndex++;
        const oldState = { ...this.state };
        this.state = { ...this.history[this.historyIndex] };
        
        this.emit('redo', { oldState, newState: this.state });
        logger.debug('Redo performed');
        
        return true;
    }
    
    canUndo() {
        return this.historyIndex > 0;
    }
    
    canRedo() {
        return this.historyIndex < this.history.length - 1;
    }
    
    // ============ Listeners ============
    
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key).push(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index !== -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }
    
    notifyListeners(key, value) {
        const callbacks = this.listeners.get(key);
        if (callbacks) {
            for (const callback of callbacks) {
                try {
                    callback(value);
                } catch (error) {
                    logger.error(`Listener error for ${key}:`, error);
                }
            }
        }
    }
    
    // ============ Atomic Updates ============
    
    atomic(updates) {
        this.saveHistory();
        const oldState = { ...this.state };
        
        try {
            Object.assign(this.state, updates);
            this.emit('atomicUpdate', { oldState, newState: this.state });
            logger.debug(`Atomic update: ${Object.keys(updates).join(', ')}`);
        } catch (error) {
            // Rollback on error
            this.state = oldState;
            throw error;
        }
    }
    
    // ============ Queries ============
    
    getHistory() {
        return this.history.slice(Math.max(0, this.historyIndex - 20), this.historyIndex + 1);
    }
    
    getTransactionHistory() {
        return this.transactionHistory.slice(-50);
    }
    
    getStats() {
        return {
            id: this.id,
            stateSize: Object.keys(this.state).length,
            historySize: this.history.length,
            historyIndex: this.historyIndex,
            transactionCount: this.transactionHistory.length,
            activeTransaction: !!this.activeTransaction,
            listenerCount: this.listeners.size,
            isTracking: this.isTracking,
            maxHistory: this.maxHistory,
            timestamp: new Date().toISOString()
        };
    }
    
    // ============ Control ============
    
    enableTracking() {
        this.isTracking = true;
        this.emit('trackingEnabled');
        logger.debug('Tracking enabled');
    }
    
    disableTracking() {
        this.isTracking = false;
        this.emit('trackingDisabled');
        logger.debug('Tracking disabled');
    }
    
    reset() {
        this.state = {};
        this.history = [];
        this.historyIndex = -1;
        this.transactionHistory = [];
        this.listeners.clear();
        this.emit('reset');
        logger.info('Store reset');
    }
}

export default GlobalStore;