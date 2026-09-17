/**
 * @fileoverview Comprehensive chainable mock for Supabase PostgREST query builder.
 * Resolves Issue #10103: The previous mock lacked `.range()` causing `getFraudStats` to throw.
 * 
 * This mock simulates the fluent API of the Supabase JS client, allowing tests
 * to chain methods like `.select()`, `.eq()`, `.order()`, `.range()`, and `.limit()`
 * without throwing "is not a function" errors. It resolves to a predictable
 * `{ data, error }` structure when awaited.
 */

export class MockQueryBuilder {
    constructor(tableName, initialData = [], initialError = null) {
        this.tableName = tableName;
        this.data = initialData;
        this.error = initialError;
        this.filters = [];
        this.orderByClause = null;
        this.rangeClause = null;
        this.limitClause = null;
        this.isSingle = false;
        this.isMaybeSingle = false;
    }

    /**
     * Simulates .select() - returns this for chaining.
     * @param {string} columns 
     * @returns {MockQueryBuilder}
     */
    select(columns) {
        this.selectedColumns = columns;
        return this;
    }

    /**
     * Simulates .eq() - records the filter for potential assertion in tests.
     * @param {string} column 
     * @param {any} value 
     * @returns {MockQueryBuilder}
     */
    eq(column, value) {
        this.filters.push({ type: 'eq', column, value });
        return this;
    }

    /**
     * Simulates .neq()
     */
    neq(column, value) {
        this.filters.push({ type: 'neq', column, value });
        return this;
    }

    /**
     * Simulates .gt()
     */
    gt(column, value) {
        this.filters.push({ type: 'gt', column, value });
        return this;
    }

    /**
     * Simulates .lt()
     */
    lt(column, value) {
        this.filters.push({ type: 'lt', column, value });
        return this;
    }

    /**
     * Simulates .gte()
     */
    gte(column, value) {
        this.filters.push({ type: 'gte', column, value });
        return this;
    }

    /**
     * Simulates .lte()
     */
    lte(column, value) {
        this.filters.push({ type: 'lte', column, value });
        return this;
    }

    /**
     * Simulates .in()
     */
    in(column, values) {
        this.filters.push({ type: 'in', column, values });
        return this;
    }

    /**
     * Simulates .contains()
     */
    contains(column, value) {
        this.filters.push({ type: 'contains', column, value });
        return this;
    }

    /**
     * Simulates .order()
     * @param {string} column 
     * @param {object} options - e.g., { ascending: false }
     * @returns {MockQueryBuilder}
     */
    order(column, options = { ascending: true }) {
        this.orderByClause = { column, ascending: options.ascending };
        return this;
    }

    /**
     * Simulates .range() - CRITICAL FIX for Issue #10103.
     * Used for paginated reads in FraudDetectionService.getFraudStats.
     * @param {number} from - Start index (inclusive)
     * @param {number} to - End index (inclusive)
     * @returns {MockQueryBuilder}
     */
    range(from, to) {
        this.rangeClause = { from, to };
        return this;
    }

    /**
     * Simulates .limit()
     * @param {number} count 
     * @returns {MockQueryBuilder}
     */
    limit(count) {
        this.limitClause = count;
        return this;
    }

    /**
     * Simulates .single() - expects exactly one row.
     * @returns {MockQueryBuilder}
     */
    single() {
        this.isSingle = true;
        return this;
    }

    /**
     * Simulates .maybeSingle() - expects zero or one row.
     * @returns {MockQueryBuilder}
     */
    maybeSingle() {
        this.isMaybeSingle = true;
        return this;
    }

    /**
     * Applies the recorded filters, sorting, and pagination to the mock data.
     * @returns {any[]} Processed data array.
     */
    _applyOperations() {
        let result = [...this.data];

        // Basic filtering simulation
        for (const filter of this.filters) {
            if (filter.type === 'eq') {
                result = result.filter(row => row[filter.column] === filter.value);
            } else if (filter.type === 'neq') {
                result = result.filter(row => row[filter.column] !== filter.value);
            } else if (filter.type === 'gt') {
                result = result.filter(row => row[filter.column] > filter.value);
            } else if (filter.type === 'lt') {
                result = result.filter(row => row[filter.column] < filter.value);
            } else if (filter.type === 'gte') {
                result = result.filter(row => row[filter.column] >= filter.value);
            } else if (filter.type === 'lte') {
                result = result.filter(row => row[filter.column] <= filter.value);
            }
        }

        // Sorting simulation
        if (this.orderByClause) {
            const { column, ascending } = this.orderByClause;
            result.sort((a, b) => {
                if (a[column] < b[column]) return ascending ? -1 : 1;
                if (a[column] > b[column]) return ascending ? 1 : -1;
                return 0;
            });
        }

        // Range (pagination) simulation - The core fix for #10103
        if (this.rangeClause) {
            const { from, to } = this.rangeClause;
            // Supabase range is inclusive on both ends
            result = result.slice(from, to + 1);
        }

        // Limit simulation
        if (this.limitClause !== null && this.limitClause !== undefined) {
            result = result.slice(0, this.limitClause);
        }

        return result;
    }

    /**
     * Resolves the query when awaited or when .then() is called.
     * @returns {Promise<{data: any, error: any}>}
     */
    then(resolve, reject) {
        try {
            if (this.error) {
                return resolve({ data: null, error: this.error });
            }

            const processedData = this._applyOperations();

            if (this.isSingle) {
                if (processedData.length !== 1) {
                    return resolve({
                        data: null,
                        error: { code: 'PGRST116', message: 'The result contains 0 or more than 1 rows' }
                    });
                }
                return resolve({ data: processedData[0], error: null });
            }

            if (this.isMaybeSingle) {
                return resolve({ data: processedData[0] || null, error: null });
            }

            return resolve({ data: processedData, error: null });
        } catch (err) {
            if (reject) return reject(err);
            return resolve({ data: null, error: err });
        }
    }
}

/**
 * Factory function to create a mock Supabase client.
 * @param {object} options 
 * @param {object} options.tables - Map of table names to mock data arrays.
 * @returns {object} Mock supabaseAdmin client.
 */
export function createSupabaseMock(options = {}) {
    const tables = options.tables || {};
    const errors = options.errors || {};

    return {
        from: (tableName) => {
            const tableData = tables[tableName] || [];
            const tableError = errors[tableName] || null;
            return new MockQueryBuilder(tableName, tableData, tableError);
        },
        rpc: async (fnName, params) => {
            if (options.rpcMocks && options.rpcMocks[fnName]) {
                return options.rpcMocks[fnName](params);
            }
            return { data: null, error: { message: `RPC ${fnName} not mocked` } };
        }
    };
}
