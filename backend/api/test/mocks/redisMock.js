class RedisMock {
    constructor() {
        this.store = new Map();
        this.expirations = new Map();
    }

    async set(key, value, options) {
        this.store.set(key, value);
        if (options && options.EX) {
            this.expirations.set(key, Date.now() + options.EX * 1000);
        } else if (options && options.PX) {
            this.expirations.set(key, Date.now() + options.PX);
        } else if (options && options.NX && this.store.has(key)) {
            return null;
        }
        return 'OK';
    }

    async get(key) {
        if (this.expirations.has(key) && Date.now() > this.expirations.get(key)) {
            this.store.delete(key);
            this.expirations.delete(key);
            return null;
        }
        return this.store.get(key) || null;
    }

    async del(key) {
        this.store.delete(key);
        this.expirations.delete(key);
        return 1;
    }

    async eval(luaScript, keys, args) {
        const key = keys[0];
        const lockValue = args[0];
        const ttl = parseInt(args[1], 10);

        if (luaScript.includes('if redis.call("get", KEYS[1]) == ARGV[1]')) {
            const currentValue = await this.get(key);
            if (currentValue === lockValue) {
                await this.del(key);
                return 1;
            }
            return 0;
        }

        if (luaScript.includes('return redis.call("set", KEYS[1], ARGV[1], "NX", "PX", ARGV[2])')) {
            const result = await this.set(key, lockValue, { PX: ttl, NX: true });
            return result === 'OK' ? 1 : 0;
        }

        // Sequence gate (locationServer.applySequenceGate): ioredis-style
        // eval(script, numKeys, key, ...args) — accept when the incoming epoch
        // is newer than the stored one, then persist it.
        if (luaScript.includes("local incoming = tonumber(ARGV[1])")) {
            const seqKey = Array.isArray(keys) ? keys[0] : args;
            const incomingEpoch = Array.isArray(keys) ? args[0] : arguments[3];
            const current = await this.get(seqKey);
            if (current != null && Number(incomingEpoch) <= Number(current)) {
                return 0;
            }
            await this.set(seqKey, String(incomingEpoch));
            return 1;
        }

        return 0;
    }

    clear() {
        this.store.clear();
        this.expirations.clear();
    }
}

export { RedisMock };
export default RedisMock;
