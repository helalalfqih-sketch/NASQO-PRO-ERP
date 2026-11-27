// UTF-16 code units, matching Dart String.length. Keep action budgets aligned
// with HybridReadOnlyProtocol; rows/fields are validated again by SQLite commands.
export const MAX_HYBRID_REQUEST_LENGTH = 16 * 1024 * 1024;
export function hybridRequestLengthLimit(action: string): number {
  if (action === 'importInventoryItems' || action === 'importAccountCards') return MAX_HYBRID_REQUEST_LENGTH;
  if (['saveErpRecords', 'batchUpdateInventoryItems', 'createLedgerEntry', 'updateLedgerEntry'].includes(action)) return 2 * 1024 * 1024;
  return 32768;
}
