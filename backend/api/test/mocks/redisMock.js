class RedisMock {
    constructor() {
        this.store = new Map();
        this.expirations = new Map();
    }

    async set(key, value, ...rest) {
        // Accept both node-redis ({ EX }) and ioredis ('EX', seconds) styles.
        const options = rest[0] && typeof rest[0] === 'object' ? rest[0]
          : rest[0] === 'EX' ? { EX: rest[1] }
          : rest[0] === 'PX' ? { PX: rest[1] }
          : rest[0] === 'NX' ? { NX: true }
          : undefined;
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

    async keys(pattern) {
        // Minimal glob: only trailing-star prefixes are needed by the suites.
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            return [...this.store.keys()].filter((k) => k.startsWith(prefix));
        }
        return this.store.has(pattern) ? [pattern] : [];
    }

    async del(...keys) {
        let n = 0;
        for (const key of keys) {
            if (this.store.delete(key)) n++;
            this.expirations.delete(key);
        }
        return n;
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

    async rpush(key, value) {
        const list = this.store.get(key) || [];
        list.push(value);
        this.store.set(key, list);
        return list.length;
    }

    async ltrim(key, start, stop) {
        // Redis LTRIM keeps [start, stop] inclusive; negatives index from the end.
        const list = this.store.get(key) || [];
        const n = list.length;
        const s = start < 0 ? Math.max(n + start, 0) : Math.min(start, n);
        const e = stop < 0 ? n + stop : Math.min(stop, n - 1);
        this.store.set(key, s > e ? [] : list.slice(s, e + 1));
        return 'OK';
    }

    async llen(key) {
        const list = this.store.get(key) || [];
        return list.length;
    }

    async lrange(key, start, stop) {
        const list = this.store.get(key) || [];
        const n = list.length;
        const s = start < 0 ? Math.max(n + start, 0) : Math.min(start, n);
        const e = stop < 0 ? n + stop : Math.min(stop, n - 1);
        return s > e ? [] : list.slice(s, e + 1);
    }

    async expire(key, seconds) {
        if (!this.store.has(key)) return 0;
        this.expirations.set(key, Date.now() + seconds * 1000);
        return 1;
    }

    pipeline() {
        // ioredis-style deferred pipeline: collect, then exec in order.
        const ops = [];
        const self = this;
        const api = {
            exec: async () => {
                const results = [];
                for (const [fn, args] of ops) results.push([null, await fn(...args)]);
                return results;
            },
        };
        for (const name of ['rpush', 'ltrim', 'expire', 'set', 'del']) {
            api[name] = (...args) => { ops.push([self[name].bind(self), args]); return api; };
        }
        return api;
    }

    clear() {
        this.store.clear();
        this.expirations.clear();
    }
}

export { RedisMock };
export default RedisMock;
