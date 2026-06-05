import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fsSync from "node:fs";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

async function runPython(args: string[], opts: { cwd: string; env?: Record<string, string | undefined> }) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("python", args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...(opts.env ?? {}),
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`Python exited with code ${code}. stderr: ${stderr.slice(0, 4000)}`));
    });
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// POC lives either at repo root (older layout) or under `tacit-frontend/` (your current layout).
const ROOT_PYTHON_POC_PATH = path.join(REPO_ROOT, "contract_revrec_poc");
const FRONTEND_PYTHON_POC_PATH = path.join(REPO_ROOT, "tacit-frontend", "contract_revrec_poc");
// Use whichever layout has the actual LLM parsing modules.
const PYTHON_POC_PATH = fsSync.existsSync(path.join(ROOT_PYTHON_POC_PATH, "llm_parser.py"))
  ? ROOT_PYTHON_POC_PATH
  : FRONTEND_PYTHON_POC_PATH;
const PYTHON_MAIN = path.join(PYTHON_POC_PATH, "main.py");

const ParseContractJsonBodySchema = z.object({
  filename: z.string().optional(),
  text: z.string().min(1).optional(),
});

const ProcessLlmConfigSchema = z.object({
  llmExtraInstructions: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : undefined),
    z.string().max(5000).optional(),
  ),
  schemaHintMode: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : undefined),
    z.enum(["default", "override"]).optional(),
  ),
  schemaHintOverride: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : undefined),
    z.string().max(20000).optional(),
  ),
});

type ProcessLlmConfig = z.infer<typeof ProcessLlmConfigSchema>;

type RevenueRecognitionMethod = "ratable" | "point_in_time";

type ParsedContract = {
  source: {
    filename?: string;
    contentType?: string;
  };
  extracted: {
    fields: Record<string, string | number | boolean | null>;
    lineItems: Array<{
      lineId: string;
      productName: string;
      sku?: string | null;
      quantity: number;
      unitPrice: number;
      amount: number;
      currency: string;
      serviceStart?: string | null;
      serviceEnd?: string | null;
      revRecMethod: RevenueRecognitionMethod;
    }>;
  };
  revenueRecognition: {
    policyAssumptions: string[];
    schedule: Array<{
      periodStart: string; // YYYY-MM-01
      periodEnd: string; // YYYY-MM-DD (last day of month)
      amount: number;
      currency: string;
    }>;
    totals: {
      totalContractValue: number;
      totalRecognized: number;
      currency: string;
    };
  };
};

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(String(n ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(v) ? v : fallback;
}

function toIsoDateOnly(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function endOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function parseDateLoose(text: string): Date | null {
  const s = String(text || "").trim();
  if (!s) return null;

  // Prefer explicit YYYY-MM-DD as UTC to avoid timezone drift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (yyyy >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return new Date(Date.UTC(yyyy, mm - 1, dd));
    }
  }

  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetweenInclusiveUtc(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(0, days);
}

function allocateRatableByMonth(params: {
  amount: number;
  currency: string;
  serviceStart: Date;
  serviceEnd: Date;
}) {
  const { amount, currency, serviceStart, serviceEnd } = params;
  const totalDays = daysBetweenInclusiveUtc(serviceStart, serviceEnd);
  if (totalDays <= 0 || amount === 0) return [];

  const out: Array<{ periodStart: string; periodEnd: string; amount: number; currency: string }> = [];
  let cursor = startOfMonthUtc(serviceStart);
  const lastMonthStart = startOfMonthUtc(serviceEnd);

  const rawAllocations: Array<{ periodStart: Date; periodEnd: Date; amount: number }> = [];

  while (cursor.getTime() <= lastMonthStart.getTime()) {
    const periodStart = cursor;
    const periodEnd = endOfMonthUtc(cursor);
    const overlapStart = new Date(Math.max(periodStart.getTime(), serviceStart.getTime()));
    const overlapEnd = new Date(Math.min(periodEnd.getTime(), serviceEnd.getTime()));
    const overlapDays = overlapStart.getTime() <= overlapEnd.getTime() ? daysBetweenInclusiveUtc(overlapStart, overlapEnd) : 0;

    const slice = (amount * overlapDays) / totalDays;
    rawAllocations.push({ periodStart, periodEnd, amount: slice });

    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  // Round to cents; true-up last period to match original amount.
  const rounded = rawAllocations.map((x) => ({
    ...x,
    amount: Math.round(x.amount * 100) / 100,
  }));
  const sumRounded = rounded.reduce((acc, x) => acc + x.amount, 0);
  const diff = Math.round((amount - sumRounded) * 100) / 100;
  if (rounded.length > 0 && diff !== 0) {
    rounded[rounded.length - 1].amount = Math.round((rounded[rounded.length - 1].amount + diff) * 100) / 100;
  }

  for (const r of rounded) {
    out.push({
      periodStart: toIsoDateOnly(r.periodStart),
      periodEnd: toIsoDateOnly(r.periodEnd),
      amount: r.amount,
      currency,
    });
  }
  return out;
}

function extractValue(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) return String(m[1]).trim();
  }
  return null;
}

function basicOrderFormParser(rawText: string): ParsedContract["extracted"] {
  const text = rawText.replace(/\r/g, "");

  const customerName =
    extractValue(text, [
      /Customer\s*Name\s*[:\-]\s*(.+)$/im,
      /Customer\s*[:\-]\s*(.+)$/im,
      /Sold\s*To\s*[:\-]\s*(.+)$/im,
    ]) ?? null;

  const contractNumber =
    extractValue(text, [/Order\s*Form\s*(?:Number|#)\s*[:\-]\s*(.+)$/im, /Contract\s*(?:Number|#)\s*[:\-]\s*(.+)$/im]) ??
    null;

  const effectiveDate =
    extractValue(text, [/Effective\s*Date\s*[:\-]\s*(.+)$/im, /Start\s*Date\s*[:\-]\s*(.+)$/im]) ?? null;

  const endDate = extractValue(text, [/End\s*Date\s*[:\-]\s*(.+)$/im, /Termination\s*Date\s*[:\-]\s*(.+)$/im]) ?? null;

  const currency = (extractValue(text, [/Currency\s*[:\-]\s*([A-Z]{3})/im]) ?? "USD").toUpperCase();

  const totalContractValue =
    safeNumber(extractValue(text, [/Total\s*(?:Contract\s*)?Value\s*[:\-]\s*(.+)$/im, /Total\s*Fees\s*[:\-]\s*(.+)$/im]) ?? 0, 0);

  // POC: one synthetic line item if we can't reliably read a table.
  const lineItems: ParsedContract["extracted"]["lineItems"] = [
    {
      lineId: "1",
      productName: (extractValue(text, [/Product\s*[:\-]\s*(.+)$/im, /Subscription\s*[:\-]\s*(.+)$/im]) ?? "MetricStream Subscription")!,
      sku: null,
      quantity: 1,
      unitPrice: totalContractValue || 0,
      amount: totalContractValue || 0,
      currency,
      serviceStart: effectiveDate,
      serviceEnd: endDate,
      revRecMethod: "ratable",
    },
  ];

  return {
    fields: {
      customerName,
      contractNumber,
      effectiveDate,
      endDate,
      currency,
      totalContractValue,
    },
    lineItems,
  };
}

function calculateRevRec(extracted: ParsedContract["extracted"]): ParsedContract["revenueRecognition"] {
  const currency =
    (typeof extracted.fields.currency === "string" && extracted.fields.currency.trim()
      ? extracted.fields.currency.trim().toUpperCase()
      : "USD") || "USD";

  const policyAssumptions = [
    "POC policy: subscription revenue is recognized ratably over the service period (monthly, day-weighted).",
    "POC policy: rounding to cents with end-of-schedule true-up to match line item amount.",
    "Once you provide the MetricStream rev rec policy, we will map each product/service type to the correct method (e.g., ratable vs point-in-time vs milestones) and any allocation rules.",
  ];

  const byMonthKey = new Map<string, { periodStart: string; periodEnd: string; amount: number; currency: string }>();

  for (const li of extracted.lineItems) {
    const amount = safeNumber(li.amount, 0);
    if (!amount) continue;

    if (li.revRecMethod === "point_in_time") {
      const d = parseDateLoose(li.serviceStart || "") ?? new Date();
      const ps = toIsoDateOnly(startOfMonthUtc(d));
      const pe = toIsoDateOnly(endOfMonthUtc(d));
      const key = ps;
      const existing = byMonthKey.get(key) ?? { periodStart: ps, periodEnd: pe, amount: 0, currency };
      existing.amount = Math.round((existing.amount + amount) * 100) / 100;
      byMonthKey.set(key, existing);
      continue;
    }

    const s = parseDateLoose(li.serviceStart || "") ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const e = parseDateLoose(li.serviceEnd || "") ?? endOfMonthUtc(s);
    const alloc = allocateRatableByMonth({ amount, currency, serviceStart: s, serviceEnd: e });
    for (const a of alloc) {
      const key = a.periodStart;
      const existing = byMonthKey.get(key) ?? { ...a, amount: 0 };
      existing.amount = Math.round((existing.amount + a.amount) * 100) / 100;
      byMonthKey.set(key, existing);
    }
  }

  const schedule = Array.from(byMonthKey.values()).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const totalRecognized = Math.round(schedule.reduce((acc, x) => acc + safeNumber(x.amount, 0), 0) * 100) / 100;

  const totalContractValue =
    typeof extracted.fields.totalContractValue === "number"
      ? extracted.fields.totalContractValue
      : safeNumber(extracted.fields.totalContractValue, 0);

  return {
    policyAssumptions,
    schedule,
    totals: {
      totalContractValue: Math.round(totalContractValue * 100) / 100,
      totalRecognized,
      currency,
    },
  };
}

async function extractTextFromUpload(file: Express.Multer.File): Promise<string> {
  const contentType = String(file.mimetype || "").toLowerCase();
  const filename = String(file.originalname || "").toLowerCase();

  const isPdf = contentType.includes("pdf") || filename.endsWith(".pdf");
  const isDocx =
    contentType.includes("officedocument.wordprocessingml.document") || filename.endsWith(".docx") || filename.endsWith(".doc");

  if (isPdf) {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const parsed = await parser.getText();
      return String(parsed.text || "");
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  if (isDocx) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return String(result.value || "");
  }

  // Fallback: treat as UTF-8 text
  return file.buffer.toString("utf8");
}

router.post(
  "/parse",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const uploaded = (req as any).file as Express.Multer.File | undefined;
      let filename: string | undefined;
      let contentType: string | undefined;
      let rawText: string | undefined;

      if (uploaded) {
        filename = uploaded.originalname;
        contentType = uploaded.mimetype;
        rawText = await extractTextFromUpload(uploaded);
      } else {
        const parsed = ParseContractJsonBodySchema.safeParse(req.body ?? {});
        if (!parsed.success || !parsed.data.text) {
          res.status(400).json({ error: "Provide a contract file upload (field: file) or JSON body with { text }." });
          return;
        }
        filename = parsed.data.filename;
        rawText = parsed.data.text;
      }

      const extracted = basicOrderFormParser(rawText || "");
      const revenueRecognition = calculateRevRec(extracted);

      const payload: ParsedContract = {
        source: { filename, contentType },
        extracted,
        revenueRecognition,
      };

      res.json(payload);
    } catch (e: any) {
      console.error("Contract parse error:", e);
      res.status(500).json({ error: e?.message || "Failed to parse contract" });
    }
  },
);

async function runCanonicalPipeline(uploaded: Express.Multer.File, llmConfig?: { llmExtraInstructions?: string; schemaHintOverrideJson?: string }) {
  const jobId = randomUUID();
  const tmpRoot = path.join(os.tmpdir(), "tacit-contract-revrec-poc", jobId);
  const inputDir = path.join(tmpRoot, "input");
  const outDir = path.join(tmpRoot, "output");
  const debugDir = path.join(tmpRoot, "debug");

  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(debugDir, { recursive: true });

  const inputPdfPath = path.join(inputDir, uploaded.originalname || "contract.pdf");
  await fs.writeFile(inputPdfPath, uploaded.buffer);

  const pyEnv: Record<string, string | undefined> = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    LLM_MAX_RETRIES: process.env.LLM_MAX_RETRIES,
    LLM_MAX_TEXT_CHARS: process.env.LLM_MAX_TEXT_CHARS,
    LLM_EXTRA_INSTRUCTIONS: llmConfig?.llmExtraInstructions,
    LLM_SCHEMA_HINT_OVERRIDE_JSON: llmConfig?.schemaHintOverrideJson,
  };

  const args = [
    PYTHON_MAIN,
    "--input",
    inputPdfPath,
    "--out-dir",
    outDir,
    "--debug-dir",
    debugDir,
  ];

  if (!fsSync.existsSync(PYTHON_MAIN)) {
    throw new Error(`Contract POC Python entrypoint not found: ${PYTHON_MAIN}`);
  }

  const { stdout, stderr } = await runPython(args, { cwd: PYTHON_POC_PATH, env: pyEnv });

  const normalizedJsonPath = path.join(outDir, "normalized_contract.json");
  const excelPath = path.join(outDir, "extracted_contract.xlsx");

  const normalizedRaw = await fs.readFile(normalizedJsonPath, "utf-8");
  const excelBuf = await fs.readFile(excelPath);

  return {
    jobId,
    normalized_contract: JSON.parse(normalizedRaw),
    excel_filename: "extracted_contract.xlsx",
    excel_base64: excelBuf.toString("base64"),
    python_stdout: stdout.slice(0, 8000),
    python_stderr: stderr.slice(0, 8000),
  };
}

/**
 * Canonical extraction -> standardized Excel workbook.
 * Uses `contract_revrec_poc/main.py` (PDF extraction + OpenAI normalization + Excel writer).
 */
router.post("/extract-excel", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const uploaded = (req as any).file as Express.Multer.File | undefined;
    if (!uploaded) {
      res.status(400).json({ error: "Provide a contract file upload (field: file)." });
      return;
    }

    const parsedCfg = ProcessLlmConfigSchema.safeParse(req.body ?? {});
    if (!parsedCfg.success) {
      res.status(400).json({ error: "Invalid LLM config", details: parsedCfg.error.flatten() });
      return;
    }

    const cfg = parsedCfg.data;
    const schemaHintMode = cfg.schemaHintMode ?? "default";

    let schemaHintOverrideJson: string | undefined;
    if (schemaHintMode === "override") {
      const rawOverride = cfg.schemaHintOverride;
      if (!rawOverride) {
        res.status(400).json({ error: "schemaHintOverride is required when schemaHintMode=override" });
        return;
      }
      try {
        const parsed = JSON.parse(rawOverride);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("schemaHintOverride must be a JSON object");
        }
        schemaHintOverrideJson = JSON.stringify(parsed);
      } catch (e: any) {
        res.status(400).json({ error: e?.message || "Invalid schemaHintOverride JSON" });
        return;
      }
    }

    const result = await runCanonicalPipeline(uploaded, {
      llmExtraInstructions: cfg.llmExtraInstructions,
      schemaHintOverrideJson,
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (e: any) {
    console.error("extract-excel error:", e);
    res.status(500).json({ error: e?.message || "Failed to extract + generate Excel" });
  }
});

/**
 * Unified processing endpoint: run the canonical pipeline once and return
 * normalized JSON + Excel, for the primary \"Process Information\" UI flow.
 */
router.post("/process", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const uploaded = (req as any).file as Express.Multer.File | undefined;
    if (!uploaded) {
      res.status(400).json({ error: "Provide a contract file upload (field: file)." });
      return;
    }

    const parsedCfg = ProcessLlmConfigSchema.safeParse(req.body ?? {});
    if (!parsedCfg.success) {
      res.status(400).json({ error: "Invalid LLM config", details: parsedCfg.error.flatten() });
      return;
    }

    const cfg = parsedCfg.data;
    const schemaHintMode = cfg.schemaHintMode ?? "default";

    let schemaHintOverrideJson: string | undefined;
    if (schemaHintMode === "override") {
      const rawOverride = cfg.schemaHintOverride;
      if (!rawOverride) {
        res.status(400).json({ error: "schemaHintOverride is required when schemaHintMode=override" });
        return;
      }
      try {
        const parsed = JSON.parse(rawOverride);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("schemaHintOverride must be a JSON object");
        }
        schemaHintOverrideJson = JSON.stringify(parsed);
      } catch (e: any) {
        res.status(400).json({ error: e?.message || "Invalid schemaHintOverride JSON" });
        return;
      }
    }

    const result = await runCanonicalPipeline(uploaded, {
      llmExtraInstructions: cfg.llmExtraInstructions,
      schemaHintOverrideJson,
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (e: any) {
    console.error("process error:", e);
    res.status(500).json({ error: e?.message || "Failed to process contract" });
  }
});

router.post("/push/salesforce", async (req: Request, res: Response) => {
  try {
    // POC: stubbed integration boundary
    res.json({
      ok: true,
      system: "salesforce",
      mode: "stub",
      message: "POC stub: wire Salesforce credentials + object mappings to enable real upserts.",
      receivedKeys: Object.keys(req.body ?? {}),
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to push to Salesforce" });
  }
});

router.post("/push/drivetrain", async (req: Request, res: Response) => {
  try {
    // POC: stubbed integration boundary
    res.json({
      ok: true,
      system: "drivetrain",
      mode: "stub",
      message: "POC stub: wire DriveTrain API credentials + model mapping to enable real loads.",
      receivedKeys: Object.keys(req.body ?? {}),
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to push to DriveTrain" });
  }
});

export default router;

