/**
 * Moteur de recalcul de classeur (code maison, MIT) : graphe de dépendances entre cellules (références relatives /
 * absolues, plages, autres feuilles, noms définis), ordre topologique itératif (pas de récursion profonde),
 * évaluation dans cet ordre, rapport de couverture (formules non évaluables : analyse impossible, fonction inconnue,
 * référence circulaire). Fonctions : bibliothèque maison (functions.ts), repli sur @formulajs/formulajs (MIT).
 */
import { parseFormula, addrOf, FormulaParseError, type Node } from "./parser";
import { EAGER, LAZY, implicit, type FnCtx } from "./functions";
import { ERR, XlErr, arr, compare, isArr, toNum, toStr, type Arr, type Scalar, type Val } from "./values";

export interface CellIn {
  /** Valeur saisie ou valeur en cache (null si absente). */
  v: Scalar;
  /** Formule (sans « = »). */
  f?: string;
}
export interface SheetIn {
  name: string;
  /** Clé = r * 16384 + c (indices 0). */
  cells: Map<number, CellIn>;
  maxR: number;
  maxC: number;
}
export interface WorkbookIn {
  sheets: SheetIn[];
  /** Noms définis : nom → formule de référence (« 'Hyp'!$D$4 »). */
  names?: Record<string, string>;
}
export interface FormulaIssue {
  sheet: string;
  addr: string;
  formula: string;
  reason: string;
}
export interface RecalcReport {
  formulas: number;
  /** Formules évaluées (y compris celles dont le résultat est une erreur Excel légitime, ex. #DIV/0! dans IFERROR). */
  evaluated: number;
  /** Formules non évaluables (analyse, fonction inconnue, circularité, fonction non prise en charge). */
  failed: number;
  /** Résultats en erreur Excel (#DIV/0!, #N/A…) par code. */
  errorResults: Record<string, number>;
  unknownFunctions: Record<string, number>;
  /** Fonctions servies par formulajs. */
  fallbackFunctions: Record<string, number>;
  examples: FormulaIssue[];
  ms: number;
}
export interface RecalcResult {
  /** Valeurs calculées des cellules à formule, par feuille (clé r * 16384 + c). */
  values: Map<number, Scalar>[];
  report: RecalcReport;
}

export const KEY_COLS = 16384;
const SHEET_STRIDE = 2 ** 34;
const gk = (s: number, r: number, c: number) => s * SHEET_STRIDE + r * KEY_COLS + c;

type Fallback = Record<string, (...a: unknown[]) => unknown>;

/** Fonctions qui ne peuvent pas être évaluées statiquement (références dynamiques). */
const DYNAMIC = new Set(["INDIRECT", "OFFSET"]);

interface Compiled {
  s: number;
  r: number;
  c: number;
  ast: Node | null;
  deps: number[];
  issue?: string;
}

const norm = (n: string) => n.normalize("NFC").toLowerCase();

export function recalcWorkbook(wb: WorkbookIn, opts: { fallback?: Fallback | null; onProgress?: (done: number, total: number) => void; maxExamples?: number } = {}): RecalcResult {
  const t0 = Date.now();
  const sheetIdx = new Map<string, number>();
  wb.sheets.forEach((s, i) => sheetIdx.set(norm(s.name), i));
  const names = new Map<string, Node | null>();
  for (const [k, f] of Object.entries(wb.names ?? {})) {
    try {
      names.set(k.toUpperCase(), parseFormula(f));
    } catch {
      names.set(k.toUpperCase(), null);
    }
  }
  const values: Map<number, Scalar>[] = wb.sheets.map(() => new Map());
  const report: RecalcReport = { formulas: 0, evaluated: 0, failed: 0, errorResults: {}, unknownFunctions: {}, fallbackFunctions: {}, examples: [], ms: 0 };
  const maxEx = opts.maxExamples ?? 8;
  const issue = (cp: Compiled, reason: string) => {
    report.failed++;
    if (report.examples.length < maxEx) report.examples.push({ sheet: wb.sheets[cp.s]!.name, addr: addrOf(cp.r, cp.c), formula: wb.sheets[cp.s]!.cells.get(cp.r * KEY_COLS + cp.c)?.f ?? "", reason });
  };

  /* ---- compilation + dépendances ---- */
  const compiled = new Map<number, Compiled>();
  const resolveSheet = (name: string | null, cur: number): number => (name === null ? cur : sheetIdx.get(norm(name)) ?? -1);
  for (let s = 0; s < wb.sheets.length; s++) {
    for (const [key, cell] of wb.sheets[s]!.cells) {
      if (!cell.f) continue;
      report.formulas++;
      const r = Math.floor(key / KEY_COLS);
      const c = key % KEY_COLS;
      const cp: Compiled = { s, r, c, ast: null, deps: [] };
      try {
        cp.ast = parseFormula(cell.f);
      } catch (e) {
        cp.issue = e instanceof FormulaParseError ? `analyse impossible : ${e.message}` : "analyse impossible";
      }
      if (cp.ast) {
        const deps = new Set<number>();
        const visit = (n: Node, depth = 0): void => {
          if (depth > 64) return;
          switch (n.k) {
            case "ref": {
              const ts = resolveSheet(n.sheet, s);
              if (ts >= 0) {
                const kk = gk(ts, n.r, n.c);
                if (wb.sheets[ts]!.cells.get(n.r * KEY_COLS + n.c)?.f) deps.add(kk);
              }
              break;
            }
            case "range": {
              const ts = resolveSheet(n.sheet, s);
              if (ts < 0) break;
              const sh = wb.sheets[ts]!;
              const r2 = Math.min(n.r2, sh.maxR);
              const c2 = Math.min(n.c2, sh.maxC);
              for (let rr = n.r1; rr <= r2; rr++)
                for (let cc = n.c1; cc <= c2; cc++) if (sh.cells.get(rr * KEY_COLS + cc)?.f) deps.add(gk(ts, rr, cc));
              break;
            }
            case "name": {
              const nn = names.get(n.name.toUpperCase());
              if (nn) visit(nn, depth + 1);
              break;
            }
            case "un":
              visit(n.a, depth + 1);
              break;
            case "bin":
              visit(n.a, depth + 1);
              visit(n.b, depth + 1);
              break;
            case "call":
              if (DYNAMIC.has(n.name)) cp.issue = `fonction ${n.name} (référence dynamique) non prise en charge`;
              n.args.forEach((a) => visit(a, depth + 1));
              break;
            case "array":
              n.rows.forEach((row) => row.forEach((a) => visit(a, depth + 1)));
              break;
          }
        };
        visit(cp.ast);
        if (deps.has(gk(s, r, c))) cp.issue = "référence circulaire (la cellule se cite elle-même)";
        deps.delete(gk(s, r, c));
        cp.deps = [...deps];
      }
      compiled.set(gk(s, r, c), cp);
    }
  }

  /* ---- ordre topologique (DFS itératif) ---- */
  const order: number[] = [];
  const state = new Map<number, number>(); // 1 = en cours, 2 = fait
  const cyclic = new Set<number>();
  for (const start of compiled.keys()) {
    if (state.get(start) === 2) continue;
    const stack: [number, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const cp = compiled.get(top[0])!;
      if (top[1] < cp.deps.length) {
        const d = cp.deps[top[1]++]!;
        const st = state.get(d);
        if (st === undefined) {
          if (compiled.has(d)) {
            state.set(d, 1);
            stack.push([d, 0]);
          }
        } else if (st === 1) {
          cyclic.add(d);
          cyclic.add(top[0]);
        }
      } else {
        state.set(top[0], 2);
        order.push(top[0]);
        stack.pop();
      }
    }
  }

  /* ---- évaluation ---- */
  const fallback = opts.fallback ?? null;
  let cur = { s: 0, r: 0, c: 0 };
  let unknown: string | null = null;

  const cellValue = (s: number, r: number, c: number): Scalar => {
    const key = r * KEY_COLS + c;
    const cell = wb.sheets[s]!.cells.get(key);
    if (!cell) return null;
    if (cell.f) {
      const v = values[s]!.get(key);
      return v === undefined ? null : v;
    }
    return cell.v;
  };
  const rangeValue = (s: number, n: { r1: number; c1: number; r2: number; c2: number }): Arr => {
    const sh = wb.sheets[s]!;
    const r2 = Math.min(n.r2, Math.max(sh.maxR, n.r1));
    const c2 = Math.min(n.c2, Math.max(sh.maxC, n.c1));
    const rows: Scalar[][] = [];
    for (let rr = n.r1; rr <= r2; rr++) {
      const row: Scalar[] = [];
      for (let cc = n.c1; cc <= c2; cc++) row.push(cellValue(s, rr, cc));
      rows.push(row);
    }
    return arr(rows, n.r1, n.c1);
  };

  const binop = (op: string, a: Scalar, b: Scalar): Scalar => {
    if (a instanceof XlErr) return a;
    if (b instanceof XlErr) return b;
    switch (op) {
      case "&": {
        const x = toStr(a);
        const y = toStr(b);
        return x instanceof XlErr ? x : y instanceof XlErr ? y : x + y;
      }
      case "=":
        return compare(a, b) === 0;
      case "<>":
        return compare(a, b) !== 0;
      case "<":
        return compare(a, b) < 0;
      case ">":
        return compare(a, b) > 0;
      case "<=":
        return compare(a, b) <= 0;
      case ">=":
        return compare(a, b) >= 0;
    }
    const x = toNum(a);
    const y = toNum(b);
    if (x instanceof XlErr) return x;
    if (y instanceof XlErr) return y;
    let r: number;
    switch (op) {
      case "+":
        r = x + y;
        break;
      case "-":
        r = x - y;
        break;
      case "*":
        r = x * y;
        break;
      case "/":
        if (y === 0) return ERR.div0;
        r = x / y;
        break;
      case "^":
        r = Math.pow(x, y);
        break;
      default:
        return ERR.value;
    }
    return Number.isFinite(r) ? r : ERR.num;
  };
  const broadcast = (a: Val, b: Val, f: (x: Scalar, y: Scalar) => Scalar): Val => {
    if (!isArr(a) && !isArr(b)) return f(a, b);
    const A = isArr(a) ? a.rows : [[a]];
    const B = isArr(b) ? b.rows : [[b]];
    const R = Math.max(A.length, B.length);
    const C = Math.max(A[0]!.length, B[0]!.length);
    const pick = (g: Scalar[][], i: number, j: number): Scalar => {
      const row = g.length === 1 ? g[0]! : g[i];
      if (!row) return ERR.na;
      const v = row.length === 1 ? row[0] : row[j];
      return v === undefined ? ERR.na : v;
    };
    const rows: Scalar[][] = [];
    for (let i = 0; i < R; i++) {
      const row: Scalar[] = [];
      for (let j = 0; j < C; j++) row.push(f(pick(A, i, j), pick(B, i, j)));
      rows.push(row);
    }
    const src = isArr(a) ? a : (b as Arr);
    return arr(rows, src.r0, src.c0);
  };

  const ctx: FnCtx = {
    get r() {
      return cur.r;
    },
    get c() {
      return cur.c;
    },
    evalNode: (n) => ev(n),
    refPos(n) {
      if (n.k === "ref") return { r: n.r, c: n.c, rows: 1, cols: 1 };
      if (n.k === "range") return { r: n.r1, c: n.c1, rows: n.r2 - n.r1 + 1, cols: n.c2 - n.c1 + 1 };
      return null;
    },
  };

  const callFallback = (name: string, args: Val[]): Val | undefined => {
    const fn = fallback?.[name] ?? fallback?.[name.replace(/\./g, "_")];
    if (typeof fn !== "function") return undefined;
    report.fallbackFunctions[name] = (report.fallbackFunctions[name] ?? 0) + 1;
    const conv = (v: Val): unknown => {
      if (isArr(v)) return v.rows.map((r) => r.map((x) => (x instanceof XlErr ? errorObj(x.code) : x)));
      if (v instanceof XlErr) return errorObj(v.code);
      return v;
    };
    try {
      const out = fn(...args.map(conv));
      return fromJs(out);
    } catch {
      return ERR.value;
    }
  };

  function ev(n: Node): Val {
    switch (n.k) {
      case "num":
        return n.v;
      case "str":
        return n.v;
      case "bool":
        return n.v;
      case "err":
        return new XlErr(n.v);
      case "missing":
        return null;
      case "ref": {
        const s = n.sheet === null ? cur.s : sheetIdx.get(norm(n.sheet)) ?? -1;
        if (s < 0) return ERR.ref;
        return cellValue(s, n.r, n.c);
      }
      case "range": {
        const s = n.sheet === null ? cur.s : sheetIdx.get(norm(n.sheet)) ?? -1;
        if (s < 0) return ERR.ref;
        return rangeValue(s, n);
      }
      case "name": {
        const nn = names.get(n.name.toUpperCase());
        if (!nn) {
          unknown = unknown ?? `nom inconnu « ${n.name} »`;
          return ERR.name;
        }
        return ev(nn);
      }
      case "array":
        return arr(n.rows.map((row) => row.map((x) => {
          const v = ev(x);
          return isArr(v) ? implicit(v) : v;
        })));
      case "un": {
        const v = ev(n.a);
        const f = (x: Scalar): Scalar => {
          const k = toNum(x);
          if (k instanceof XlErr) return k;
          return n.op === "-" ? -k : n.op === "%" ? k / 100 : k;
        };
        if (isArr(v)) return arr(v.rows.map((r) => r.map(f)), v.r0, v.c0);
        return f(v);
      }
      case "bin":
        return broadcast(ev(n.a), ev(n.b), (x, y) => binop(n.op, x, y));
      case "call": {
        const lazy = LAZY[n.name];
        if (lazy) return lazy(n.args, ctx);
        const eager = EAGER[n.name];
        const args = n.args.map((a) => ev(a));
        if (eager) return eager(args, ctx);
        const fb = callFallback(n.name, args);
        if (fb !== undefined) return fb;
        unknown = unknown ?? `fonction inconnue ${n.name}`;
        report.unknownFunctions[n.name] = (report.unknownFunctions[n.name] ?? 0) + 1;
        return ERR.name;
      }
    }
  }

  const total = order.length;
  let done = 0;
  for (const key of order) {
    const cp = compiled.get(key)!;
    cur = { s: cp.s, r: cp.r, c: cp.c };
    unknown = null;
    let v: Scalar;
    if (!cp.ast) {
      v = ERR.value;
      issue(cp, cp.issue ?? "analyse impossible");
    } else if (cp.issue) {
      v = ERR.value;
      issue(cp, cp.issue);
    } else if (cyclic.has(key)) {
      v = ERR.cycle;
      issue(cp, "référence circulaire");
    } else {
      let out: Val;
      try {
        out = ev(cp.ast);
      } catch (e) {
        out = ERR.value;
        unknown = `erreur d'évaluation : ${e instanceof Error ? e.message : String(e)}`;
      }
      v = isArr(out) ? implicit(out, ctx) : out;
      if (unknown) issue(cp, unknown);
      else {
        report.evaluated++;
        if (v instanceof XlErr) report.errorResults[v.code] = (report.errorResults[v.code] ?? 0) + 1;
      }
    }
    // Une formule qui renvoie une cellule vide vaut 0 (comme Excel)
    values[cp.s]!.set(cp.r * KEY_COLS + cp.c, v === null ? 0 : v);
    done++;
    if (opts.onProgress && (done % 2000 === 0 || done === total)) opts.onProgress(done, total);
  }
  report.ms = Date.now() - t0;
  return { values, report };
}

function errorObj(code: string): Error {
  const e = new Error(code);
  e.name = code;
  return e;
}
function fromJs(v: unknown): Val {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : ERR.num;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return (v.getTime() - Date.UTC(1899, 11, 30) - v.getTimezoneOffset() * 60000) / 86400000;
  if (v instanceof Error) return new XlErr(/^#/.test(v.message) ? v.message : "#VALUE!");
  if (Array.isArray(v)) {
    const rows = (Array.isArray(v[0]) ? v : [v]) as unknown[][];
    return arr(rows.map((r) => r.map((x) => {
      const s = fromJs(x);
      return isArr(s) ? null : s;
    })));
  }
  return ERR.value;
}
