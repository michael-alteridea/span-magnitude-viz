/**
 * Bibliothèque de fonctions du moteur (code maison, MIT) : logique, maths, statistiques, recherche, dates, texte, infos.
 * Les fonctions absentes passent par @formulajs/formulajs (MIT) quand elle les connaît (voir engine.ts).
 */
import type { Node } from "./parser";
import { ERR, XlErr, arr, compare, flat, isArr, isErr, serialFromYmd, toBool, toNum, toStr, ymdFromSerial, type Arr, type Scalar, type Val } from "./values";

export interface FnCtx {
  evalNode(n: Node): Val;
  /** Cellule en cours (indices 0). */
  r: number;
  c: number;
  /** Ligne / colonne d'un nœud référence (ROW, COLUMN). */
  refPos(n: Node): { r: number; c: number; rows: number; cols: number } | null;
}
export type EagerFn = (args: Val[], ctx: FnCtx) => Val;
export type LazyFn = (args: Node[], ctx: FnCtx) => Val;

const firstErr = (vals: Scalar[]): XlErr | null => {
  for (const v of vals) if (v instanceof XlErr) return v;
  return null;
};

/** Nombres d'une liste d'arguments à la manière de SUM : plages → nombres seulement ; scalaires → convertis. */
function nums(args: Val[], opts: { countText?: boolean } = {}): number[] | XlErr {
  const out: number[] = [];
  for (const a of args) {
    if (isArr(a)) {
      for (const row of a.rows)
        for (const x of row) {
          if (typeof x === "number") out.push(x);
          else if (x instanceof XlErr) return x;
          else if (opts.countText && (typeof x === "string" || typeof x === "boolean")) out.push(typeof x === "boolean" ? (x ? 1 : 0) : 0);
        }
    } else {
      if (a === null) continue;
      const n = toNum(a);
      if (n instanceof XlErr) return n;
      out.push(n);
    }
  }
  return out;
}

function scalarArg(v: Val | undefined, ctx?: FnCtx): Scalar {
  if (v === undefined) return null;
  if (!isArr(v)) return v;
  return implicit(v, ctx);
}
/** Intersection implicite (plage dans un contexte scalaire). */
export function implicit(v: Arr, ctx?: FnCtx): Scalar {
  const rows = v.rows;
  if (rows.length === 1 && rows[0]!.length === 1) return rows[0]![0]!;
  if (ctx && v.r0 !== undefined && v.c0 !== undefined) {
    if (rows[0]!.length === 1 && ctx.r >= v.r0 && ctx.r < v.r0 + rows.length) return rows[ctx.r - v.r0]![0]!;
    if (rows.length === 1 && ctx.c >= v.c0 && ctx.c < v.c0 + rows[0]!.length) return rows[0]![ctx.c - v.c0]!;
  }
  return ERR.value;
}
function numArg(v: Val | undefined, ctx: FnCtx, dflt?: number): number | XlErr {
  if (v === undefined || (v === null && dflt !== undefined)) return dflt ?? 0;
  return toNum(scalarArg(v, ctx));
}

/** Applique f élément par élément quand l'argument est un tableau (ABS(plage) dans SUMPRODUCT). */
function lift1(v: Val, f: (x: Scalar) => Scalar): Val {
  if (!isArr(v)) return f(v);
  return arr(v.rows.map((r) => r.map(f)), v.r0, v.c0);
}
function mathFn(f: (x: number) => number | XlErr): EagerFn {
  return (args) =>
    lift1(args[0] ?? null, (x) => {
      const n = toNum(x);
      if (n instanceof XlErr) return n;
      const r = f(n);
      return typeof r === "number" && !Number.isFinite(r) ? ERR.num : r;
    });
}

function roundTo(n: number, d: number, mode: "round" | "up" | "down"): number {
  const f = Math.pow(10, d);
  const x = Math.abs(n) * f;
  // Correction des erreurs binaires (2,675 → 2,68 comme Excel)
  const eps = Number((x).toPrecision(15));
  let r = mode === "round" ? Math.round(eps) : mode === "up" ? Math.ceil(eps) : Math.floor(eps);
  if (mode === "round" && eps - Math.floor(eps) === 0.5) r = Math.floor(eps) + 1;
  return (Math.sign(n) * r) / f;
}

/* ---- critères (COUNTIF, SUMIF…) ---- */
function wildcardRe(p: string): RegExp {
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === "~" && i + 1 < p.length) re += p[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}
export function criterion(c: Scalar): (v: Scalar) => boolean {
  if (typeof c === "number" || typeof c === "boolean") return (v) => v !== null && compare(v, c) === 0 && typeof v === typeof c;
  if (c === null) return (v) => v === null || v === "";
  if (c instanceof XlErr) return (v) => v instanceof XlErr && v.code === c.code;
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(c)!;
  const op = m[1] ?? "=";
  const raw = m[2]!;
  const n = raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const target: Scalar = n !== null ? n : raw.toUpperCase() === "TRUE" ? true : raw.toUpperCase() === "FALSE" ? false : raw;
  if (op === "=" || op === "<>") {
    let test: (v: Scalar) => boolean;
    if (raw === "") test = (v) => v === null || v === "";
    else if (typeof target === "string" && /[*?]/.test(target)) {
      const re = wildcardRe(target);
      test = (v) => typeof v === "string" && re.test(v);
    } else if (typeof target === "number") test = (v) => (typeof v === "number" && v === target) || (typeof v === "string" && v.trim() !== "" && Number(v) === target);
    else test = (v) => v !== null && typeof v === typeof target && compare(v, target) === 0;
    return op === "=" ? test : (v) => !test(v);
  }
  return (v) => {
    if (v === null || v instanceof XlErr) return false;
    if (typeof target === "number" && typeof v !== "number") return false;
    if (typeof target === "string" && typeof v !== "string") return false;
    const k = compare(v, target);
    return op === "<" ? k < 0 : op === ">" ? k > 0 : op === "<=" ? k <= 0 : k >= 0;
  };
}
function asGrid(v: Val): Scalar[][] {
  return isArr(v) ? v.rows : [[v]];
}
/** Indices (i, j) satisfaisant tous les couples (plage, critère). */
function ifsMask(pairs: [Val, Val][], ctx: FnCtx): boolean[][] | XlErr {
  const g0 = asGrid(pairs[0]![0]);
  const mask = g0.map((r) => r.map(() => true));
  for (const [rv, cv] of pairs) {
    const g = asGrid(rv);
    if (g.length !== g0.length || g[0]!.length !== g0[0]!.length) return ERR.value;
    const test = criterion(scalarArg(cv, ctx));
    g.forEach((row, i) => row.forEach((x, j) => (mask[i]![j] = mask[i]![j]! && test(x))));
  }
  return mask;
}

/* ---- recherche ---- */
function matchIndex(look: Scalar, vec: Scalar[], type: number): number | XlErr {
  if (look instanceof XlErr) return look;
  if (type === 0) {
    if (typeof look === "string" && /[*?~]/.test(look)) {
      const re = wildcardRe(look);
      const i = vec.findIndex((v) => typeof v === "string" && re.test(v));
      return i < 0 ? ERR.na : i;
    }
    const i = vec.findIndex((v) => v !== null && !(v instanceof XlErr) && typeof v === typeof look && compare(v, look) === 0);
    return i < 0 ? ERR.na : i;
  }
  let found = -1;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i]!;
    if (v === null || v instanceof XlErr || typeof v !== typeof look) continue;
    const k = compare(v, look);
    if (type > 0) {
      if (k <= 0) found = i;
      else break;
    } else {
      if (k >= 0) found = i;
      else break;
    }
  }
  return found < 0 ? ERR.na : found;
}
function vector(v: Val): Scalar[] | null {
  if (!isArr(v)) return [v];
  if (v.rows.length === 1) return v.rows[0]!;
  if (v.rows[0]!.length === 1) return v.rows.map((r) => r[0]!);
  return null;
}

/* ---- statistiques ---- */
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

function aggregate(fn: (xs: number[]) => number | XlErr, opts: { countText?: boolean; empty?: number | XlErr } = {}): EagerFn {
  return (args) => {
    const xs = nums(args, opts);
    if (xs instanceof XlErr) return xs;
    if (!xs.length && opts.empty !== undefined) return opts.empty;
    return fn(xs);
  };
}

export const LAZY: Record<string, LazyFn> = {
  IF(args, ctx) {
    const c = scalarArg(ctx.evalNode(args[0] ?? { k: "missing" }), ctx);
    const b = toBool(c);
    if (b instanceof XlErr) return b;
    const pick = b ? args[1] : args[2];
    if (!pick || pick.k === "missing") return b ? (args.length > 1 ? 0 : true) : args.length > 2 ? 0 : false;
    return ctx.evalNode(pick);
  },
  IFERROR(args, ctx) {
    const v = ctx.evalNode(args[0]!);
    const s = isArr(v) ? implicit(v, ctx) : v;
    if (s instanceof XlErr) return args[1] && args[1].k !== "missing" ? ctx.evalNode(args[1]) : 0;
    return v;
  },
  IFNA(args, ctx) {
    const v = ctx.evalNode(args[0]!);
    const s = isArr(v) ? implicit(v, ctx) : v;
    if (s instanceof XlErr && s.code === "#N/A") return args[1] ? ctx.evalNode(args[1]) : 0;
    return v;
  },
  IFS(args, ctx) {
    for (let i = 0; i + 1 < args.length; i += 2) {
      const b = toBool(scalarArg(ctx.evalNode(args[i]!), ctx));
      if (b instanceof XlErr) return b;
      if (b) return ctx.evalNode(args[i + 1]!);
    }
    return ERR.na;
  },
  SWITCH(args, ctx) {
    const v = scalarArg(ctx.evalNode(args[0]!), ctx);
    if (v instanceof XlErr) return v;
    let i = 1;
    for (; i + 1 < args.length; i += 2) {
      const c = scalarArg(ctx.evalNode(args[i]!), ctx);
      if (c !== null && compare(v, c) === 0 && typeof v === typeof c) return ctx.evalNode(args[i + 1]!);
    }
    return i < args.length ? ctx.evalNode(args[i]!) : ERR.na;
  },
  CHOOSE(args, ctx) {
    const n = toNum(scalarArg(ctx.evalNode(args[0]!), ctx));
    if (n instanceof XlErr) return n;
    const k = Math.floor(n);
    if (k < 1 || k >= args.length) return ERR.value;
    return ctx.evalNode(args[k]!);
  },
  ROW(args, ctx) {
    if (!args.length || args[0]!.k === "missing") return ctx.r + 1;
    const p = ctx.refPos(args[0]!);
    return p ? p.r + 1 : ERR.value;
  },
  COLUMN(args, ctx) {
    if (!args.length || args[0]!.k === "missing") return ctx.c + 1;
    const p = ctx.refPos(args[0]!);
    return p ? p.c + 1 : ERR.value;
  },
  ISREF(args, ctx) {
    return !!args[0] && !!ctx.refPos(args[0]);
  },
};

export const EAGER: Record<string, EagerFn> = {
  /* logique */
  AND(args) {
    let any = false;
    for (const x of args.flatMap(flat)) {
      if (x === null || typeof x === "string") continue;
      const b = toBool(x);
      if (b instanceof XlErr) return b;
      any = true;
      if (!b) return false;
    }
    return any ? true : ERR.value;
  },
  OR(args) {
    let any = false;
    let res = false;
    for (const x of args.flatMap(flat)) {
      if (x === null || typeof x === "string") continue;
      const b = toBool(x);
      if (b instanceof XlErr) return b;
      any = true;
      if (b) res = true;
    }
    return any ? res : ERR.value;
  },
  XOR(args) {
    let n = 0;
    for (const x of args.flatMap(flat)) {
      if (x === null || typeof x === "string") continue;
      const b = toBool(x);
      if (b instanceof XlErr) return b;
      if (b) n++;
    }
    return n % 2 === 1;
  },
  NOT(args, ctx) {
    const b = toBool(scalarArg(args[0], ctx));
    return b instanceof XlErr ? b : !b;
  },
  TRUE: () => true,
  FALSE: () => false,
  NA: () => ERR.na,

  /* maths */
  SUM: aggregate(sum),
  PRODUCT: aggregate((xs) => xs.reduce((p, x) => p * x, 1), { empty: 0 }),
  MIN: aggregate((xs) => (xs.length ? Math.min(...xs) : 0)),
  MAX: aggregate((xs) => (xs.length ? Math.max(...xs) : 0)),
  AVERAGE: aggregate((xs) => (xs.length ? sum(xs) / xs.length : ERR.div0)),
  MEDIAN: aggregate((xs) => {
    if (!xs.length) return ERR.num;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  }),
  COUNT(args) {
    let n = 0;
    for (const a of args) {
      if (isArr(a)) n += flat(a).filter((x) => typeof x === "number").length;
      else if (typeof a === "number" || (typeof a === "string" && !(toNum(a) instanceof XlErr)) || typeof a === "boolean") n++;
    }
    return n;
  },
  COUNTA(args) {
    let n = 0;
    for (const a of args) for (const x of flat(a)) if (x !== null && x !== "") n++;
    return n;
  },
  COUNTBLANK(args) {
    return flat(args[0] ?? null).filter((x) => x === null || x === "").length;
  },
  ABS: mathFn(Math.abs),
  INT: mathFn(Math.floor),
  SIGN: mathFn(Math.sign),
  SQRT: mathFn((x) => (x < 0 ? ERR.num : Math.sqrt(x))),
  EXP: mathFn(Math.exp),
  LN: mathFn((x) => (x <= 0 ? ERR.num : Math.log(x))),
  LOG10: mathFn((x) => (x <= 0 ? ERR.num : Math.log10(x))),
  PI: () => Math.PI,
  LOG(args, ctx) {
    const x = numArg(args[0], ctx);
    const b = numArg(args[1], ctx, 10);
    if (x instanceof XlErr) return x;
    if (b instanceof XlErr) return b;
    return x <= 0 || b <= 0 || b === 1 ? ERR.num : Math.log(x) / Math.log(b);
  },
  POWER(args, ctx) {
    const x = numArg(args[0], ctx);
    const y = numArg(args[1], ctx);
    if (x instanceof XlErr) return x;
    if (y instanceof XlErr) return y;
    const r = Math.pow(x, y);
    return Number.isFinite(r) ? r : ERR.num;
  },
  MOD(args, ctx) {
    const x = numArg(args[0], ctx);
    const y = numArg(args[1], ctx);
    if (x instanceof XlErr) return x;
    if (y instanceof XlErr) return y;
    if (y === 0) return ERR.div0;
    return x - y * Math.floor(x / y);
  },
  ROUND(args, ctx) {
    return roundFn(args, ctx, "round");
  },
  ROUNDUP(args, ctx) {
    return roundFn(args, ctx, "up");
  },
  ROUNDDOWN(args, ctx) {
    return roundFn(args, ctx, "down");
  },
  TRUNC(args, ctx) {
    return roundFn(args, ctx, "down");
  },
  MROUND(args, ctx) {
    const x = numArg(args[0], ctx);
    const m = numArg(args[1], ctx);
    if (x instanceof XlErr) return x;
    if (m instanceof XlErr) return m;
    if (m === 0) return 0;
    if (Math.sign(x) * Math.sign(m) < 0) return ERR.num;
    return roundTo(x / m, 0, "round") * m;
  },
  CEILING(args, ctx) {
    const x = numArg(args[0], ctx);
    const s = numArg(args[1], ctx, 1);
    if (x instanceof XlErr) return x;
    if (s instanceof XlErr) return s;
    if (s === 0) return 0;
    return Math.ceil(Number((x / s).toPrecision(15))) * s;
  },
  "CEILING.MATH"(args, ctx) {
    return EAGER.CEILING!(args, ctx);
  },
  FLOOR(args, ctx) {
    const x = numArg(args[0], ctx);
    const s = numArg(args[1], ctx, 1);
    if (x instanceof XlErr) return x;
    if (s instanceof XlErr) return s;
    if (s === 0) return ERR.div0;
    return Math.floor(Number((x / s).toPrecision(15))) * s;
  },
  "FLOOR.MATH"(args, ctx) {
    return EAGER.FLOOR!(args, ctx);
  },
  SUMPRODUCT(args) {
    const grids = args.map(asGrid);
    const g0 = grids[0];
    if (!g0) return ERR.value;
    let total = 0;
    for (let i = 0; i < g0.length; i++)
      for (let j = 0; j < g0[0]!.length; j++) {
        let p = 1;
        for (const g of grids) {
          const x = g[i]?.[j];
          if (x === undefined) return ERR.value;
          if (x instanceof XlErr) return x;
          p *= typeof x === "number" ? x : 0;
        }
        total += p;
      }
    return total;
  },
  SUMIF(args, ctx) {
    const mask = ifsMask([[args[0]!, args[1]!]], ctx);
    if (mask instanceof XlErr) return mask;
    const g = asGrid(args[2] ?? args[0]!);
    let t = 0;
    mask.forEach((row, i) => row.forEach((ok, j) => ok && typeof g[i]?.[j] === "number" && (t += g[i]![j] as number)));
    return t;
  },
  SUMIFS(args, ctx) {
    const pairs: [Val, Val][] = [];
    for (let i = 1; i + 1 < args.length; i += 2) pairs.push([args[i]!, args[i + 1]!]);
    const mask = ifsMask(pairs, ctx);
    if (mask instanceof XlErr) return mask;
    const g = asGrid(args[0]!);
    let t = 0;
    mask.forEach((row, i) => row.forEach((ok, j) => ok && typeof g[i]?.[j] === "number" && (t += g[i]![j] as number)));
    return t;
  },
  COUNTIF(args, ctx) {
    const mask = ifsMask([[args[0]!, args[1]!]], ctx);
    if (mask instanceof XlErr) return mask;
    return mask.flat().filter(Boolean).length;
  },
  COUNTIFS(args, ctx) {
    const pairs: [Val, Val][] = [];
    for (let i = 0; i + 1 < args.length; i += 2) pairs.push([args[i]!, args[i + 1]!]);
    const mask = ifsMask(pairs, ctx);
    if (mask instanceof XlErr) return mask;
    return mask.flat().filter(Boolean).length;
  },
  AVERAGEIF(args, ctx) {
    const mask = ifsMask([[args[0]!, args[1]!]], ctx);
    if (mask instanceof XlErr) return mask;
    const g = asGrid(args[2] ?? args[0]!);
    const xs: number[] = [];
    mask.forEach((row, i) => row.forEach((ok, j) => ok && typeof g[i]?.[j] === "number" && xs.push(g[i]![j] as number)));
    return xs.length ? sum(xs) / xs.length : ERR.div0;
  },
  AVERAGEIFS(args, ctx) {
    const pairs: [Val, Val][] = [];
    for (let i = 1; i + 1 < args.length; i += 2) pairs.push([args[i]!, args[i + 1]!]);
    const mask = ifsMask(pairs, ctx);
    if (mask instanceof XlErr) return mask;
    const g = asGrid(args[0]!);
    const xs: number[] = [];
    mask.forEach((row, i) => row.forEach((ok, j) => ok && typeof g[i]?.[j] === "number" && xs.push(g[i]![j] as number)));
    return xs.length ? sum(xs) / xs.length : ERR.div0;
  },
  MAXIFS(args, ctx) {
    return extIfs(args, ctx, (xs) => (xs.length ? Math.max(...xs) : 0));
  },
  MINIFS(args, ctx) {
    return extIfs(args, ctx, (xs) => (xs.length ? Math.min(...xs) : 0));
  },
  LARGE(args, ctx) {
    const xs = nums([args[0] ?? null]);
    const k = numArg(args[1], ctx);
    if (xs instanceof XlErr) return xs;
    if (k instanceof XlErr) return k;
    const s = [...xs].sort((a, b) => b - a);
    return k >= 1 && k <= s.length ? s[Math.ceil(k) - 1]! : ERR.num;
  },
  SMALL(args, ctx) {
    const xs = nums([args[0] ?? null]);
    const k = numArg(args[1], ctx);
    if (xs instanceof XlErr) return xs;
    if (k instanceof XlErr) return k;
    const s = [...xs].sort((a, b) => a - b);
    return k >= 1 && k <= s.length ? s[Math.ceil(k) - 1]! : ERR.num;
  },

  /* recherche */
  INDEX(args, ctx) {
    const a = args[0] ?? null;
    const g = asGrid(a);
    const rn = numArg(args[1], ctx, 0);
    const cn = numArg(args[2], ctx, 0);
    if (rn instanceof XlErr) return rn;
    if (cn instanceof XlErr) return cn;
    let r = Math.floor(rn);
    let c = Math.floor(cn);
    // Vecteur ligne avec un seul indice : l'indice porte sur la colonne
    if (g.length === 1 && args.length === 2) {
      c = r;
      r = 1;
    }
    if (r < 0 || c < 0 || r > g.length || c > (g[0]?.length ?? 0)) return ERR.ref;
    if (r === 0 && c === 0) return a;
    if (r === 0) return arr(g.map((row) => [row[c - 1]!]));
    if (c === 0) return g[0]!.length === 1 ? g[r - 1]![0]! : arr([g[r - 1]!]);
    return g[r - 1]![c - 1]!;
  },
  MATCH(args, ctx) {
    const look = scalarArg(args[0], ctx);
    const vec = vector(args[1] ?? null);
    if (!vec) return ERR.na;
    const t = numArg(args[2], ctx, 1);
    if (t instanceof XlErr) return t;
    const i = matchIndex(look, vec, t > 0 ? 1 : t < 0 ? -1 : 0);
    return i instanceof XlErr ? i : i + 1;
  },
  VLOOKUP(args, ctx) {
    const look = scalarArg(args[0], ctx);
    const g = asGrid(args[1] ?? null);
    const col = numArg(args[2], ctx);
    if (col instanceof XlErr) return col;
    const approx = args[3] === undefined ? true : toBool(scalarArg(args[3], ctx));
    if (approx instanceof XlErr) return approx;
    const i = matchIndex(look, g.map((r) => r[0]!), approx ? 1 : 0);
    if (i instanceof XlErr) return i;
    const v = g[i]![Math.floor(col) - 1];
    return v === undefined ? ERR.ref : v;
  },
  HLOOKUP(args, ctx) {
    const look = scalarArg(args[0], ctx);
    const g = asGrid(args[1] ?? null);
    const row = numArg(args[2], ctx);
    if (row instanceof XlErr) return row;
    const approx = args[3] === undefined ? true : toBool(scalarArg(args[3], ctx));
    if (approx instanceof XlErr) return approx;
    const i = matchIndex(look, g[0]!, approx ? 1 : 0);
    if (i instanceof XlErr) return i;
    const v = g[Math.floor(row) - 1]?.[i];
    return v === undefined ? ERR.ref : v;
  },
  XLOOKUP(args, ctx) {
    const look = scalarArg(args[0], ctx);
    const lv = vector(args[1] ?? null);
    const rv = asGrid(args[2] ?? null);
    if (!lv) return ERR.value;
    const i = matchIndex(look, lv, 0);
    if (i instanceof XlErr) return args[3] !== undefined && args[3] !== null ? args[3] : i;
    if (rv.length === 1) return rv[0]![i] ?? ERR.ref;
    return rv[i]?.length === 1 ? rv[i]![0]! : arr([rv[i] ?? []]);
  },
  ROWS(args) {
    return asGrid(args[0] ?? null).length;
  },
  COLUMNS(args) {
    return asGrid(args[0] ?? null)[0]?.length ?? 0;
  },

  /* dates (numéros de série, système 1900) */
  DATE(args, ctx) {
    const y = numArg(args[0], ctx);
    const m = numArg(args[1], ctx);
    const d = numArg(args[2], ctx);
    if (y instanceof XlErr) return y;
    if (m instanceof XlErr) return m;
    if (d instanceof XlErr) return d;
    let yy = Math.floor(y);
    if (yy < 1900) yy += 1900;
    return serialFromYmd(yy, Math.floor(m) - 1, Math.floor(d));
  },
  EOMONTH(args, ctx) {
    const s = numArg(args[0], ctx);
    const k = numArg(args[1], ctx);
    if (s instanceof XlErr) return s;
    if (k instanceof XlErr) return k;
    const { y, m } = ymdFromSerial(s);
    return serialFromYmd(y, m + Math.trunc(k) + 1, 0);
  },
  EDATE(args, ctx) {
    const s = numArg(args[0], ctx);
    const k = numArg(args[1], ctx);
    if (s instanceof XlErr) return s;
    if (k instanceof XlErr) return k;
    const { y, m, d } = ymdFromSerial(s);
    const last = ymdFromSerial(serialFromYmd(y, m + Math.trunc(k) + 1, 0)).d;
    return serialFromYmd(y, m + Math.trunc(k), Math.min(d, last));
  },
  YEAR: datepart((p) => p.y),
  MONTH: datepart((p) => p.m + 1),
  DAY: datepart((p) => p.d),
  WEEKDAY(args, ctx) {
    const s = numArg(args[0], ctx);
    if (s instanceof XlErr) return s;
    const t = numArg(args[1], ctx, 1);
    if (t instanceof XlErr) return t;
    const dow = (Math.floor(s) + 6) % 7; // 0 = dimanche
    return t === 2 ? ((dow + 6) % 7) + 1 : t === 3 ? (dow + 6) % 7 : dow + 1;
  },
  DAYS(args, ctx) {
    const a = numArg(args[0], ctx);
    const b = numArg(args[1], ctx);
    if (a instanceof XlErr) return a;
    if (b instanceof XlErr) return b;
    return Math.floor(a) - Math.floor(b);
  },
  TODAY() {
    const d = new Date();
    return serialFromYmd(d.getFullYear(), d.getMonth(), d.getDate());
  },

  /* texte */
  CONCATENATE(args) {
    let s = "";
    for (const a of args) {
      const t = toStr(isArr(a) ? implicit(a) : a);
      if (t instanceof XlErr) return t;
      s += t;
    }
    return s;
  },
  CONCAT(args) {
    let s = "";
    for (const x of args.flatMap(flat)) {
      const t = toStr(x);
      if (t instanceof XlErr) return t;
      s += t;
    }
    return s;
  },
  TEXTJOIN(args, ctx) {
    const sep = toStr(scalarArg(args[0], ctx));
    const skip = toBool(scalarArg(args[1], ctx));
    if (sep instanceof XlErr) return sep;
    if (skip instanceof XlErr) return skip;
    const parts: string[] = [];
    for (const x of args.slice(2).flatMap(flat)) {
      const t = toStr(x);
      if (t instanceof XlErr) return t;
      if (skip && t === "") continue;
      parts.push(t);
    }
    return parts.join(sep);
  },
  LEN: textFn((s) => s.length),
  UPPER: textFn((s) => s.toUpperCase()),
  LOWER: textFn((s) => s.toLowerCase()),
  TRIM: textFn((s) => s.replace(/ +/g, " ").trim()),
  LEFT(args, ctx) {
    const s = toStr(scalarArg(args[0], ctx));
    const n = numArg(args[1], ctx, 1);
    if (s instanceof XlErr) return s;
    if (n instanceof XlErr) return n;
    return s.slice(0, Math.max(0, Math.floor(n)));
  },
  RIGHT(args, ctx) {
    const s = toStr(scalarArg(args[0], ctx));
    const n = numArg(args[1], ctx, 1);
    if (s instanceof XlErr) return s;
    if (n instanceof XlErr) return n;
    const k = Math.max(0, Math.floor(n));
    return k === 0 ? "" : s.slice(-k);
  },
  MID(args, ctx) {
    const s = toStr(scalarArg(args[0], ctx));
    const a = numArg(args[1], ctx);
    const n = numArg(args[2], ctx);
    if (s instanceof XlErr) return s;
    if (a instanceof XlErr) return a;
    if (n instanceof XlErr) return n;
    if (a < 1 || n < 0) return ERR.value;
    return s.substr(Math.floor(a) - 1, Math.floor(n));
  },
  SUBSTITUTE(args, ctx) {
    const s = toStr(scalarArg(args[0], ctx));
    const a = toStr(scalarArg(args[1], ctx));
    const b = toStr(scalarArg(args[2], ctx));
    if (s instanceof XlErr) return s;
    if (a instanceof XlErr) return a;
    if (b instanceof XlErr) return b;
    if (!a) return s;
    if (args[3] === undefined) return s.split(a).join(b);
    const k = numArg(args[3], ctx);
    if (k instanceof XlErr) return k;
    let idx = -1;
    for (let i = 0; i < k; i++) {
      idx = s.indexOf(a, idx + 1);
      if (idx < 0) return s;
    }
    return s.slice(0, idx) + b + s.slice(idx + a.length);
  },
  FIND(args, ctx) {
    return findFn(args, ctx, false);
  },
  SEARCH(args, ctx) {
    return findFn(args, ctx, true);
  },
  REPT(args, ctx) {
    const s = toStr(scalarArg(args[0], ctx));
    const n = numArg(args[1], ctx);
    if (s instanceof XlErr) return s;
    if (n instanceof XlErr) return n;
    return n < 0 ? ERR.value : s.repeat(Math.floor(n));
  },
  VALUE(args, ctx) {
    const v = scalarArg(args[0], ctx);
    if (typeof v === "number") return v;
    if (typeof v !== "string") return ERR.value;
    const n = toNum(v.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
    return n;
  },
  TEXT(args, ctx) {
    const v = scalarArg(args[0], ctx);
    const f = toStr(scalarArg(args[1], ctx));
    if (v instanceof XlErr) return v;
    if (f instanceof XlErr) return f;
    if (typeof v !== "number") return toStr(v);
    const m = /^[#,0]*\.?(0*)(%?)$/.exec(f.replace(/\s/g, ""));
    if (m) {
      const pct = m[2] === "%";
      const x = pct ? v * 100 : v;
      const d = m[1]!.length;
      const thousands = f.includes(",");
      const s = thousands ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : x.toFixed(d);
      return s + (pct ? "%" : "");
    }
    return toStr(v);
  },
  N(args, ctx) {
    const v = scalarArg(args[0], ctx);
    return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : v instanceof XlErr ? v : 0;
  },

  /* informations */
  ISBLANK: (args, ctx) => scalarArg(args[0], ctx) === null,
  ISNUMBER: (args, ctx) => typeof scalarArg(args[0], ctx) === "number",
  ISTEXT: (args, ctx) => typeof scalarArg(args[0], ctx) === "string",
  ISLOGICAL: (args, ctx) => typeof scalarArg(args[0], ctx) === "boolean",
  ISERROR: (args, ctx) => isErr(scalarArg(args[0], ctx)),
  ISERR: (args, ctx) => {
    const v = scalarArg(args[0], ctx);
    return isErr(v) && v.code !== "#N/A";
  },
  ISNA: (args, ctx) => {
    const v = scalarArg(args[0], ctx);
    return isErr(v) && v.code === "#N/A";
  },
  ISEVEN: (args, ctx) => {
    const n = numArg(args[0], ctx);
    return n instanceof XlErr ? n : Math.floor(Math.abs(n)) % 2 === 0;
  },
  ISODD: (args, ctx) => {
    const n = numArg(args[0], ctx);
    return n instanceof XlErr ? n : Math.floor(Math.abs(n)) % 2 === 1;
  },
};

function roundFn(args: Val[], ctx: FnCtx, mode: "round" | "up" | "down"): Val {
  const d = numArg(args[1], ctx, 0);
  if (d instanceof XlErr) return d;
  return lift1(args[0] ?? null, (x) => {
    const n = toNum(x);
    if (n instanceof XlErr) return n;
    return roundTo(n, Math.trunc(d), mode);
  });
}
function extIfs(args: Val[], ctx: FnCtx, f: (xs: number[]) => number): Val {
  const pairs: [Val, Val][] = [];
  for (let i = 1; i + 1 < args.length; i += 2) pairs.push([args[i]!, args[i + 1]!]);
  const mask = ifsMask(pairs, ctx);
  if (mask instanceof XlErr) return mask;
  const g = asGrid(args[0]!);
  const xs: number[] = [];
  mask.forEach((row, i) => row.forEach((ok, j) => ok && typeof g[i]?.[j] === "number" && xs.push(g[i]![j] as number)));
  return f(xs);
}
function dateparts(v: Val | undefined, ctx: FnCtx) {
  const s = numArg(v, ctx);
  return s instanceof XlErr ? s : ymdFromSerial(s);
}
function datepart(f: (p: { y: number; m: number; d: number }) => number): EagerFn {
  return (args, ctx) => {
    const p = dateparts(args[0], ctx);
    return p instanceof XlErr ? p : f(p);
  };
}
function textFn(f: (s: string) => Scalar): EagerFn {
  return (args, ctx) => {
    const s = toStr(scalarArg(args[0], ctx));
    return s instanceof XlErr ? s : f(s);
  };
}
function findFn(args: Val[], ctx: FnCtx, ci: boolean): Val {
  const needle = toStr(scalarArg(args[0], ctx));
  const hay = toStr(scalarArg(args[1], ctx));
  const start = numArg(args[2], ctx, 1);
  if (needle instanceof XlErr) return needle;
  if (hay instanceof XlErr) return hay;
  if (start instanceof XlErr) return start;
  const i = ci ? hay.toLowerCase().indexOf(needle.toLowerCase(), start - 1) : hay.indexOf(needle, start - 1);
  return i < 0 ? ERR.value : i + 1;
}

export { scalarArg, firstErr };
