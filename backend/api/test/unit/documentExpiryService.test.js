import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const supabaseInsertMock = vi.fn().mockResolvedValue({ error: null });
const supabaseSelectMock = vi.fn();
const redisSetMock = vi.fn();
const redisDelMock = vi.fn();

function createChainableTerminal(finalFn) {
  const handler = {
    get(target, prop) {
      if (prop === 'then') {
        return (resolve, reject) => {
          try {
            const result = finalFn();
            return Promise.resolve(result).then(resolve, reject);
            .catch(err=>console.error(err))