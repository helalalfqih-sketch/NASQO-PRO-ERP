import { createHash } from "node:crypto";
import { validateInvoicePosting } from "./smartproInvoice.ts";
import { validateStockTransfer,quantityFixed,signedQuantityFixed } from "./smartproTransfer.ts";
import { validateReturnPosting,returnDocType,returnLineValue,returnFinancialSides } from "./smartproReturns.ts";
import { validateVoucher,voucherSides } from "./smartproVoucher.ts";
import { formatScaled,scaledPositive } from "./smartproInvoice.ts";
import { STOCK_MOVEMENTS_SQL, TRANSFER_INTEGRITY_SQL, DOCUMENT_SUMMARY_SQL, ACCOUNT_STATEMENT_SQL, ACCOUNT_TOTALS_SQL, stockFindings, pageParams, requireIsoDate, type StockMovementRow, type TransferIntegrityRow } from "./smartproReports.ts";
import type { Express, Request, Response, NextFunction } from "express";
import { Router } from "express";
import { initializeApp, getApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { TABLES, tableName, ident, editable, visible, validateFields, authorize, validId, requireDocumentWorkflow, InputError, type Role, type Column, type TableName } from "./smartproPolicy.ts";

type Actor = { uid: string; email: string; role: Role; bootstrap: boolean };
type DataRow = Record<string, unknown>;
type ActorRequest = Request & { smartproActor?: Actor };
const bootstrapAdmins = new Set((process.env.SMARTPRO_ADMIN_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
const verifiedProject = process.env.SMARTPRO_FIREBASE_PROJECT_ID ?? "";
const databaseName = process.env.SMARTPRO_DB_NAME ?? "smartprodb";
const enabled = () => Boolean(
  process.env.SMARTPRO_DB_HOST &&
  process.env.SMARTPRO_DB_USER &&
  process.env.SMARTPRO_DB_PASSWORD &&
  verifiedProject &&
  bootstrapAdmins.size
);
const writesEnabled = () => process.env.SMARTPRO_WRITE_ENABLED === "1";
let databasePool: Pool | undefined;

function pool(): Pool {
  if (!enabled()) throw new InputError("ربط قاعدة SmartPro غير مُفعّل على الخادم.", 503);
  if (!databasePool) {
    databasePool = mysql.createPool({
      host: process.env.SMARTPRO_DB_HOST!,
      port: Number(process.env.SMARTPRO_DB_PORT || "3306"),
      user: process.env.SMARTPRO_DB_USER!,
      password: process.env.SMARTPRO_DB_PASSWORD!,
      database: databaseName,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 20,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      charset: "utf8mb4",
      multipleStatements: false,
    });
  }
  return databasePool;
}
function publicRow(row: DataRow): DataRow {
  const copy = { ...row };
  delete copy.password;
  return copy;
}
function etag(row: DataRow): string {
  return createHash("sha256").update(JSON.stringify(publicRow(row))).digest("hex");
}
function actor(req: ActorRequest): Actor {
  if (!req.smartproActor) throw new InputError("يتطلب تسجيل الدخول.", 401);
  return req.smartproActor;
}
function requireWrite(role: Role, action: "create" | "update" | "delete" | "roles"): void {
  if (!writesEnabled()) throw new InputError("النسخة المركزية لم تُفعّل للتعديل بعد.", 503);
  authorize(role, action);
}
function asParam(req: Request, key: string): string {
  const raw = req.params[key];
  return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
}
async function columns(table: TableName): Promise<Column[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
    [databaseName, table],
  );
  if (!rows.length) throw new InputError("الجدول غير موجود في قاعدة SmartPro.", 404);
  return rows.map(row => ({
    name: String(row.COLUMN_NAME),
    type: String(row.DATA_TYPE),
    nullable: row.IS_NULLABLE === "YES",
    hasDefault: row.COLUMN_DEFAULT !== null && row.COLUMN_DEFAULT !== undefined,
    defaultValue: row.COLUMN_DEFAULT === null || row.COLUMN_DEFAULT === undefined ? null : String(row.COLUMN_DEFAULT),
    autoIncrement: String(row.EXTRA ?? "").includes("auto_increment"),
    maxLength: row.CHARACTER_MAXIMUM_LENGTH === null ? null : Number(row.CHARACTER_MAXIMUM_LENGTH),
  }));
}
async function lockedRow(conn: PoolConnection, table: TableName, id: string): Promise<DataRow | null> {
  const safe = ident(table);
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM " + safe + " WHERE id=? LIMIT 1 FOR UPDATE", [id]);
  return rows.length ? (rows[0] as DataRow) : null;
}
// SmartPro has ON DELETE CASCADE foreign keys. Capture every dependent row
// inside the same transaction before the database deletes it implicitly.
const CASCADE_CHILDREN: Partial<Record<TableName, readonly { table: TableName; foreignKey: string }[]>> = {
  bounds: [{ table: "bill_details", foreignKey: "bill_id" }, { table: "bill_details2", foreignKey: "bill_id" }],
  bin: [{ table: "bin_bill_details", foreignKey: "bill_id" }, { table: "bin_bill_details2", foreignKey: "bill_id" }],
  offers: [{ table: "offer_bill_details", foreignKey: "bill_id" }, { table: "offer_sbill_details", foreignKey: "bill_id" }],
  store_trans: [{ table: "trans_details", foreignKey: "bill_id" }],
  products: [{ table: "bin_bill_details", foreignKey: "prod_id" }],
};
const CASCADE_AUDIT_LIMIT = 2000;

async function audit(
  conn: PoolConnection,
  user: Actor,
  table: string,
  rowId: string,
  action: "insert" | "update" | "delete" | "grant" | "revoke",
  before: DataRow | null,
  after: DataRow | null,
): Promise<void> {
  await conn.execute(
    "INSERT INTO nasqo_audit_log (actor_uid,actor_email,table_name,row_id,action,before_json,after_json) VALUES (?,?,?,?,?,?,?)",
    [user.uid, user.email, table, rowId, action,
      before ? JSON.stringify(publicRow(before)) : null,
      after ? JSON.stringify(publicRow(after)) : null],
  );
}
// Legacy SmartPro does not declare foreign keys for every historical link.
 // Explicitly guard references that InnoDB cannot protect with FK constraints.
async function requireNoHistoricalReferences(conn: PoolConnection, table: TableName, id: string): Promise<void> {
  const guards: Partial<Record<TableName, readonly string[]>> = {
    stores: [
      "SELECT id FROM store_trans WHERE store_id1=? LIMIT 1",
      "SELECT id FROM store_trans WHERE store_id2=? LIMIT 1",
      "SELECT id FROM bill_details WHERE store_id=? LIMIT 1",
    ],
    cboxes: [
      "SELECT id FROM bounds WHERE cboxid=? LIMIT 1",
    ],
    currencies: [
      "SELECT id FROM bounds WHERE cur_id=? LIMIT 1",
      "SELECT id FROM products WHERE cur=? LIMIT 1",
      "SELECT id FROM cboxes WHERE cur=? LIMIT 1",
    ],
  };
  for (const sql of guards[table] ?? []) {
    const [rows]=await conn.query<RowDataPacket[]>(sql,[id]);
    if(rows.length)throw new InputError(
      "لا يمكن حذف هذا السجل لأنه مرتبط بمستندات تاريخية. عطّله بدل الحذف للحفاظ على صحة الأرصدة.",409);
  }
}
async function auditDeleteCascade(conn: PoolConnection, user: Actor, table: TableName, id: string): Promise<void> {
  for (const dependency of CASCADE_CHILDREN[table] ?? []) {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM " + ident(dependency.table) + " WHERE " + ident(dependency.foreignKey) +
      "=? ORDER BY id LIMIT ? FOR UPDATE",
      [id, CASCADE_AUDIT_LIMIT + 1],
    );
    if (rows.length > CASCADE_AUDIT_LIMIT) {
      throw new InputError("الحذف يشمل أكثر من 2000 سجل تابع؛ أوقف العملية واطلب مراجعة محاسبية.", 409);
    }
    // Deleting products with archived invoice rows would irreversibly remove
    // historical evidence. Admins can update/deactivate products instead.
    if (table === "products" && rows.length) {
      throw new InputError("هذا الصنف مرتبط بفواتير محذوفة محفوظة؛ ألغِ تنشيطه بدل حذف أرشيفه.", 409);
    }
    for (const row of rows) {
      await audit(conn, user, dependency.table, String(row.id), "delete", row, null);
    }
  }
}
function routeError(res: Response, error: unknown): void {

  if (error instanceof InputError) {
    res.status(error.status).json({ error: error.message }); return;
  }
  if (error && typeof error === "object") {
    const code = String((error as { code?: unknown }).code ?? "");
    if (["ER_ROW_IS_REFERENCED_2","ER_NO_REFERENCED_ROW_2"].includes(code)) {
      res.status(409).json({error:"عملية غير مسموحة لأن السجل مرتبط بسجلات محاسبية أخرى."}); return;
    }
    if (code === "ER_DUP_ENTRY") {
      res.status(409).json({error:"يوجد سجل آخر بالقيمة نفسها."}); return;
    }
    if (["ER_BAD_NULL_ERROR","ER_DATA_TOO_LONG","ER_TRUNCATED_WRONG_VALUE"].includes(code)) {
      res.status(400).json({error:"القيم المرسلة لا توافق بنية قاعدة البيانات."}); return;
    }
  }
  console.error("SmartPro operation failed", error);
  res.status(500).json({ error: "تعذر تنفيذ العملية في قاعدة SmartPro." });
}

async function authorizeActor(req: ActorRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!enabled()) throw new InputError("ربط SmartPro غير متاح بعد.", 503);
    const authHeader = req.get("authorization") ?? "";
    if (!/^Bearer \S+$/.test(authHeader)) throw new InputError("يجب تسجيل الدخول بحساب Google موثّق.",401);
    const verifier = getApps().some(a => a.name === "nasqo-smartpro-auth")
      ? getApp("nasqo-smartpro-auth")
      : initializeApp({ projectId: verifiedProject }, "nasqo-smartpro-auth");
    let decoded;
    try {
      decoded = await getAuth(verifier).verifyIdToken(authHeader.slice(7));
    } catch {
      throw new InputError("انتهت صلاحية تسجيل الدخول أو تعذر التحقق منه. أعد تسجيل الدخول.", 401);
    }
    const email = String(decoded.email ?? "").toLowerCase();
    if (!decoded.email_verified || !email) throw new InputError("يلزم حساب بريد إلكتروني موثّق.",403);
    const bootstrap = bootstrapAdmins.has(email);
    let role: Role | null = bootstrap ? "admin" : null;
    if (!role) {
      const [rows] = await pool().query<RowDataPacket[]>("SELECT role FROM nasqo_access_roles WHERE email=? LIMIT 1", [email]);
      if (rows.length && ["admin","editor","viewer"].includes(String(rows[0].role))) role = String(rows[0].role) as Role;
    }
    if (!role) throw new InputError("هذا الحساب غير مخوّل لدخول قاعدة SmartPro.",403);
    req.smartproActor = { uid:decoded.uid, email, role, bootstrap };
    next();
  } catch (error) {
    routeError(res, error);
  }
}
function asyncRoute(fn:(req:ActorRequest,res:Response)=>Promise<void>) {
  return (req:Request,res:Response) => {
    void fn(req as ActorRequest,res).catch(error => routeError(res,error));
  };
}
function tableFrom(req: Request): TableName { return tableName(asParam(req,"table")); }
function recordIdFrom(req: Request): string { return validId(asParam(req,"id")); }

export function mountSmartProApi(app: Express): void {
  const router = Router();
  router.get("/status", (_req,res) => {
    // No data or account identifiers are exposed to anonymous clients.
    res.json({
      available: enabled(),
      writeEnabled: enabled() && writesEnabled(),
      primary: enabled() && writesEnabled() && process.env.SMARTPRO_PRIMARY_ENABLED === "1",
    });
  });
  router.use((req,res,next) => { void authorizeActor(req as ActorRequest,res,next); });
  router.get("/meta", asyncRoute(async (req,res) => {
    const tableSpecs = await Promise.all(TABLES.map(async name => {
      const cols = await columns(name);
      return { name, columns: visible(cols), editableColumns: editable(name,cols).map(c => c.name) };
    }));
    const user = actor(req);
    res.json({
      tables:tableSpecs,
      role:user.role,
      writeEnabled:writesEnabled(),
      invoiceWriteEnabled:writesEnabled() &&
        process.env.SMARTPRO_INVOICE_WRITE_ENABLED==="1" &&
        !!process.env.SMARTPRO_POSTING_USER_ID,
      salesStockVerified:process.env.SMARTPRO_INVENTORY_RECONCILED==="1",
      email:user.email,
    });
  }));
  // Schema-aware invoice workflow: a single InnoDB transaction posts the header,
  // every product line and the corresponding per-record audit events.
  router.get("/reports/stock", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const {offset,limit}=pageParams(req.query.offset,req.query.limit);
    const [raw]=await pool().query<RowDataPacket[]>(STOCK_MOVEMENTS_SQL);
    const [integrity]=await pool().query<RowDataPacket[]>(TRANSFER_INTEGRITY_SQL);
    const rows=raw as StockMovementRow[];
    const links=integrity as TransferIntegrityRow[];
    const all=stockFindings(rows,links);
    const onlyNegative=req.query.onlyNegative==="1";
    const warehouseId=req.query.warehouseId ? validId(req.query.warehouseId) : null;
    const selected=rows.filter(row=>
      (!warehouseId||String(row.warehouseId)===warehouseId) &&
      (!onlyNegative||Number(row.netMovementQuantity)<0));
    res.json({
      findings:all,warehouseTransfers:links,
      rows:selected.slice(offset,offset+limit),
      totalFiltered:selected.length,offset,limit,
      verified:false,source:"smartprodb",
    });
  }));
  router.get("/reports/documents", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const [totals]=await pool().query<RowDataPacket[]>(DOCUMENT_SUMMARY_SQL);
    const [counts]=await pool().query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM accounts) accounts,"+
      "(SELECT COUNT(*) FROM products) products,"+
      "(SELECT COUNT(*) FROM stores) stores,"+
      "(SELECT COUNT(*) FROM bill_details) billLines,"+
      "(SELECT COUNT(*) FROM store_trans) transferDocuments");
    res.json({
      counts:counts[0],documents:totals,
      note:"مجاميع حقول SmartPro الأصلية حسب نوع المستند؛ لا تُعد ميزان مراجعة محاسبيًا قبل مطابقة أنواع القيود.",
    });
  }));
  router.get("/reports/accounts", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const [rows]=await pool().query<RowDataPacket[]>(
      "SELECT a.id,a.name,a.box_id,b.name AS groupName FROM accounts a " +
      "LEFT JOIN boxes b ON b.id=a.box_id ORDER BY a.id");
    res.json({rows});
  }));
  router.get("/reports/account/:id", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const id=recordIdFrom(req);
    const start=requireIsoDate(req.query.start,"1900-01-01");
    const end=requireIsoDate(req.query.end,"2099-12-31");
    if(start>end)throw new InputError("نهاية الفترة قبل بدايتها.");
    const {offset,limit}=pageParams(req.query.offset,req.query.limit);
    const [accounts]=await pool().query<RowDataPacket[]>(
      "SELECT id,name,box_id FROM accounts WHERE id=? LIMIT 1",[id]);
    if(!accounts.length)throw new InputError("الحساب غير موجود.",404);
    const [totals]=await pool().query<RowDataPacket[]>(ACCOUNT_TOTALS_SQL,[id,start,end]);
    const [entries]=await pool().query<RowDataPacket[]>(
      ACCOUNT_STATEMENT_SQL,[id,start,end,limit+1,offset]);
    res.json({
      account:accounts[0],start,end,totals,
      entries:entries.slice(0,limit),hasMore:entries.length>limit,
      offset,limit,
      note:"بيان الحقلين الأصليين dain/madin؛ لا يجمع بين العملات ولا يفترض رصيدًا افتتاحيًا.",
    });
  }));
  router.get("/warehouse/transfers",asyncRoute(async(req,res)=>{
    authorize(actor(req).role,"read");
    const [rows]=await pool().query<RowDataPacket[]>(
      "SELECT t.id,t.date,t.type,t.store_id1 AS fromId,t.store_id2 AS toId,"+
      "t.details,s1.name AS fromName,s2.name AS toName,"+
      "(SELECT COUNT(*) FROM trans_details d WHERE d.bill_id=t.id) AS lineCount "+
      "FROM store_trans t LEFT JOIN stores s1 ON s1.id=t.store_id1 "+
      "LEFT JOIN stores s2 ON s2.id=t.store_id2 ORDER BY t.id DESC LIMIT 50",
    );
    res.json({rows});
  }));
  router.post("/warehouse/transfer",asyncRoute(async(req,res)=>{
    const user=actor(req);requireWrite(user.role,"create");
    if(process.env.SMARTPRO_STOCK_WRITE_ENABLED!=="1" ||
       process.env.SMARTPRO_INVENTORY_RECONCILED!=="1") {
      throw new InputError("التحويلات مقفلة حتى مطابقة جرد جميع المخازن واعتماد ترحيل المخزون.",503);
    }
    if(!process.env.SMARTPRO_POSTING_USER_ID)throw new InputError("مستخدم ترحيل SmartPro غير معرّف.",503);
    const postingUserId=validId(process.env.SMARTPRO_POSTING_USER_ID);
    const transfer=validateStockTransfer(req.body);
    const digest=createHash("sha256").update(JSON.stringify(transfer)).digest("hex");
    const conn=await pool().getConnection();
    try {
      await conn.beginTransaction();
      try {
        await conn.execute(
          "INSERT INTO nasqo_transfer_requests(request_key,actor_uid,payload_sha256,transfer_id) VALUES (?,?,?,0)",
          [transfer.requestId,user.uid,digest],
        );
      }catch(error){
        if(!error||typeof error!=="object"||(error as {code?:string}).code!=="ER_DUP_ENTRY")throw error;
        const [existing]=await conn.query<RowDataPacket[]>(
          "SELECT actor_uid,payload_sha256,transfer_id FROM nasqo_transfer_requests WHERE request_key=? FOR UPDATE",
          [transfer.requestId],
        );
        const row=existing[0];
        if(!row||row.actor_uid!==user.uid||row.payload_sha256!==digest||Number(row.transfer_id)<1)
          throw new InputError("مفتاح التحويل مستخدم لبيانات مختلفة.",409);
        await conn.rollback();
        res.status(200).json({id:String(row.transfer_id),duplicate:true,lineCount:transfer.lines.length});
        return;
      }
      const [userRows]=await conn.query<RowDataPacket[]>("SELECT id FROM users WHERE id=? FOR UPDATE",[postingUserId]);
      if(!userRows.length)throw new InputError("مستخدم SmartPro المرجعي غير موجود.",409);
      const storeIds=[transfer.sourceStoreId,transfer.destinationStoreId].sort((a,b)=>Number(a)-Number(b));
      for(const id of storeIds){
        const [stores]=await conn.query<RowDataPacket[]>("SELECT id,state FROM stores WHERE id=? FOR UPDATE",[id]);
        if(!stores.length||Number(stores[0].state)!==1)throw new InputError("التحويل يتطلب مخزنين نشطين معروفين.",409);
      }
      const productRows=new Map<string,RowDataPacket>();
      for(const line of [...transfer.lines].sort((a,b)=>Number(a.productId)-Number(b.productId))){
        const [products]=await conn.query<RowDataPacket[]>(
          "SELECT id,unit,bstate,defunit FROM products WHERE id=? FOR UPDATE",[line.productId]);
        if(!products.length||Number(products[0].bstate)!==1)throw new InputError("صنف غير موجود أو غير نشط.",409);
        if(Number(products[0].defunit)!==1)throw new InputError("يجب تسوية وحدات الصنف قبل تحويله.",409);
        productRows.set(line.productId,products[0]);
      }
      const [movements]=await conn.query<RowDataPacket[]>(STOCK_MOVEMENTS_SQL);
      const stock=new Map(
        movements.filter(r=>String(r.warehouseId)===transfer.sourceStoreId)
          .map(r=>[String(r.productId),signedQuantityFixed(r.netMovementQuantity)]),
      );
      for(const line of transfer.lines){
        if((stock.get(line.productId)??0n)<quantityFixed(line.quantity)) {
          throw new InputError("الرصيد المرجعي للصنف "+line.productId+" في مخزن المصدر لا يكفي للتحويل.",409);
        }
      }
      const [result]=await conn.execute<ResultSetHeader>(
        "INSERT INTO store_trans(store_id1,store_id2,details,date,user_id,type) VALUES (?,?,?,?,?,1)",
        [transfer.sourceStoreId,transfer.destinationStoreId,transfer.note,transfer.date,postingUserId],
      );
      if(!result.insertId)throw new InputError("تعذر إنشاء رأس التحويل.",409);
      const id=String(result.insertId);
      const header=await lockedRow(conn,"store_trans",id);
      await audit(conn,user,"store_trans",id,"insert",null,header);
      for(const line of transfer.lines){
        const product=productRows.get(line.productId)!;
        const [detail]=await conn.execute<ResultSetHeader>(
          "INSERT INTO trans_details(amount,unit,details,bill_id,prod_id,unitnum,exdate) VALUES (?,?,?,?,?,1,?)",
          [line.quantity,String(product.unit||"حبة").slice(0,50),"",id,line.productId,""],
        );
        if(!detail.insertId)throw new InputError("تعذر حفظ بند التحويل.",409);
        const detailRow=await lockedRow(conn,"trans_details",String(detail.insertId));
        await audit(conn,user,"trans_details",String(detail.insertId),"insert",null,detailRow);
      }
      await conn.execute(
        "UPDATE nasqo_transfer_requests SET transfer_id=? WHERE request_key=?",
        [id,transfer.requestId],
      );
      await conn.commit();
      res.status(201).json({id,lineCount:transfer.lines.length,from:transfer.sourceStoreId,to:transfer.destinationStoreId});
    }catch(error){await conn.rollback();throw error}
    finally{conn.release()}
  }));
  router.get("/invoice/returnable",asyncRoute(async(req,res)=>{
    authorize(actor(req).role,"read");
    const [rows]=await pool().query<RowDataPacket[]>(
      "SELECT b.id,b.date,b.doc_type AS documentType,b.acc_id AS accountId,"+
      "a.name AS accountName,b.cboxid AS cashboxId "+
      "FROM nasqo_invoice_requests r JOIN bounds b ON b.id=r.invoice_id "+
      "JOIN accounts a ON a.id=b.acc_id "+
      "WHERE b.doc_type IN (2,3) ORDER BY b.id DESC LIMIT 100",
    );
    res.json({rows,note:"تتوفر المرتجعات الموثّقة للفواتير الجديدة المسجّلة عبر NASQO فقط؛ المرتجعات القديمة معروضة تاريخيًا."});
  }));
  router.get("/invoice/returnable/:id",asyncRoute(async(req,res)=>{
    authorize(actor(req).role,"read");
    const id=recordIdFrom(req);
    const [invoices]=await pool().query<RowDataPacket[]>(
      "SELECT b.id,b.date,b.doc_type,b.acc_id,b.cur_id,b.cboxid,a.name AS account_name "+
      "FROM bounds b JOIN nasqo_invoice_requests req ON req.invoice_id=b.id "+
      "JOIN accounts a ON a.id=b.acc_id WHERE b.id=? AND b.doc_type IN (2,3) LIMIT 1",[id],
    );
    if(!invoices.length)throw new InputError("لا يمكن إصدار مرتجع آلي إلا لفاتورة أصلية أنشئت من نسقو.",409);
    const [lines]=await pool().query<RowDataPacket[]>(
      "SELECT d.id,d.prod_id,d.store_id,d.price,d.amount,d.unit,p.name AS product_name,"+
      "COALESCE((SELECT SUM(l.returned_quantity) FROM nasqo_return_line_links l WHERE l.source_line_id=d.id),0) AS returned_quantity "+
      "FROM bill_details d JOIN products p ON p.id=d.prod_id WHERE d.bill_id=? ORDER BY d.id",[id],
    );
    res.json({invoice:invoices[0],lines});
  }));
  router.post("/invoice/return",asyncRoute(async(req,res)=>{
    const user=actor(req);requireWrite(user.role,"create");
    if(process.env.SMARTPRO_RETURN_WRITE_ENABLED!=="1")
      throw new InputError("مرتجعات SmartPro المركزية غير مفعّلة حتى اعتماد القواعد المحاسبية.",503);
    if(!process.env.SMARTPRO_POSTING_USER_ID)
      throw new InputError("مستخدم الترحيل المحاسبي غير معرّف.",503);
    const postingUserId=validId(process.env.SMARTPRO_POSTING_USER_ID);
    const posting=validateReturnPosting(req.body);
    const digest=createHash("sha256").update(JSON.stringify(posting)).digest("hex");
    const conn=await pool().getConnection();
    try {
      await conn.beginTransaction();
      try{
        await conn.execute(
          "INSERT INTO nasqo_invoice_requests(request_key,actor_uid,payload_sha256,invoice_id) VALUES (?,?,?,0)",
          [posting.requestId,user.uid,digest],
        );
      }catch(error){
        if(!error||typeof error!=="object"||(error as {code?:string}).code!=="ER_DUP_ENTRY")throw error;
        const [existing]=await conn.query<RowDataPacket[]>(
          "SELECT actor_uid,payload_sha256,invoice_id FROM nasqo_invoice_requests WHERE request_key=? FOR UPDATE",
          [posting.requestId],
        );
        const row=existing[0];
        if(!row||row.actor_uid!==user.uid||row.payload_sha256!==digest||Number(row.invoice_id)<1)
          throw new InputError("مفتاح المرتجع مستخدم لعملية مختلفة.",409);
        await conn.rollback();
        res.status(200).json({id:String(row.invoice_id),duplicate:true});
        return;
      }
      const [sourceRows]=await conn.query<RowDataPacket[]>(
        "SELECT id,doc_type,acc_id,cur_id,cboxid FROM bounds WHERE id=? FOR UPDATE",
        [posting.sourceInvoiceId],
      );
      const source=sourceRows[0];
      if(!source)throw new InputError("الفاتورة الأصلية غير موجودة.",404);
      const returnType=returnDocType(Number(source.doc_type));
      if(returnType===5&&process.env.SMARTPRO_INVENTORY_RECONCILED!=="1")
        throw new InputError("مردود المشتريات يصرف مخزونًا؛ مطابقة الجرد مطلوبة أولًا.",503);
      const [eligibility]=await conn.query<RowDataPacket[]>(
        "SELECT invoice_id FROM nasqo_invoice_requests WHERE invoice_id=? LIMIT 1",
        [posting.sourceInvoiceId],
      );
      if(!eligibility.length)throw new InputError("المرتجعات الآلية مقصورة على الفواتير المنشأة من نسقو.",409);
      const [refUsers]=await conn.query<RowDataPacket[]>("SELECT id FROM users WHERE id=? FOR UPDATE",[postingUserId]);
      if(!refUsers.length)throw new InputError("مستخدم SmartPro المرجعي غير موجود.",409);
      const sourceLineIds=posting.lines.map(line=>line.sourceLineId);
      const placeholders=posting.lines.map(()=>"?").join(",");
      const [originalLines]=await conn.query<RowDataPacket[]>(
        "SELECT id,prod_id,store_id,price,amount,unit FROM bill_details "+
        "WHERE bill_id=? AND id IN ("+placeholders+") ORDER BY id FOR UPDATE",
        [posting.sourceInvoiceId,...sourceLineIds],
      );
      if(originalLines.length!==posting.lines.length)throw new InputError("أحد بنود المرتجع لا ينتمي إلى الفاتورة الأصلية.",409);
      const [returned]=await conn.query<RowDataPacket[]>(
        "SELECT source_line_id,returned_quantity FROM nasqo_return_line_links "+
        "WHERE source_line_id IN ("+placeholders+") FOR UPDATE",
        sourceLineIds,
      );
      const byLine=new Map(originalLines.map(row=>[String(row.id),row]));
      const already=new Map<string,bigint>();
      for(const row of returned){
        const id=String(row.source_line_id);
        already.set(id,(already.get(id)??0n)+signedQuantityFixed(row.returned_quantity));
      }
      const canonicalLines=[] as {originalId:string;productId:string;storeId:string;quantity:string;price:string;unit:string;lineTotal:string}[];
      let total=0n;
      for(const item of posting.lines){
        const original=byLine.get(item.sourceLineId)!;
        const originalQty=quantityFixed(original.amount);
        const remaining=originalQty-(already.get(item.sourceLineId)??0n);
        const requested=quantityFixed(item.quantity);
        if(remaining<requested)throw new InputError("الكمية المرتجعة تتجاوز المتبقي من الفاتورة الأصلية.",409);
        const lineTotal=returnLineValue(item.quantity,String(original.price));
        total+=scaledPositive(lineTotal,"قيمة بند المرتجع",true);
        if(total>999_999_999_999n*10_000n)throw new InputError("إجمالي المرتجع خارج المدى.");
        canonicalLines.push({
          originalId:item.sourceLineId,productId:String(original.prod_id),
          storeId:String(original.store_id),quantity:item.quantity,
          price:String(original.price),unit:String(original.unit),lineTotal,
        });
      }
      if(total<=0n)throw new InputError("إجمالي المرتجع يجب أن يكون موجبًا.");
      if(returnType===5){
        // Purchase returns remove physical stock. The original stock
        // snapshot must be certified, and product locks serialize writers.
        for(const id of [...new Set(canonicalLines.map(line=>line.productId))].sort((a,b)=>Number(a)-Number(b))){
          const [p]=await conn.query<RowDataPacket[]>("SELECT id FROM products WHERE id=? FOR UPDATE",[id]);
          if(!p.length)throw new InputError("صنف المرتجع غير موجود.",409);
        }
        const [movements]=await conn.query<RowDataPacket[]>(STOCK_MOVEMENTS_SQL);
        const available=new Map(movements.map(row=>[
          String(row.productId)+":"+String(row.warehouseId),
          signedQuantityFixed(row.netMovementQuantity),
        ]));
        for(const line of canonicalLines){
          if((available.get(line.productId+":"+line.storeId)??0n)<quantityFixed(line.quantity))
            throw new InputError("رصيد مخزن المشتريات المرتجعة لا يكفي لإخراج هذا الصنف.",409);
        }
      }
      const sum=formatScaled(total);
      const cash=Number(source.cboxid)>0;
      const sides=returnFinancialSides(returnType,sum,cash);
      const [header]=await conn.execute<ResultSetHeader>(
        "INSERT INTO bounds(dain,madin,date,acc_id,cur_id,bill,user_id,details,img,doc_type,cboxid) "+
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [sides.dain,sides.madin,posting.date,source.acc_id,source.cur_id,
          "",postingUserId,posting.note,"",returnType,source.cboxid],
      );
      if(!header.insertId)throw new InputError("تعذر إنشاء رأس المرتجع.",409);
      const id=String(header.insertId);
      await conn.execute(
        "INSERT INTO nasqo_return_links(return_invoice_id,source_invoice_id,actor_uid) VALUES (?,?,?)",
        [id,posting.sourceInvoiceId,user.uid],
      );
      await audit(conn,user,"bounds",id,"insert",null,await lockedRow(conn,"bounds",id));
      for(const line of canonicalLines){
        const [detail]=await conn.execute<ResultSetHeader>(
          "INSERT INTO bill_details(bill_id,prod_id,price,amount,total,details,unit,store_id,discount,bonus,unitnum,exdate) "+
          "VALUES (?,?,?,?,?,?,?,?,?,?,1,?)",
          [id,line.productId,line.price,line.quantity,line.lineTotal,"",line.unit,line.storeId,"0","0",""],
        );
        if(!detail.insertId)throw new InputError("تعذر إنشاء بند المرتجع.",409);
        await conn.execute(
          "INSERT INTO nasqo_return_line_links(return_line_id,source_line_id,returned_quantity) VALUES (?,?,?)",
          [detail.insertId,line.originalId,line.quantity],
        );
        await audit(conn,user,"bill_details",String(detail.insertId),"insert",null,
          await lockedRow(conn,"bill_details",String(detail.insertId)));
      }
      await conn.execute("UPDATE nasqo_invoice_requests SET invoice_id=? WHERE request_key=?",[id,posting.requestId]);
      await conn.commit();
      res.status(201).json({id,type:returnType,sourceId:posting.sourceInvoiceId,total:sum,lineCount:canonicalLines.length});
    }catch(error){await conn.rollback();throw error}
    finally{conn.release()}
  }));
  router.get("/voucher/lookup",asyncRoute(async(req,res)=>{
    authorize(actor(req).role,"read");
    const [accounts]=await pool().query<RowDataPacket[]>("SELECT id,name FROM accounts ORDER BY id");
    const [cashboxes]=await pool().query<RowDataPacket[]>("SELECT id,name FROM cboxes WHERE state=1 ORDER BY id");
    const [currencies]=await pool().query<RowDataPacket[]>("SELECT id,name FROM currencies ORDER BY id");
    res.json({accounts,cashboxes,currencies});
  }));
  router.get("/voucher/recent",asyncRoute(async(req,res)=>{
    authorize(actor(req).role,"read");
    const [rows]=await pool().query<RowDataPacket[]>(
      "SELECT b.id,b.date,b.dain,b.madin,b.details,b.bill,b.cur_id AS currencyId,"+
      "b.cboxid AS cashboxId,a.name AS accountName,c.name AS cashboxName "+
      "FROM bounds b JOIN accounts a ON a.id=b.acc_id "+
      "LEFT JOIN cboxes c ON c.id=b.cboxid "+
      "WHERE b.doc_type=1 ORDER BY b.id DESC LIMIT 50",
    );
    res.json({rows});
  }));
  router.post("/voucher",asyncRoute(async(req,res)=>{
    const user=actor(req);requireWrite(user.role,"create");
    if(process.env.SMARTPRO_VOUCHER_WRITE_ENABLED!=="1")
      throw new InputError("ترحيل السندات المركزية غير مفعّل قبل اعتماد معناها المحاسبي.",503);
    if(!process.env.SMARTPRO_POSTING_USER_ID)
      throw new InputError("مستخدم ترحيل SmartPro غير معرّف.",503);
    const postingUserId=validId(process.env.SMARTPRO_POSTING_USER_ID);
    const voucher=validateVoucher(req.body);
    const digest=createHash("sha256").update(JSON.stringify(voucher)).digest("hex");
    const conn=await pool().getConnection();
    try{
      await conn.beginTransaction();
      try{
        await conn.execute(
          "INSERT INTO nasqo_voucher_requests(request_key,actor_uid,payload_sha256,voucher_id) VALUES (?,?,?,0)",
          [voucher.requestId,user.uid,digest],
        );
      }catch(error){
        if(!error||typeof error!=="object"||(error as {code?:string}).code!=="ER_DUP_ENTRY")throw error;
        const [existing]=await conn.query<RowDataPacket[]>(
          "SELECT actor_uid,payload_sha256,voucher_id FROM nasqo_voucher_requests WHERE request_key=? FOR UPDATE",
          [voucher.requestId],
        );
        const row=existing[0];
        if(!row||row.actor_uid!==user.uid||row.payload_sha256!==digest||Number(row.voucher_id)<1)
          throw new InputError("مفتاح السند مستخدم لبيانات مختلفة.",409);
        await conn.rollback();
        res.status(200).json({id:String(row.voucher_id),duplicate:true});
        return;
      }
      for(const [name,id] of [
        ["accounts",voucher.accountId],["currencies",voucher.currencyId],
        ["users",postingUserId],
      ]){
        const [refs]=await conn.query<RowDataPacket[]>(
          "SELECT id FROM "+ident(name)+" WHERE id=? FOR UPDATE",[id]);
        if(!refs.length)throw new InputError("مرجع محاسبي غير موجود: "+name,409);
      }
      const [boxes]=await conn.query<RowDataPacket[]>(
        "SELECT id,state FROM cboxes WHERE id=? FOR UPDATE",[voucher.cashboxId]);
      if(!boxes.length||Number(boxes[0].state)!==1)throw new InputError("الصندوق غير موجود أو غير نشط.",409);
      const sides=voucherSides(voucher);
      const [inserted]=await conn.execute<ResultSetHeader>(
        "INSERT INTO bounds(dain,madin,date,acc_id,cur_id,bill,user_id,details,img,doc_type,cboxid) "+
        "VALUES (?,?,?,?,?,?,?,?,?,1,?)",
        [sides.dain,sides.madin,voucher.date,voucher.accountId,voucher.currencyId,
         voucher.documentNumber,postingUserId,voucher.note,"",voucher.cashboxId],
      );
      if(!inserted.insertId)throw new InputError("لم يُحفظ السند.",409);
      const id=String(inserted.insertId);
      await audit(conn,user,"bounds",id,"insert",null,await lockedRow(conn,"bounds",id));
      await conn.execute("UPDATE nasqo_voucher_requests SET voucher_id=? WHERE request_key=?",[id,voucher.requestId]);
      await conn.commit();
      res.status(201).json({id,direction:voucher.direction,amount:voucher.amount});
    }catch(error){await conn.rollback();throw error}
    finally{conn.release()}
  }));
  router.get("/invoice/lookup", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const [accounts] = await pool().query<RowDataPacket[]>("SELECT id,name,box_id FROM accounts ORDER BY id LIMIT 2000");
    const [products] = await pool().query<RowDataPacket[]>("SELECT id,name,unit,sell_price,buy_price FROM products WHERE bstate=1 ORDER BY id LIMIT 5000");
    const [stores] = await pool().query<RowDataPacket[]>("SELECT id,name FROM stores WHERE state=1 ORDER BY id LIMIT 200");
    const [cashboxes] = await pool().query<RowDataPacket[]>("SELECT id,name FROM cboxes WHERE state=1 ORDER BY id LIMIT 200");
    const [currencies] = await pool().query<RowDataPacket[]>("SELECT id,name FROM currencies ORDER BY id LIMIT 100");
    res.json({accounts,products,stores,cashboxes,currencies});
  }));
  router.get("/invoice/recent", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const [rows] = await pool().query<RowDataPacket[]>(
      "SELECT b.id,b.date,b.doc_type,b.dain,b.madin,b.details,b.acc_id,a.name AS account_name," +
      "(SELECT COUNT(*) FROM bill_details d WHERE d.bill_id=b.id) AS line_count " +
      "FROM bounds b JOIN accounts a ON a.id=b.acc_id WHERE b.doc_type IN (2,3) " +
      "ORDER BY b.id DESC LIMIT 40",
    );
    res.json({rows});
  }));
  router.get("/invoice/:id", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const id=recordIdFrom(req);
    const [docs]=await pool().query<RowDataPacket[]>(
      "SELECT id,date,doc_type,dain,madin,acc_id,cur_id,cboxid,details FROM bounds WHERE id=? AND doc_type IN (2,3) LIMIT 1",[id]);
    if(!docs.length)throw new InputError("الفاتورة غير موجودة.",404);
    const [lines]=await pool().query<RowDataPacket[]>(
      "SELECT d.id,d.prod_id,d.store_id,d.price,d.amount,d.total,d.unit,p.name AS product_name " +
      "FROM bill_details d JOIN products p ON p.id=d.prod_id WHERE d.bill_id=? ORDER BY d.id",[id]);
    res.json({invoice:docs[0],lines});
  }));
  router.post("/invoice", asyncRoute(async (req,res) => {
    const user=actor(req);
    requireWrite(user.role,"create");
    if(process.env.SMARTPRO_INVOICE_WRITE_ENABLED!=="1") {
      throw new InputError("ترحيل الفواتير المركزية غير مفعّل حتى اعتماد المطابقة المحاسبية.",503);
    }
    const invoice=validateInvoicePosting(req.body);
    if(invoice.type==="sale" && process.env.SMARTPRO_INVENTORY_RECONCILED!=="1") {
      throw new InputError("مبيعات الأصناف مقفلة حتى مطابقة الأرصدة وحركات التحويل على جميع المخازن.",503);
    }
    if(!process.env.SMARTPRO_POSTING_USER_ID) {
      throw new InputError("لم يتم إعداد ربط المستخدم المحاسبي للترحيل.",503);
    }
    const postingUserId=validId(process.env.SMARTPRO_POSTING_USER_ID);
    const digest=createHash("sha256").update(JSON.stringify(invoice)).digest("hex");
    const conn=await pool().getConnection();
    try {
      await conn.beginTransaction();
      // Unique request key is claimed in the same transaction as the invoice.
      // Concurrent retries serialize on this key instead of posting twice.
      try {
        await conn.execute(
          "INSERT INTO nasqo_invoice_requests(request_key,actor_uid,payload_sha256,invoice_id) VALUES (?,?,?,0)",
          [invoice.requestId,user.uid,digest],
        );
      }catch(error){
        if(!error||typeof error!=="object"||(error as {code?:string}).code!=="ER_DUP_ENTRY")throw error;
        const [existing]=await conn.query<RowDataPacket[]>(
          "SELECT actor_uid,payload_sha256,invoice_id FROM nasqo_invoice_requests WHERE request_key=? FOR UPDATE",
          [invoice.requestId],
        );
        const item=existing[0];
        if(!item||item.actor_uid!==user.uid||item.payload_sha256!==digest||Number(item.invoice_id)<1) {
          throw new InputError("مفتاح الفاتورة مستخدم لبيانات مختلفة؛ لا يمكن تكرار العملية.",409);
        }
        await conn.rollback();
        res.status(200).json({
          id:String(item.invoice_id),type:invoice.type,total:invoice.grandTotal,
          lineCount:invoice.lines.length,duplicate:true,
        });
        return;
      }
      const required = [
        ["accounts",invoice.accountId],["currencies",invoice.currencyId],
        ["users",postingUserId],
        ...(invoice.payment==="cash" ? [["cboxes",invoice.cashboxId]] : []),
      ];
      for(const [name,id] of required) {
        const [rows]=await conn.query<RowDataPacket[]>(
          "SELECT id FROM "+ident(name)+" WHERE id=? FOR UPDATE",[id]);
        if(!rows.length)throw new InputError("معرف مرجعي غير موجود في "+name,409);
      }
      const canonicalLines=[];
      for(const line of invoice.lines) {
        const [products]=await conn.query<RowDataPacket[]>(
          "SELECT id,unit,bstate,defunit FROM products WHERE id=? FOR UPDATE",[line.productId]);
        const [stores]=await conn.query<RowDataPacket[]>(
          "SELECT id,state FROM stores WHERE id=? FOR UPDATE",[line.storeId]);
        if(!products.length||Number(products[0].bstate)!==1)throw new InputError("الصنف غير موجود أو غير نشط.",409);
        if(Number(products[0].defunit)!==1)throw new InputError("يجب تسوية وحدة الصنف قبل ترحيل فاتورة جديدة.",409);
        if(!stores.length||Number(stores[0].state)!==1)throw new InputError("المخزن غير موجود أو غير نشط.",409);
        canonicalLines.push({...line,unit:String(products[0].unit||"حبة").slice(0,20)});
      }
      // Enforce available movements when the accountant explicitly certifies
      // the historical stock reconciliation. Lock product rows above to
      // serialize concurrent central sale and transfer postings.
      if(invoice.type==="sale"){
        const [positions]=await conn.query<RowDataPacket[]>(STOCK_MOVEMENTS_SQL);
        const balances=new Map(positions.map(row=>[
          String(row.productId)+":"+String(row.warehouseId),
          signedQuantityFixed(row.netMovementQuantity),
        ]));
        for(const line of canonicalLines){
          const available=balances.get(line.productId+":"+line.storeId)??0n;
          if(available<quantityFixed(line.quantity))
            throw new InputError("الرصيد المرجعي للصنف "+line.productId+" في المخزن "+line.storeId+" غير كافٍ للبيع.",409);
        }
      }
      const [header]=await conn.execute<ResultSetHeader>(
        "INSERT INTO bounds(dain,madin,date,acc_id,cur_id,bill,user_id,details,img,doc_type,cboxid) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [invoice.dain,invoice.madin,invoice.date,invoice.accountId,invoice.currencyId,
          "",postingUserId,invoice.note,"",invoice.docType,invoice.cashboxId],
      );
      if(!header.insertId)throw new InputError("فشل إنشاء رقم الفاتورة.",409);
      const id=String(header.insertId);
      const doc=await lockedRow(conn,"bounds",id);
      await audit(conn,user,"bounds",id,"insert",null,doc);
      for(const item of canonicalLines) {
        const [result]=await conn.execute<ResultSetHeader>(
          "INSERT INTO bill_details(bill_id,prod_id,price,amount,total,details,unit,store_id,discount,bonus,unitnum,exdate) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [id,item.productId,item.price,item.quantity,item.total,"",item.unit,item.storeId,"0","0",1,""],
        );
        if(!result.insertId)throw new InputError("لم يُحفظ أحد بنود الفاتورة.",409);
        const row=await lockedRow(conn,"bill_details",String(result.insertId));
        await audit(conn,user,"bill_details",String(result.insertId),"insert",null,row);
      }
      await conn.execute(
        "UPDATE nasqo_invoice_requests SET invoice_id=? WHERE request_key=?",
        [id,invoice.requestId],
      );
      await conn.commit();
      res.status(201).json({id,type:invoice.type,total:invoice.grandTotal,lineCount:canonicalLines.length});
    }catch(error){await conn.rollback();throw error}
    finally{conn.release()}
  }));
  router.get("/table/:table", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const table = tableFrom(req);
    const allColumns = await columns(table);
    const names = visible(allColumns).map(c=>ident(c.name)).join(",");
    const limit = Math.min(100,Math.max(1,Number(req.query.limit)||40));
    const offset = Math.min(100000,Math.max(0,Number(req.query.offset)||0));
    const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0,100) : "";
    const searchColumn = allColumns.find(c=>c.name==="name") ?? allColumns.find(c=>c.name==="details");
    const where = term && searchColumn ? " WHERE " + ident(searchColumn.name) + " LIKE ?" : "";
    const params:unknown[] = term && searchColumn ? ["%"+term.replace(/[\\%_]/g,"\\$&")+"%"] : [];
    params.push(limit+1,offset);
    const [rows] = await pool().query<RowDataPacket[]>(
      "SELECT "+names+" FROM "+ident(table)+where+" ORDER BY id DESC LIMIT ? OFFSET ?", params);
    const hasMore=rows.length>limit;
    res.json({ table, rows:rows.slice(0,limit).map(r=>({ data:publicRow(r), etag:etag(r) })), hasMore, offset, limit });
  }));
  router.post("/table/:table", asyncRoute(async (req,res) => {
    const user=actor(req);requireWrite(user.role,"create");
    const table=tableFrom(req);
    requireDocumentWorkflow(table);
    if(table==="users")throw new InputError("مستخدمو SmartPro القدامى محفوظون لأغراض التوافق؛ أضف مستخدمي النظام الحديث من إدارة الصلاحيات.",403);
    const cols=await columns(table);
    const values=validateFields(table,cols,req.body?.values);
    const keys=Object.keys(values);
    const args=keys.map(k=>values[k]);
    const conn=await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [result]=await conn.execute<ResultSetHeader>(
        "INSERT INTO "+ident(table)+" ("+keys.map(ident).join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")",args);
      const id=String(result.insertId);
      if(!result.insertId)throw new InputError("لم يُرجع المحرك رقم السجل الجديد.",409);
      const row=await lockedRow(conn,table,id);
      await audit(conn,user,table,id,"insert",null,row);
      await conn.commit();
      res.status(201).json({ data:publicRow(row??{}),etag:etag(row??{}) });
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }));
  router.patch("/table/:table/:id", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"update");
    const table=tableFrom(req),id=recordIdFrom(req),cols=await columns(table);
    requireDocumentWorkflow(table);
    if(table==="users")throw new InputError("لا يمكن تعديل حسابات SmartPro القديمة. استخدم إدارة صلاحيات NASQO.",403);
    const values=validateFields(table,cols,req.body?.values);
    if(typeof req.body?.etag!=="string"||!/^[a-f0-9]{64}$/.test(req.body.etag))throw new InputError("المراجعة السابقة للسجل مطلوبة.");
    const conn=await pool().getConnection();
    try {
      await conn.beginTransaction();
      const old=await lockedRow(conn,table,id);
      if(!old)throw new InputError("السجل لم يعد موجودًا.",404);
      if(etag(old)!==req.body.etag)throw new InputError("تم تغيير السجل بواسطة مستخدم آخر؛ أعد تحميله قبل التعديل.",409);
      const keys=Object.keys(values);
      await conn.execute("UPDATE "+ident(table)+" SET "+keys.map(k=>ident(k)+"=?").join(",")+" WHERE id=?",
        [...keys.map(k=>values[k]),id]);
      const next=await lockedRow(conn,table,id);
      await audit(conn,user,table,id,"update",old,next);
      await conn.commit();
      res.json({data:publicRow(next??{}),etag:etag(next??{})});
    } catch(error) { await conn.rollback(); throw error; }
    finally {conn.release();}
  }));
  router.delete("/table/:table/:id", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"delete");
    const table=tableFrom(req),id=recordIdFrom(req);
    requireDocumentWorkflow(table);
    if(table==="users")throw new InputError("لا يمكن حذف مستخدمي SmartPro القديمة. استخدم إدارة صلاحيات NASQO.",403);
    if(req.body?.confirmation!==table+":"+id)throw new InputError("تأكيد الحذف غير مطابق.",400);
    if(typeof req.body?.etag!=="string"||!/^[a-f0-9]{64}$/.test(req.body.etag))throw new InputError("المراجعة السابقة للسجل مطلوبة.");
    const conn=await pool().getConnection();
    try{
      await conn.beginTransaction();
      const old=await lockedRow(conn,table,id);
      if(!old)throw new InputError("السجل لم يعد موجودًا.",404);
      if(etag(old)!==req.body.etag)throw new InputError("السجل تغير قبل الحذف. أعد تحميله.",409);
      await requireNoHistoricalReferences(conn,table,id);
      await auditDeleteCascade(conn,user,table,id);
      await conn.execute("DELETE FROM "+ident(table)+" WHERE id=?",[id]);
      await audit(conn,user,table,id,"delete",old,null);
      await conn.commit();
      res.json({ deleted:true, id });
    }catch(error){await conn.rollback();throw error;}
    finally{conn.release();}
  }));
  router.get("/audit", asyncRoute(async(req,res) => {
    authorize(actor(req).role,"roles");
    const [rows]=await pool().query<RowDataPacket[]>(
      "SELECT id,actor_email,table_name,row_id,action,created_at FROM nasqo_audit_log ORDER BY id DESC LIMIT 100");
    res.json({rows});
  }));
  router.get("/roles", asyncRoute(async(req,res) => {
    authorize(actor(req).role,"roles");
    const [rows]=await pool().query<RowDataPacket[]>("SELECT email,role,granted_by,updated_at FROM nasqo_access_roles ORDER BY email LIMIT 100");
    res.json({rows});
  }));
  router.put("/roles/:email", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"roles");
    const email=decodeURIComponent(asParam(req,"email")).trim().toLowerCase();
    if(!/^[^@\s]{1,90}@[^@\s]{1,140}$/.test(email))throw new InputError("البريد الإلكتروني غير صالح");
    const role=req.body?.role as Role;
    if(!["admin","editor","viewer"].includes(role))throw new InputError("صلاحية المستخدم غير صحيحة");
    const conn=await pool().getConnection();
    try{
      await conn.beginTransaction();
      const [oldRows]=await conn.query<RowDataPacket[]>("SELECT email,role FROM nasqo_access_roles WHERE email=? FOR UPDATE",[email]);
      await conn.execute("INSERT INTO nasqo_access_roles(email,role,granted_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role),granted_by=VALUES(granted_by)",[email,role,user.email]);
      await audit(conn,user,"nasqo_access_roles",email,"grant",oldRows[0]??null,{email,role});
      await conn.commit();res.json({email,role});
    }catch(error){await conn.rollback();throw error;}
    finally{conn.release();}
  }));
  router.delete("/roles/:email", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"roles");
    const email=decodeURIComponent(asParam(req,"email")).trim().toLowerCase();
    if(bootstrapAdmins.has(email))throw new InputError("صلاحية المدير الأساسي محمية.",403);
    const conn=await pool().getConnection();
    try{
      await conn.beginTransaction();
      const [rows]=await conn.query<RowDataPacket[]>("SELECT email,role FROM nasqo_access_roles WHERE email=? FOR UPDATE",[email]);
      if(!rows.length)throw new InputError("المستخدم غير موجود.",404);
      await conn.execute("DELETE FROM nasqo_access_roles WHERE email=?",[email]);
      await audit(conn,user,"nasqo_access_roles",email,"revoke",rows[0],null);
      await conn.commit();res.json({deleted:true});
    }catch(error){await conn.rollback();throw error;}
    finally{conn.release();}
  }));
  app.use("/api/smartpro",router);
}
