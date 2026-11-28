# Invoice Mobile Pro

Status: specification only; implementation pending. Preserve existing purchase, sales, returns, free invoices, tax, discounts, classification and posting behavior.

Design tokens: primary #08785F, heading #174B76, card #F4F7FA, field #FFFFFF, border #D5DEE5, text #172536, danger #DC3545. Card min-height 64px, input min-height 48px, button min-height 44px, card radius 12px, input radius 10px, padding 12px, gap 8px. Allow content expansion for accessibility. RTL and dark theme equivalents required.

Items: stable row IDs, quantity/price/total alignment, no horizontal overflow at 320px viewport. Search by name, code and barcode; debounce 250ms, asynchronous non-blocking lookup, cancel or ignore stale results using request generations, stable loading/empty/error states and accessible dropdown. Preserve focus and entered values.

Modal: fixed header, independently scrolling body, sticky footer, adaptive viewport height. Use feature detection and fallback for WebView 83; account for native IME insets without double padding. Keep focused fields and actions visible above keyboard, avoid layout shifts and nested scrolling traps.

Drafts: persist per workspace/user/document using existing draft mechanism; debounce writes, flush on lifecycle transitions when possible, recover after process restart; never auto-post. Clear only after confirmed durable posting or explicit discard. Do not expose sensitive drafts across workspaces. Preserve idempotency on lost acknowledgments.

Acceptance: purchase/sales/return/free invoice regression; rapid search with out-of-order results; empty/error/loading; keyboard open/close and focused field visibility on Android WebView 83; 320/360/412px RTL layouts; large item lists; draft recovery after process death; posting failure and retry; no horizontal scroll. Measure responsiveness and layout shifts rather than claiming zero jank without evidence. No production changes or data migration implied by this specification.
