import { InputError } from "./smartproPolicy.ts";

/**
 * Historical movement reconstruction. It is NOT certified opening or
 * available inventory; retired warehouses and legacy adjustments may differ.
 * Never use these estimated quantities to authorize new sales by themselves.
 */
export const STOCK_MOVEMENTS_SQL = `
SELECT m.product_id AS productId,p.name AS productName,p.unit AS unit,
 m.store_id AS warehouseId,s.name AS warehouseName,s.state AS warehouseState,
 CAST(SUM(m.sale_qty) AS DECIMAL(24,4)) AS saleQuantity,
 CAST(SUM(m.purchase_qty) AS DECIMAL(24,4)) AS purchaseQuantity,
 CAST(SUM(m.sale_return_qty) AS DECIMAL(24,4)) AS saleReturnQuantity,
 CAST(SUM(m.purchase_return_qty) AS DECIMAL(24,4)) AS purchaseReturnQuantity,
 CAST(SUM(m.transfer_in_qty) AS DECIMAL(24,4)) AS transferInQuantity,
 CAST(SUM(m.transfer_out_qty) AS DECIMAL(24,4)) AS transferOutQuantity,
 CAST(SUM(m.opening_like_qty) AS DECIMAL(24,4)) AS openingLikeQuantity,
 CAST(SUM(m.signed_qty) AS DECIMAL(24,4)) AS netMovementQuantity
FROM (
 SELECT d.prod_id AS product_id,d.store_id AS store_id,
 CASE WHEN b.doc_type=2 THEN CAST(d.amount AS DECIMAL(24,4)) ELSE 0 END AS sale_qty,
 CASE WHEN b.doc_type=3 THEN CAST(d.amount AS DECIMAL(24,4)) ELSE 0 END AS purchase_qty,
 CASE WHEN b.doc_type=4 THEN CAST(d.amount AS DECIMAL(24,4)) ELSE 0 END AS sale_return_qty,
 CASE WHEN b.doc_type=5 THEN CAST(d.amount AS DECIMAL(24,4)) ELSE 0 END AS purchase_return_qty,
 CAST(0 AS DECIMAL(24,4)) AS transfer_in_qty,
 CAST(0 AS DECIMAL(24,4)) AS transfer_out_qty,
 CAST(0 AS DECIMAL(24,4)) AS opening_like_qty,
 CASE b.doc_type WHEN 2 THEN -CAST(d.amount AS DECIMAL(24,4))
 WHEN 3 THEN CAST(d.amount AS DECIMAL(24,4))
 WHEN 4 THEN CAST(d.amount AS DECIMAL(24,4))
 WHEN 5 THEN -CAST(d.amount AS DECIMAL(24,4))
 ELSE 0 END AS signed_qty
 FROM bill_details d JOIN bounds b ON b.id=d.bill_id WHERE b.doc_type IN (2,3,4,5)
 UNION ALL
 SELECT d.prod_id,t.store_id1,0,0,0,0,0,CAST(d.amount AS DECIMAL(24,4)),0,
   -CAST(d.amount AS DECIMAL(24,4))
 FROM trans_details d JOIN store_trans t ON t.id=d.bill_id WHERE t.type=1
 UNION ALL
 SELECT d.prod_id,t.store_id2,0,0,0,0,
 CASE WHEN t.type=1 THEN CAST(d.amount AS DECIMAL(24,4)) ELSE 0 END,
 0,
 CASE WHEN t.type=3 THEN CAST(d.amount AS DECIMAL(24,4)) ELSE 0 END,
 CAST(d.amount AS DECIMAL(24,4))
 FROM trans_details d JOIN store_trans t ON t.id=d.bill_id WHERE t.type IN (1,3)
) m LEFT JOIN products p ON p.id=m.product_id
 LEFT JOIN stores s ON s.id=m.store_id
GROUP BY m.product_id,p.name,p.unit,m.store_id,s.id,s.name,s.state
ORDER BY m.product_id,m.store_id`;

export const TRANSFER_INTEGRITY_SQL = `
SELECT t.type AS transferType,t.store_id1 AS sourceWarehouseId,t.store_id2 AS destinationWarehouseId,
 COUNT(*) AS documents,
 SUM(s1.id IS NULL AND t.store_id1<>0) AS unknownSources,
 SUM(s2.id IS NULL) AS unknownDestinations
FROM store_trans t LEFT JOIN stores s1 ON s1.id=t.store_id1
 LEFT JOIN stores s2 ON s2.id=t.store_id2
GROUP BY t.type,t.store_id1,t.store_id2 ORDER BY documents DESC`;

export const DOCUMENT_SUMMARY_SQL = `
SELECT b.doc_type AS documentType,COUNT(*) AS documents,
 CAST(SUM(CAST(b.dain AS DECIMAL(24,4))) AS DECIMAL(24,4)) AS dainTotal,
 CAST(SUM(CAST(b.madin AS DECIMAL(24,4))) AS DECIMAL(24,4)) AS madinTotal,
 SUM(b.cboxid<>0) AS cashboxLinked
FROM bounds b GROUP BY b.doc_type ORDER BY b.doc_type`;

export const ACCOUNT_STATEMENT_SQL = `
SELECT b.id,b.date,b.doc_type AS documentType,b.details,b.bill,b.ref,
 b.cur_id AS currencyId,c.name AS currencyName,b.cboxid AS cashboxId,b.dain,b.madin
FROM bounds b LEFT JOIN currencies c ON c.id=b.cur_id
WHERE b.acc_id=? AND b.date>=? AND b.date<=?
ORDER BY b.date DESC,b.id DESC LIMIT ? OFFSET ?`;

export const ACCOUNT_TOTALS_SQL = `
SELECT b.cur_id AS currencyId,MAX(c.name) AS currencyName,COUNT(*) AS documents,
 CAST(SUM(CAST(b.dain AS DECIMAL(24,4))) AS DECIMAL(24,4)) AS dainTotal,
 CAST(SUM(CAST(b.madin AS DECIMAL(24,4))) AS DECIMAL(24,4)) AS madinTotal
FROM bounds b LEFT JOIN currencies c ON c.id=b.cur_id
WHERE b.acc_id=? AND b.date>=? AND b.date<=?
GROUP BY b.cur_id ORDER BY b.cur_id`;

export type StockMovementRow = {
 productId:number;productName:string|null;unit:string|null;
 warehouseId:number;warehouseName:string|null;warehouseState:number|null;
 saleQuantity:string;purchaseQuantity:string;saleReturnQuantity:string;
 purchaseReturnQuantity:string;transferInQuantity:string;
 transferOutQuantity:string;openingLikeQuantity:string;netMovementQuantity:string;
};
export type TransferIntegrityRow = {
 transferType:number;sourceWarehouseId:number;destinationWarehouseId:number;
 documents:number;unknownSources:number;unknownDestinations:number;
};

export function stockFindings(rows:readonly StockMovementRow[],links:readonly TransferIntegrityRow[]) {
 const missing=new Set<number>(),negativeProducts=new Set<number>();
 let negativePositions=0,negativeActivePositions=0,unresolvedPositions=0,unknownProducts=0;
 const numericIssues:string[]=[];
 for(const r of rows) {
  const n=Number(r.netMovementQuantity);
  if(!Number.isFinite(n))numericIssues.push(String(r.productId)+":"+String(r.warehouseId));
  if(n<0) {
   negativePositions++;negativeProducts.add(r.productId);
   if(r.warehouseState===1)negativeActivePositions++;
  }
  if(r.warehouseName===null){unresolvedPositions++;missing.add(r.warehouseId)}
  if(r.productName===null)unknownProducts++;
 }
 for(const l of links) {
  if(Number(l.unknownSources)>0)missing.add(l.sourceWarehouseId);
  if(Number(l.unknownDestinations)>0)missing.add(l.destinationWarehouseId);
 }
 return {
  status:"RECONCILIATION_REQUIRED" as const,
  positions:rows.length,negativePositions,negativeActivePositions,
  negativeProducts:negativeProducts.size,unresolvedPositions,unknownProducts,
  missingWarehouseIds:[...missing].sort((a,b)=>a-b),
  unknownSourceTransfers:links.reduce((n,r)=>n+Number(r.unknownSources),0),
  unknownDestinationTransfers:links.reduce((n,r)=>n+Number(r.unknownDestinations),0),
  numericIssues:numericIssues.slice(0,10),
  explanations:[
   "الأرصدة تقدير لحركة الفواتير والتحويلات فقط، وليست جردًا افتتاحيًا معتمدًا.",
   "نوع التحويل 3 عومل كتسوية أو افتتاح محتمل؛ معناه الأصلي لم يُعتمد بعد.",
   "توجد مراجع لمخازن تاريخية محذوفة أو غير نشطة.",
  ],
 };
}
export function requireIsoDate(value:unknown,fallback:string):string {
 const s=value===undefined?fallback:String(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||
  new Date(s+"T00:00:00Z").toISOString().slice(0,10)!==s)throw new InputError("التاريخ غير صالح.");
 return s;
}
export function pageParams(offset:unknown,limit:unknown,max=100) {
 const n=offset===undefined?0:Number(offset), size=limit===undefined?40:Number(limit);
 if(!Number.isSafeInteger(n)||n<0||n>100000||!Number.isSafeInteger(size)||size<1||size>max)
  throw new InputError("حدود الصفحة غير صحيحة.");
 return {offset:n,limit:size};
}
