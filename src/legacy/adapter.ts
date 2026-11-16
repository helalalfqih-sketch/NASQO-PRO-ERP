/**
 * LegacyDatabaseAdapter
 * ---------------------
 * Read-only access to a legacy NASQO SQLite database (via sql.js / WebAssembly).
 * It never writes to the source: the raw bytes are kept untouched by the caller and the
 * adapter only runs SELECT / PRAGMA statements against an in-memory copy.
 */
import type { Database } from "sql.js";
import { computeSha256, getSqlJs, isSqliteBinary } from "../utils/sqliteEngine";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type ColumnSchema = {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  defaultValue: unknown;
  pk: number;
};
export type ForeignKeySchema = { from: string; table: string; to: string };
export type IndexSchema = { name: string; unique: boolean; columns: string[] };
export type TableSchema = {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  foreignKeys: ForeignKeySchema[];
  indexes: IndexSchema[];
  rowCount: number;
  createSql: string;
};
export type SchemaReport = {
  sha256: string;
  fileName: string;
  size: number;
  integrity: string;
  userVersion: number;
  tableCount: number;
  totalRows: number;
  tables: TableSchema[];
};

export type ImplicitRelation = {
  child: string;
  column: string;
  parent: string;
  parentColumn: string;
  distinctChildValues: number;
  matched: number;
  orphanValues: number;
  orphanRows: number;
  coverage: number;
  declaredAsForeignKey: boolean;
};

export type DistinctValueReport = {
  table: string;
  column: string;
  values: { value: unknown; count: number }[];
};

const RELATION_COLUMN_HINT = /(^|_)id\d*$|^cur$|^type$|^cboxid$|^per_id$/i;
const DISTINCT_VALUE_COLUMNS: [string, string][] = [
  ["input_move", "bill_type"],
  ["input_move", "bstate"],
  ["input_move", "cur"],
  ["input_move", "cboxid"],
  ["bin", "bill_type"],
  ["customers", "type"],
  ["customers", "msg"],
  ["customers", "msgway"],
  ["store_trans", "type"],
  ["stores", "state"],
  ["products", "bstate"],
  ["products", "defunit"],
  ["products", "cur"],
  ["bill_details", "unitnum"],
];

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`اسم غير مسموح به في قاعدة البيانات: ${name}`);
  }
  return `[${name}]`;
}

function objectsOf(result: { columns: string[]; values: unknown[][] }[]): Row[] {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((v) => {
    const row: Row = {};
    columns.forEach((c, i) => {
      row[c] = v[i];
    });
    return row;
  });
}

export class LegacyDatabaseAdapter {
  private constructor(
    private readonly db: Database,
    readonly sha256: string,
    readonly fileName: string,
    readonly size: number,
  ) {}

  static async open(bytes: Uint8Array, fileName = "legacy.sqlite"): Promise<LegacyDatabaseAdapter> {
    if (!isSqliteBinary(bytes)) {
      throw new Error("الملف ليس قاعدة SQLite صالحة: توقيع الملف الثنائي لا يطابق «SQLite format 3».");
    }
    const sha256 = await computeSha256(bytes);
    const SQL = await getSqlJs();
    // sql.js copies the buffer into WASM memory; the caller's bytes stay untouched.
    const db = new SQL.Database(bytes);
    return new LegacyDatabaseAdapter(db, sha256, fileName, bytes.byteLength);
  }

  close(): void {
    this.db.close();
  }

  private query(sql: string): Row[] {
    return objectsOf(this.db.exec(sql));
  }

  tableNames(): string[] {
    return this.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((r) => String(r.name));
  }

  /** Real schema: columns, types, primary keys, declared foreign keys, indexes and exact row counts. */
  schema(): SchemaReport {
    const integrityRows = this.db.exec("PRAGMA integrity_check");
    const integrity = integrityRows.length ? String(integrityRows[0].values[0][0]) : "unknown";
    const uv = this.db.exec("PRAGMA user_version");
    const userVersion = uv.length ? Number(uv[0].values[0][0]) || 0 : 0;

    const tables: TableSchema[] = [];
    let totalRows = 0;
    for (const name of this.tableNames()) {
      const q = quoteIdent(name);
      const columns = this.query(`PRAGMA table_info(${q})`).map<ColumnSchema>((c) => ({
        cid: Number(c.cid),
        name: String(c.name),
        type: String(c.type),
        notnull: Number(c.notnull) === 1,
        defaultValue: c.dflt_value,
        pk: Number(c.pk),
      }));
      const foreignKeys = this.query(`PRAGMA foreign_key_list(${q})`).map<ForeignKeySchema>((f) => ({
        from: String(f.from),
        table: String(f.table),
        to: String(f.to),
      }));
      const indexes = this.query(`PRAGMA index_list(${q})`).map<IndexSchema>((i) => {
        const cols = this.query(`PRAGMA index_info(${quoteIdent(String(i.name))})`).map((c) => String(c.name));
        return { name: String(i.name), unique: Number(i.unique) === 1, columns: cols };
      });
      const rowCount = Number(this.db.exec(`SELECT COUNT(*) FROM ${q}`)[0].values[0][0]);
      totalRows += rowCount;
      const createSql = String(
        this.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${name}'`)[0]?.sql ?? "",
      );
      tables.push({
        name,
        columns,
        primaryKey: columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name),
        foreignKeys,
        indexes,
        rowCount,
        createSql,
      });
    }
    return {
      sha256: this.sha256,
      fileName: this.fileName,
      size: this.size,
      integrity,
      userVersion,
      tableCount: tables.length,
      totalRows,
      tables,
    };
  }

  /** Every row of a table. Rows without an `id` column get `__rowid__` so they stay addressable. */
  loadTable(name: string): Row[] {
    const q = quoteIdent(name);
    const hasId = this.query(`PRAGMA table_info(${q})`).some((c) => String(c.name) === "id");
    const rows = this.query(hasId ? `SELECT * FROM ${q}` : `SELECT rowid AS __rowid__, * FROM ${q}`);
    return rows;
  }

  loadAll(): Tables {
    const tables: Tables = {};
    for (const name of this.tableNames()) tables[name] = this.loadTable(name);
    return tables;
  }

  /**
   * Discovers relations that are used by the data even when they are not declared as FOREIGN KEY:
   * a column whose values are (almost) all primary keys of another table.
   */
  discoverRelations(tables: Tables, schema: SchemaReport): ImplicitRelation[] {
    const idSets = new Map<string, Set<string>>();
    for (const [name, rows] of Object.entries(tables)) {
      idSets.set(name, new Set(rows.map((r) => String(r.id ?? r.__rowid__))));
    }
    const result: ImplicitRelation[] = [];
    for (const table of schema.tables) {
      const rows = tables[table.name] ?? [];
      for (const col of table.columns) {
        if (col.name === "id" || !RELATION_COLUMN_HINT.test(col.name)) continue;
        const counts = new Map<string, number>();
        for (const r of rows) {
          const v = r[col.name];
          if (v === null || v === undefined || v === "") continue;
          const k = String(v);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        if (counts.size === 0) continue;
        let best: ImplicitRelation | null = null;
        for (const [parent, ids] of idSets) {
          if (parent === table.name) continue;
          let matched = 0;
          let orphanRows = 0;
          for (const [k, n] of counts) {
            if (ids.has(k)) matched += 1;
            else orphanRows += n;
          }
          const coverage = matched / counts.size;
          const declared = table.foreignKeys.some((f) => f.from === col.name && f.table === parent);
          if (coverage < 0.8 && !declared) continue;
          if (counts.size < 2 && !declared) continue;
          const candidate: ImplicitRelation = {
            child: table.name,
            column: col.name,
            parent,
            parentColumn: "id",
            distinctChildValues: counts.size,
            matched,
            orphanValues: counts.size - matched,
            orphanRows,
            coverage,
            declaredAsForeignKey: declared,
          };
          if (!best || candidate.coverage > best.coverage || (candidate.coverage === best.coverage && declared)) {
            best = candidate;
          }
        }
        if (best) result.push(best);
      }
    }
    return result.sort((a, b) => a.child.localeCompare(b.child) || a.column.localeCompare(b.column));
  }

  distinctValues(tables: Tables): DistinctValueReport[] {
    const reports: DistinctValueReport[] = [];
    for (const [table, column] of DISTINCT_VALUE_COLUMNS) {
      const rows = tables[table];
      if (!rows) continue;
      const counts = new Map<string, { value: unknown; count: number }>();
      for (const r of rows) {
        const k = String(r[column]);
        const entry = counts.get(k) ?? { value: r[column], count: 0 };
        entry.count += 1;
        counts.set(k, entry);
      }
      reports.push({
        table,
        column,
        values: [...counts.values()].sort((a, b) => String(a.value).localeCompare(String(b.value), "en", { numeric: true })),
      });
    }
    return reports;
  }
}

/** Stable identifier derived from the source copy, table and original primary key. */
export function legacyRef(sha256: string, table: string, id: unknown): string {
  return `${sha256.slice(0, 12)}:${table}:${String(id)}`;
}

export function rowKey(row: Row): string {
  return String(row.id ?? row.__rowid__);
}
