import type { Database } from "sql.js";
import type { AccountCategory, AccountRecord, CurrencyCode, InventoryItemRecord, WarehouseRecord } from "../types";
import { convertSqliteToLegacyPayload, type SqliteInspectionResult } from "./sqliteEngine";
import { stageLegacyFinancialArchive, type StagedLegacyArchive } from "./legacyFinancialStaging";

export type MigrationOptions = {
  importCustomersAsAccounts?: boolean;
  importStoresAsWarehouses?: boolean;
  importProductsAsInventory?: boolean;
  stageFinancialLedger?: boolean;
};

export type MigrationResult = {
  accountsMigrated: AccountRecord[];
  warehousesMigrated: WarehouseRecord[];
  inventoryMigrated: InventoryItemRecord[];
  stagedArchive?: StagedLegacyArchive;
  alreadyStaged?: boolean;
  legacyIdMap: {
    customers: Record<number, string>;
    stores: Record<number, string>;
    products: Record<number, string>;
  };
  summary: {
    totalCustomers: number;
    totalStores: number;
    totalProducts: number;
    totalMoves: number;
    totalBillDetails: number;
    status: string;
    notice: string;
  };
};

function mapCustomerCategory(typeNum: number): AccountCategory {
  // Map legacy type (1: cash client, 2: credit client, 3: supplier/purchases, 4: employee, etc.)
  switch (typeNum) {
    case 3:
      return "purchases";
    case 4:
      return "employees";
    case 5:
      return "shop";
    case 6:
      return "transfers";
    case 2:
    case 1:
    default:
      return "clients";
  }
}

export function buildErpRecordsFromSqlite(
  db: Database,
  ownerId: string,
): {
  accounts: AccountRecord[];
  warehouses: WarehouseRecord[];
  inventory: InventoryItemRecord[];
  legacyIdMap: {
    customers: Record<number, string>;
    stores: Record<number, string>;
    products: Record<number, string>;
  };
} {
  const accounts: AccountRecord[] = [];
  const warehouses: WarehouseRecord[] = [];
  const inventory: InventoryItemRecord[] = [];

  const legacyIdMap = {
    customers: {} as Record<number, string>,
    stores: {} as Record<number, string>,
    products: {} as Record<number, string>,
  };

  // 1. Stores -> Warehouses
  try {
    const storesRes = db.exec("SELECT id, name, details FROM [stores] ORDER BY id;");
    if (storesRes.length > 0) {
      for (const row of storesRes[0].values) {
        const idNum = Number(row[0]);
        const name = String(row[1] || "").trim() || `مخزن رقم ${idNum}`;
        const details = String(row[2] || "").trim();
        const mappedId = `legacy-wh-${idNum}`;
        legacyIdMap.stores[idNum] = mappedId;

        warehouses.push({
          id: mappedId,
          ownerId,
          name,
          details,
          isDefault: idNum === 1,
          codeNumber: idNum,
        });
      }
    }
  } catch {
    // ignore
  }

  // 2. Customers -> Accounts
  try {
    const custRes = db.exec("SELECT id, name, details, type, phone, lim, phon, msg, msgway FROM [customers] ORDER BY id;");
    if (custRes.length > 0) {
      for (const row of custRes[0].values) {
        const idNum = Number(row[0]);
        const name = String(row[1] || "").trim() || `حساب عميل ${idNum}`;
        const details = String(row[2] || "").trim();
        const typeNum = Number(row[3]) || 1;
        const phone = String(row[4] || row[6] || "").trim();
        const creditLimit = Number(String(row[5] || "0").replace(/,/g, "")) || 0;
        const msgNum = Number(row[7]) || 0;
        const msgWay = Number(row[8]) || 0;

        const mappedId = `legacy-acc-${idNum}`;
        legacyIdMap.customers[idNum] = mappedId;

        accounts.push({
          id: mappedId,
          ownerId,
          name,
          category: mapCustomerCategory(typeNum),
          phone,
          creditLimit,
          currency: "ريال" as CurrencyCode,
          isCashAccount: idNum === 1 || name.includes("نقد"),
          accountImage: "1",
          sortOrder: idNum,
          settlement: false,
          documentNumberRequired: false,
          messageMethod: msgNum === 1 ? "whatsapp" : "sms",
          sendMode: msgWay === 1 ? "confirm" : msgWay === 2 ? "auto" : "never",
          note: details,
          openingBalance: 0,
          openingDirection: "debit",
          codeNumber: idNum,
        });
      }
    }
  } catch {
    // ignore
  }

  // 3. Products -> Inventory Items
  try {
    const prodRes = db.exec("SELECT id, name, price, barcode, price2, unit FROM [products] ORDER BY id;");
    if (prodRes.length > 0) {
      for (const row of prodRes[0].values) {
        const idNum = Number(row[0]);
        const name = String(row[1] || "").trim() || `صنف رقم ${idNum}`;
        const sellPrice = Number(String(row[2] || "0").replace(/,/g, "")) || 0;
        const barcode = String(row[3] || "").trim();
        const costPrice = Number(String(row[4] || "0").replace(/,/g, "")) || 0;
        const unit = String(row[5] || "").trim() || "حبة";

        const mappedId = `legacy-prod-${idNum}`;
        legacyIdMap.products[idNum] = mappedId;

        inventory.push({
          id: mappedId,
          ownerId,
          name,
          sku: barcode,
          unit,
          quantity: 0,
          avgCost: costPrice,
          minThreshold: 0,
          warehouseId: warehouses.length > 0 ? warehouses[0].id : "wh-default",
        });
      }
    }
  } catch {
    // ignore
  }

  return { accounts, warehouses, inventory, legacyIdMap };
}

export async function migrateSqliteToErpWorkspace(
  db: Database,
  workspaceId: string,
  inspection: SqliteInspectionResult,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const {
    importCustomersAsAccounts = true,
    importStoresAsWarehouses = true,
    importProductsAsInventory = true,
    stageFinancialLedger = true,
  } = options;

  const { accounts, warehouses, inventory, legacyIdMap } = buildErpRecordsFromSqlite(db, workspaceId);

  const selectedAccounts = importCustomersAsAccounts ? accounts : [];
  const selectedWarehouses = importStoresAsWarehouses ? warehouses : [];
  const selectedInventory = importProductsAsInventory ? inventory : [];

  let stagedArchive: StagedLegacyArchive | undefined;
  let alreadyStaged = false;

  if (stageFinancialLedger) {
    const payload = convertSqliteToLegacyPayload(
      db,
      inspection.sourceSha256,
      inspection.fileName,
      inspection.userVersion,
    );
    const { inspectLegacyFinancialArchive } = await import("./legacyFinancialStaging");
    const preflight = inspectLegacyFinancialArchive(payload);
    const stagingResult = await stageLegacyFinancialArchive(workspaceId, preflight);
    stagedArchive = stagingResult.meta;
    alreadyStaged = stagingResult.alreadyImported;
  }

  return {
    accountsMigrated: selectedAccounts,
    warehousesMigrated: selectedWarehouses,
    inventoryMigrated: selectedInventory,
    stagedArchive,
    alreadyStaged,
    legacyIdMap,
    summary: {
      totalCustomers: selectedAccounts.length,
      totalStores: selectedWarehouses.length,
      totalProducts: selectedInventory.length,
      totalMoves: inspection.tableCounts.input_move ?? 0,
      totalBillDetails: (inspection.tableCounts.bill_details ?? 0) + (inspection.tableCounts.bill_details2 ?? 0),
      status: "completed_staged_safely",
      notice: "تم ترحيل البيانات الهيكلية (الحسابات، المخازن، الأصناف) بنجاح. وحُفظت القيود المالية والفواتير في وضع المراجعة التاريخية والتدقيق دون التأثير على الأستاذ العام الحي.",
    },
  };
}
