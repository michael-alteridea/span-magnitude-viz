import { describe, expect, it } from "vitest";
import { easeInOut, easeOut, pathDelta } from "../src/ui/drillZoom";

const T2 = { kind: "period", start: 1, grain: "quarter" };
const JUIN = { kind: "period", start: 2, grain: "month" };
const WAL = { kind: "cat", field: "region", value: "Wallonie" };

describe("transition « zoom dans la marque »", () => {
  it("reconnaît une descente d'un niveau (étape ajoutée)", () => {
    expect(pathDelta([T2], [T2, JUIN])).toEqual({ dir: "in", step: JUIN });
    expect(pathDelta([], [T2])).toEqual({ dir: "in", step: T2 });
  });
  it("reconnaît une remontée d'un niveau (étape retirée)", () => {
    expect(pathDelta([T2, JUIN, WAL], [T2, JUIN])).toEqual({ dir: "out", step: WAL });
  });
  it("ignore les chemins sans lien parent / enfant", () => {
    expect(pathDelta([T2], [T2])).toBeNull();
    expect(pathDelta([T2, JUIN], [T2, WAL])).toBeNull();
    expect(pathDelta([], [T2, JUIN])).toBeNull();
    expect(pathDelta([JUIN], [T2, JUIN])).toBeNull();
  });
  it("courbes adoucies bornées (0 → 1)", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });
});
