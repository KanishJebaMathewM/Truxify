class RedisMock {
    // The rate limiter's DeferredRedisStore promotes to Redis only when
    // status === 'ready' — report ready so the harness's clearAll() actually
    // resets limiter state between tests.
    status = 'ready';

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

    clearAll() {
        this.store.clear();
        this.expirations.clear();
    }

    async del(key) {
        this.store.delete(key);
        this.expirations.delete(key);
        return 1;
    }

    // ioredis-style generic command — rate-limit-redis's RedisStore uses
    // sendCommand('EVALSHA', sha, numKeys, key, ...args) via call().
    async call(command, ...args) {
        const cmd = String(command).toUpperCase();
        if (cmd === 'SCRIPT') return 'sha-mock-12345';
        if (cmd === 'EVALSHA' || cmd === 'EVAL') {
            // EVALSHA sha numkeys key ...args  |  EVAL script numkeys key ...args
            const numKeys = Number(args[1]);
            const keys = args.slice(2, 2 + numKeys);
            const rest = args.slice(2 + numKeys);
            const script = cmd === 'EVAL' ? args[0] : 'PTTL INCR GET'; // EVALSHA always the rate-limit script here
            return this.eval(script, keys, rest);
        }
        return null;
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

<<<<<<< Updated upstream
=======
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

        // rate-limit-redis scripts: increment (PTTL+SET-PX/INCR) and get
        // (GET+PTTL) — both return [count, ttlMs].
        if (luaScript.includes('PTTL') && luaScript.includes('INCR')) {
            const key = Array.isArray(keys) ? keys[0] : keys;
            const windowMs = parseInt(Array.isArray(args) ? args[0] : args, 10);
            const current = await this.get(key);
            if (current == null) {
                await this.set(key, 1, { PX: windowMs });
                return [1, windowMs];
            }
            const next = Number(current) + 1;
            await this.set(key, next);
            const ttl = this.expirations.has(key)
                ? Math.max(this.expirations.get(key) - Date.now(), 0)
                : windowMs;
            return [next, ttl];
        }
        if (luaScript.includes('PTTL') && luaScript.includes('GET')) {
            const key = Array.isArray(keys) ? keys[0] : keys;
            const current = await this.get(key);
            const ttl = this.expirations.has(key)
                ? Math.max(this.expirations.get(key) - Date.now(), 0)
                : -1;
            return [current == null ? 0 : Number(current), ttl];
        }

>>>>>>> Stashed changes
        return 0;
    }

    clear() {
        this.store.clear();
        this.expirations.clear();
    }
}

export { RedisMock };
export default RedisMock;
