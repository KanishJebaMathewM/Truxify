import crypto from 'crypto';

/**
 * GraphQL Automatic Persisted Queries (APQ) & CDN Edge Caching Middleware
 */
export class GraphqlPersistedQueriesEngine {
  constructor() {
    this.hashStore = new Map();
  }

  registerQuery(queryString) {
    const hash = crypto.createHash('sha256').update(queryString).digest('hex');
    this.hashStore.set(hash, queryString);
    return hash;
  }

  getQueryByHash(hash) {
    return this.hashStore.get(hash) || null;
  }

  processEdgeRequest(queryHash, fullQueryString = null) {
    if (fullQueryString) {
      const generatedHash = this.registerQuery(fullQueryString);
      if (generatedHash !== queryHash) {
        throw new Error("InvalidQueryHash: Query hash does not match content");
      }
      return { status: "registered", query: fullQueryString };
    }

    const cachedQuery = this.getQueryByHash(queryHash);
    if (!cachedQuery) {
      return { status: "APQ_miss", error: "PersistedQueryNotFound" };
    }

    return { status: "APQ_hit", query: cachedQuery };
  }
}

export const persistedQueriesEngine = new GraphqlPersistedQueriesEngine();
