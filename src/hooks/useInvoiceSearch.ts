import { useEffect, useState } from 'react';
import type { InventoryItemRecord } from '../types';
import { searchInvoiceItems } from '../utils/invoiceSearch';

export function useInvoiceSearch(inventory: readonly InventoryItemRecord[], query: string, warehouse: string, native: boolean, open: boolean) {
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([query, warehouse, native, open, retry]);
  const [state, setState] = useState<{ key: string; inventory?: readonly InventoryItemRecord[]; results: InventoryItemRecord[]; error?: string }>({ key: '', results: [] });
  useEffect(() => {
    if (!open || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchInvoiceItems(inventory, query, warehouse, native, controller.signal)
        .then(results => { if (!controller.signal.aborted) setState({ key, inventory, results }); })
        .catch(error => { if (!controller.signal.aborted) setState({ key, inventory, results: [], error: 'تعذر البحث عن الأصناف. أعد المحاولة.' }); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [inventory, query, warehouse, native, open, key]);
  const ready = state.key === key && state.inventory === inventory;
  return { results: ready ? state.results : [], loading: open && Boolean(query.trim()) && !ready,
    error: ready ? state.error : undefined, retry: () => setRetry(n => n + 1) };
}
