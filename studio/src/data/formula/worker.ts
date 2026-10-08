/// <reference lib="webworker" />
/** Web Worker : recalcul du classeur hors du fil principal, avec progression. */
import * as formulajs from "@formulajs/formulajs";
import { recalcWorkbook } from "./engine";
import { valuesToWire, wbFromWire, type WireWorkbook, type WorkerMsg } from "./wire";

const post = (m: WorkerMsg) => (self as unknown as Worker).postMessage(m);
self.onmessage = (ev: MessageEvent<WireWorkbook>) => {
  try {
    let last = 0;
    const res = recalcWorkbook(wbFromWire(ev.data), {
      fallback: formulajs as never,
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - last > 80 || done === total) {
          last = now;
          post({ type: "progress", done, total });
        }
      },
    });
    post({ type: "done", values: valuesToWire(res.values), report: res.report });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
