/**
 * Recalcul d'un classeur dans le navigateur : Web Worker (progression, interface fluide) au-delà de quelques milliers
 * de formules ; repli sur le fil principal si le Worker est indisponible (fichier ouvert en file://, CSP…).
 */
import type { RecalcResult, WorkbookIn } from "./engine";
import { valuesFromWire, wbToWire, type WorkerMsg } from "./wire";
import RecalcWorker from "./worker?worker&inline";

export const WORKER_THRESHOLD = 3000;

async function onMainThread(wb: WorkbookIn, onProgress?: (done: number, total: number) => void): Promise<RecalcResult> {
  const [{ recalcWorkbook }, formulajs] = await Promise.all([import("./engine"), import("@formulajs/formulajs")]);
  return recalcWorkbook(wb, { fallback: formulajs as never, onProgress });
}

function inWorker(wb: WorkbookIn, onProgress?: (done: number, total: number) => void): Promise<RecalcResult> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new RecalcWorker();
    } catch (e) {
      reject(e);
      return;
    }
    w.onmessage = (ev: MessageEvent<WorkerMsg>) => {
      const m = ev.data;
      if (m.type === "progress") onProgress?.(m.done, m.total);
      else {
        w.terminate();
        if (m.type === "done") resolve({ values: valuesFromWire(m.values), report: m.report });
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "Worker indisponible"));
    };
    w.postMessage(wbToWire(wb));
  });
}

export async function recalcInBrowser(wb: WorkbookIn, formulas: number, onProgress?: (done: number, total: number) => void): Promise<RecalcResult & { where: "worker" | "main" }> {
  if (formulas >= WORKER_THRESHOLD && typeof Worker !== "undefined") {
    try {
      return { ...(await inWorker(wb, onProgress)), where: "worker" };
    } catch (e) {
      console.info("Recalcul : Worker indisponible, calcul sur le fil principal.", e instanceof Error ? e.message : e);
    }
  }
  return { ...(await onMainThread(wb, onProgress)), where: "main" };
}
