/**
 * Analyseur de formules Excel → arbre syntaxique (AST). Code maison (licence MIT du dépôt), sans dépendance.
 * Gère : nombres, chaînes, booléens, erreurs, références A1 relatives / absolues ($A$1), plages (A1:B2, A:A, 1:3),
 * références à d'autres feuilles ('Hypothèses'!$D$112, Feuil1!A1), noms définis, opérateurs (+ - * / ^ & % = <> < > <= >=),
 * tableaux constants {1,2;3,4}, appels de fonctions (préfixes _xlfn. / _xlws. retirés).
 * Non pris en charge (erreur d'analyse explicite) : références structurées [Tableau], intersection (espace), unions.
 */

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: string }
  | { k: "ref"; sheet: string | null; r: number; c: number }
  | { k: "range"; sheet: string | null; r1: number; c1: number; r2: number; c2: number }
  | { k: "name"; name: string }
  | { k: "un"; op: "-" | "+" | "%"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] }
  | { k: "array"; rows: Node[][] }
  | { k: "missing" };

export class FormulaParseError extends Error {}

/** Plus grande ligne / colonne Excel (indices 0). */
export const MAX_ROW = 1048575;
export const MAX_COL = 16383;

export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export function addrOf(r: number, c: number): string {
  return `${indexToCol(c)}${r + 1}`;
}
/** « D12 » → { r: 11, c: 3 }. */
export function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a);
  if (!m) return null;
  return { r: Number(m[2]) - 1, c: colToIndex(m[1]!) };
}

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  | { t: "ref"; node: Node }
  | { t: "fn"; v: string }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "("; v?: undefined }
  | { t: ")"; v?: undefined }
  | { t: ","; v?: undefined }
  | { t: ";"; v?: undefined }
  | { t: "{"; v?: undefined }
  | { t: "}"; v?: undefined };

const ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!"];
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const COL = String.raw`\$?[A-Za-z]{1,3}`;
const ROW = String.raw`\$?\d+`;
const RE_RANGE = new RegExp(`^(${CELL})(?::(${CELL}))?`);
const RE_COLS = new RegExp(`^(${COL}):(${COL})(?![A-Za-z0-9_(])`);
const RE_ROWS = new RegExp(`^(${ROW}):(${ROW})(?![0-9])`);

function refNode(sheet: string | null, text: string): Node | null {
  let m = RE_COLS.exec(text);
  if (m && m[0] === text) {
    const c1 = colToIndex(m[1]!.replace("$", ""));
    const c2 = colToIndex(m[2]!.replace("$", ""));
    return { k: "range", sheet, r1: 0, c1: Math.min(c1, c2), r2: MAX_ROW, c2: Math.max(c1, c2) };
  }
  m = RE_ROWS.exec(text);
  if (m && m[0] === text) {
    const r1 = Number(m[1]!.replace("$", "")) - 1;
    const r2 = Number(m[2]!.replace("$", "")) - 1;
    return { k: "range", sheet, r1: Math.min(r1, r2), c1: 0, r2: Math.max(r1, r2), c2: MAX_COL };
  }
  m = RE_RANGE.exec(text);
  if (m && m[0] === text) {
    const a = parseAddr(m[1]!)!;
    if (a.c > MAX_COL || a.r > MAX_ROW) return null;
    if (!m[2]) return { k: "ref", sheet, r: a.r, c: a.c };
    const b = parseAddr(m[2])!;
    return { k: "range", sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  }
  return null;
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src;
  const n = s.length;
  const prevIsOperand = () => {
    const p = out[out.length - 1];
    return !!p && (p.t === "num" || p.t === "str" || p.t === "bool" || p.t === "err" || p.t === "ref" || p.t === "name" || p.t === ")" || p.t === "}" || (p.t === "op" && p.v === "%"));
  };
  while (i < n) {
    const ch = s[i]!;
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      // Espace : opérateur d'intersection entre deux références (non pris en charge), sinon ignoré
      let j = i;
      while (j < n && /\s/.test(s[j]!)) j++;
      const p = out[out.length - 1];
      if (p && (p.t === "ref" || p.t === ")") && j < n && /[$A-Za-z']/.test(s[j]!)) {
        const rest = s.slice(j);
        if (RE_RANGE.test(rest) && !/^[A-Za-z_.]+\(/.test(rest)) throw new FormulaParseError("Intersection de plages (espace) non prise en charge");
      }
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      for (;;) {
        if (j >= n) throw new FormulaParseError("Chaîne non terminée");
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += s[j];
        j++;
      }
      out.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const e = ERRORS.find((x) => s.startsWith(x, i) || s.toUpperCase().startsWith(x, i));
      if (!e) throw new FormulaParseError("Erreur inconnue");
      out.push({ t: "err", v: e });
      i += e.length;
      continue;
    }
    if (ch === "[") throw new FormulaParseError("Références structurées [Tableau] non prises en charge");
    // Référence à une autre feuille (nom entre apostrophes)
    if (ch === "'") {
      let j = i + 1;
      let name = "";
      for (;;) {
        if (j >= n) throw new FormulaParseError("Nom de feuille non terminé");
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          break;
        }
        name += s[j];
        j++;
      }
      if (s[j + 1] !== "!") throw new FormulaParseError("« ! » attendu après le nom de feuille");
      const rest = s.slice(j + 2);
      const m = RE_COLS.exec(rest) || RE_ROWS.exec(rest) || RE_RANGE.exec(rest);
      if (!m) {
        if (rest.startsWith("#REF!")) {
          out.push({ t: "err", v: "#REF!" });
          i = j + 2 + 5;
          continue;
        }
        throw new FormulaParseError("Référence attendue après le nom de feuille");
      }
      const node = refNode(name, m[0]);
      if (!node) throw new FormulaParseError("Référence invalide");
      out.push({ t: "ref", node });
      i = j + 2 + m[0].length;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      // Plage de lignes « 1:3 » ?
      const rows = RE_ROWS.exec(s.slice(i));
      if (rows && !prevIsOperand()) {
        out.push({ t: "ref", node: refNode(null, rows[0])! });
        i += rows[0].length;
        continue;
      }
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new FormulaParseError(`Caractère inattendu « ${ch} »`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$\\\u00C0-\uFFFF]/.test(ch)) {
      const rest = s.slice(i);
      // Feuille sans apostrophes : Feuil1!A1
      const sm = /^([A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*)!/.exec(rest);
      if (sm) {
        const r2 = rest.slice(sm[0].length);
        const m = RE_COLS.exec(r2) || RE_ROWS.exec(r2) || RE_RANGE.exec(r2);
        if (!m) throw new FormulaParseError("Référence attendue après le nom de feuille");
        out.push({ t: "ref", node: refNode(sm[1]!, m[0])! });
        i += sm[0].length + m[0].length;
        continue;
      }
      const id = /^[A-Za-z_$\\\u00C0-\uFFFF][\w.$\u00C0-\uFFFF]*/.exec(rest)![0];
      const after = rest.slice(id.length);
      if (after.startsWith("(")) {
        out.push({ t: "fn", v: id.toUpperCase().replace(/^_XLFN\./, "").replace(/^_XLWS\./, "").replace(/^_XLFN\./, "") });
        i += id.length;
        continue;
      }
      // Plage de colonnes A:B, cellule, plage A1:B2
      const cm = RE_COLS.exec(rest) || RE_RANGE.exec(rest);
      if (cm && (cm[0].length >= id.length || /^\$?[A-Za-z]{1,3}\$?\d+:/.test(rest))) {
        const node = refNode(null, cm[0]);
        if (node) {
          out.push({ t: "ref", node });
          i += cm[0].length;
          continue;
        }
      }
      const up = id.toUpperCase();
      if (up === "TRUE" || up === "FALSE") out.push({ t: "bool", v: up === "TRUE" });
      else out.push({ t: "name", v: id });
      i += id.length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "," || ch === ";" || ch === "{" || ch === "}") {
      out.push({ t: ch } as Tok);
      i++;
      continue;
    }
    throw new FormulaParseError(`Caractère inattendu « ${ch} »`);
  }
  return out;
}

const BIN_PREC: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

/** Analyse une formule (avec ou sans « = » initial). */
export function parseFormula(src: string): Node {
  const text = src.startsWith("=") ? src.slice(1) : src;
  const toks = tokenize(text);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: string) => {
    const k = next();
    if (!k || k.t !== t) throw new FormulaParseError(`« ${t} » attendu`);
  };

  function primary(): Node {
    const tk = next();
    if (!tk) throw new FormulaParseError("Formule incomplète");
    switch (tk.t) {
      case "num":
        return { k: "num", v: tk.v };
      case "str":
        return { k: "str", v: tk.v };
      case "bool":
        return { k: "bool", v: tk.v };
      case "err":
        return { k: "err", v: tk.v };
      case "ref":
        return tk.node;
      case "name":
        return { k: "name", name: tk.v };
      case "(": {
        const e = expr(0);
        expect(")");
        return e;
      }
      case "{": {
        const rows: Node[][] = [[]];
        for (;;) {
          rows[rows.length - 1]!.push(unary());
          const sep = next();
          if (!sep) throw new FormulaParseError("Tableau non terminé");
          if (sep.t === "}") break;
          if (sep.t === ";") rows.push([]);
          else if (sep.t !== ",") throw new FormulaParseError("Séparateur de tableau attendu");
        }
        return { k: "array", rows };
      }
      case "fn": {
        expect("(");
        const args: Node[] = [];
        if (peek()?.t === ")") {
          next();
          return { k: "call", name: tk.v, args };
        }
        for (;;) {
          const t = peek();
          if (t && (t.t === "," || t.t === ")")) args.push({ k: "missing" });
          else args.push(expr(0));
          const sep = next();
          if (!sep) throw new FormulaParseError("Parenthèse fermante manquante");
          if (sep.t === ")") break;
          if (sep.t !== ",") throw new FormulaParseError("« , » ou « ) » attendu");
        }
        return { k: "call", name: tk.v, args };
      }
      case "op":
        if (tk.v === "-" || tk.v === "+") return { k: "un", op: tk.v, a: unary() };
        throw new FormulaParseError(`Opérateur inattendu « ${tk.v} »`);
      default:
        throw new FormulaParseError(`Symbole inattendu « ${tk.t} »`);
    }
  }
  // Moins unaire : plus prioritaire que ^ (Excel : -2^2 = 4), puis % postfixe
  function unary(): Node {
    const t = peek();
    let node: Node;
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      next();
      node = { k: "un", op: t.v as "-" | "+", a: unary() };
    } else node = primary();
    for (let q = peek(); q && q.t === "op" && q.v === "%"; q = peek()) {
      next();
      node = { k: "un", op: "%", a: node };
    }
    return node;
  }
  function expr(min: number): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op") break;
      const prec = BIN_PREC[t.v as string];
      if (prec === undefined || prec <= min - 1 || prec < min) break;
      next();
      const right = expr(prec + 1);
      left = { k: "bin", op: t.v, a: left, b: right };
    }
    return left;
  }
  const root = expr(0);
  if (p < toks.length) throw new FormulaParseError(`Symbole inattendu en fin de formule « ${(toks[p] as { v?: unknown }).v ?? toks[p]!.t} »`);
  return root;
}
