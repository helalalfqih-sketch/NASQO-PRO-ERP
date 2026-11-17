import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { mountSmartProApi } from "./server/smartpro.ts";
import { mountSqliteApi } from "./server/sqliteApi.ts";
import { closeSqliteDb } from "./server/sqliteDb.ts";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const ALLOWED_CATEGORIES = [
  "مشتريات بضائع",
  "مصروفات تشغيلية",
  "شحن ونقل",
  "رواتب وأجور",
  "صيانة ومرافق",
  "تسويق ومبيعات",
  "إيجار ومقر",
  "أخرى",
] as const;

function resolvePort(): number {
  const portFlagIndex = process.argv.indexOf("--port");
  if (portFlagIndex !== -1 && process.argv[portFlagIndex + 1]) {
    const parsed = Number(process.argv[portFlagIndex + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT || 3000);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolvePort();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";

async function createApp() {
  const app = express();

  // Defense in depth: even if a private backup is accidentally included in
  // static assets, never serve it over HTTP (including unauthenticated paths).
  app.use((req: Request, res: Response, next: NextFunction) => {
    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(req.path);
    } catch {
      res.sendStatus(400);
      return;
    }
    if (/\.(?:back|db|sqlite|sqlite3|dump|sql)(?:\.gz)?$/i.test(requestedPath)) {
      res.status(404).end();
      return;
    }
    next();
  });

  // Single unified SQLite database API (has its own scoped 32mb JSON limit for imports).
  mountSqliteApi(app);

  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "nasqo-pro-api" });
  });

  // Protected, role-based SmartPro database API; all changes are audited.
  mountSmartProApi(app);

  app.post("/api/ai/categorize-expense", async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: "خدمة التصنيف الذكي بالذكاء الاصطناعي غير مفعلة حاليًا (مفتاح الخادم غير متوفر).",
      });
      return;
    }

    const body = (req.body ?? {}) as {
      description?: unknown;
      vendorName?: unknown;
      amount?: unknown;
      currency?: unknown;
      entryType?: unknown;
    };

    const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
    const vendorName = typeof body.vendorName === "string" ? body.vendorName.trim().slice(0, 120) : "";
    const amount = typeof body.amount === "number" || typeof body.amount === "string" ? String(body.amount) : "";
    const currency = typeof body.currency === "string" ? body.currency.trim().slice(0, 20) : "ريال";
    const entryType = typeof body.entryType === "string" ? body.entryType.trim().slice(0, 60) : "";

    if (!description && !vendorName) {
      res.status(400).json({ error: "أدخل بيان العملية أو اسم المورد أولًا للحصول على اقتراح التصنيف." });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: 10_000,
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const prompt = [
        "أنت محاسب مالي محترف لنظام محاسبة عربي (نسقو برو).",
        "صنّف العملية المالية أو المصروف التالي إلى واحدة فقط من الفئات المحاسبية المسموح بها:",
        ALLOWED_CATEGORIES.join("، "),
        "",
        `اسم الحساب / المورد: ${vendorName || "غير محدد"}`,
        `بيان العملية / الأصناف: ${description || "غير محدد"}`,
        amount ? `المبلغ: ${amount} ${currency}` : "",
        entryType ? `نوع المستند: ${entryType}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await ai.models
        .generateContent({
          model: "gemini-4-hydrogen",
          contents: prompt,
          config: {
            abortSignal: controller.signal,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                category: {
                  type: Type.STRING,
                  enum: [...ALLOWED_CATEGORIES],
                  description: "أقرب فئة محاسبية مناسبة باللغة العربية.",
                },
                confidence: {
                  type: Type.NUMBER,
                  description: "نسبة الثقة من 0 إلى 100.",
                },
                reason: {
                  type: Type.STRING,
                  description: "تفسير عربي موجز جدًا (أقل من 12 كلمة) لسبب التصنيف.",
                },
              },
              required: ["category", "confidence", "reason"],
            },
          },
        })
        .finally(() => clearTimeout(timer));

      const text = response.text?.trim();
      if (!text) {
        res.status(502).json({ error: "لم يُرجع نموذج التصنيف نتيجة صالحة." });
        return;
      }

      const parsed = JSON.parse(text) as {
        category?: string;
        confidence?: number;
        reason?: string;
      };
      const category = ALLOWED_CATEGORIES.includes(parsed.category as (typeof ALLOWED_CATEGORIES)[number])
        ? parsed.category!
        : "أخرى";
      const confidence =
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
          : 85;
      const reason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 140) : "";

      res.json({
        category,
        confidence,
        reason,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطأ غير متوقع أثناء التصنيف الذكي";
      console.error("Gemini expense categorization failed:", err);
      res.status(500).json({
        error: `تعذر إتمام التصنيف الذكي: ${message}`,
      });
    }
  });

  const httpServer = http.createServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: path.resolve(__dirname, "vite.dev.config.ts"),
      server: { middlewareMode: true, hmr: false, ws: { server: httpServer } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const clientDir = path.resolve(__dirname, "dist/client");
    app.use(express.static(clientDir));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`NASQO Pro server listening on http://0.0.0.0:${PORT}`);
  });

  httpServer.on("error", (err) => {
    console.error("Server error:", err);
  });

  const shutdown = () => {
    closeSqliteDb();
    httpServer.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void createApp();
