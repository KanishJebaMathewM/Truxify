/**
 * Conservative recovery for unordered inserts. Only a complete, consistent
 * indexed result can prove non-error records inserted; uncertain outcomes retry.
 */
export function classifyTelemetryBulkOutcome(records, error) {
  const unknown = () => ({ inserted: [], invalid: [], retry: records });
  try {
    if (!['MongoBulkWriteError', 'BulkWriteError'].includes(error?.name)) return unknown();
    // Concern/network wrappers can expose indexed results only through the
    // native BulkWriteResult even when their own writeErrors array is empty.
    const writeErrors = error.writeErrors?.length ? error.writeErrors : error.result?.getWriteErrors?.();
    if (!Array.isArray(writeErrors) || writeErrors.length === 0) return unknown();
    const byIndex = new Map();
    for (const item of writeErrors) {
      if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= records.length ||
          !Number.isInteger(item.code) || byIndex.has(item.index)) return unknown();
      byIndex.set(item.index, item.code);
    }
    const result = error.result;
    const expectedInserted = records.length - byIndex.size;
    const ids = result?.insertedIds;
    const idIndices = ids && typeof ids === 'object' ? Object.keys(ids) : [];
    const complete = result?.ok === 1 &&
      Number.isInteger(result.insertedCount) && result.insertedCount === expectedInserted &&
      idIndices.length === expectedInserted && idIndices.every((key) =>
        /^(0|[1-9]\d*)$/.test(key) && Number(key) < records.length && !byIndex.has(Number(key))) &&
      typeof result.getWriteConcernError === 'function' && !result.getWriteConcernError() &&
      !error.writeConcernError && !(error.writeConcernErrors?.length);
    const inserted = [], invalid = [], retry = [];
    records.forEach((record, index) => {
      if (byIndex.get(index) === 121) invalid.push(record);
      else if (complete && !byIndex.has(index)) inserted.push(record);
      else retry.push(record);
    });
    return { inserted, invalid, retry };
  } catch {
    // Broken/custom getters or malformed result metadata must not lose records.
    return unknown();
  }
}
