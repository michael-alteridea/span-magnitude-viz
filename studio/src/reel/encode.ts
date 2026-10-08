/**
 * Mode « Reel » : encodage vidéo dans le navigateur, sans serveur.
 *
 * 1. MP4 H.264 : WebCodecs `VideoEncoder` + `mp4-muxer` (MIT) — plus rapide que le temps réel, image par image,
 *    durée exacte (Chrome, Edge, Safari ≥ 16.4 / iPadOS ≥ 16.4).
 * 2. Repli : `MediaRecorder` sur un canevas (WebM, ou MP4 sur Safari) en temps réel ; si le rendu d'une image
 *    prend plus d'1/30 s, des images sont sautées (la durée reste juste).
 * Les images ne sont jamais stockées : chacune est dessinée, encodée puis libérée (mémoire iPad).
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { svgToImage } from "../export";

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** SVG autonome de l'image i. */
  frameAt: (i: number) => Promise<string> | string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Forcer le repli MediaRecorder (tests). */
  forceFallback?: boolean;
}

export interface EncodeResult {
  blob: Blob;
  mime: string;
  ext: "mp4" | "webm";
  codec: string;
  frames: number;
  durationS: number;
  ms: number;
  method: "webcodecs" | "mediarecorder";
}

const H264 = ["avc1.640028", "avc1.4d0028", "avc1.420028"];

export class ReelAbort extends Error {
  constructor() {
    super("Export annulé.");
    this.name = "AbortError";
  }
}

/** Configuration H.264 acceptée par le navigateur, sinon null. */
export async function h264Config(width: number, height: number, fps: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const codec of H264) {
    const cfg: VideoEncoderConfig = { codec, width, height, bitrate: width * height >= 1920 * 1080 ? 9_000_000 : 6_000_000, framerate: fps, avc: { format: "avc" } };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return r.config ?? cfg;
    } catch {
      /* codec suivant */
    }
  }
  return null;
}

/** Capacités d'export de ce navigateur (affichées dans la fenêtre Reel). */
export async function reelCapabilities(width: number, height: number, fps: number): Promise<{ mp4: boolean; fallback: "webm" | "mp4" | null }> {
  const mp4 = !!(await h264Config(width, height, fps));
  return { mp4, fallback: recorderMime()?.ext ?? null };
}

function recorderMime(): { mime: string; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  for (const mime of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"])
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
  return null;
}

function canvasFor(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
  return { canvas, ctx };
}

async function paint(ctx: CanvasRenderingContext2D, svg: string, w: number, h: number): Promise<void> {
  const img = await svgToImage(svg);
  ctx.fillStyle = "#04141a";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}

export async function encodeReel(o: EncodeOptions): Promise<EncodeResult> {
  const cfg = o.forceFallback ? null : await h264Config(o.width, o.height, o.fps);
  if (cfg) return encodeMp4(o, cfg);
  return recordFallback(o);
}

async function encodeMp4(o: EncodeOptions, cfg: VideoEncoderConfig): Promise<EncodeResult> {
  const t0 = performance.now();
  const { ctx, canvas } = canvasFor(o.width, o.height);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: o.width, height: o.height, frameRate: o.fps }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
  let failure: unknown = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  enc.configure(cfg);
  const step = 1e6 / o.fps;
  try {
    for (let i = 0; i < o.frames; i++) {
      if (o.signal?.aborted) throw new ReelAbort();
      if (failure) throw failure;
      await paint(ctx, await o.frameAt(i), o.width, o.height);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
      enc.encode(vf, { keyFrame: i % (o.fps * 2) === 0 });
      vf.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
      o.onProgress?.(i + 1, o.frames);
    }
    await enc.flush();
    if (failure) throw failure;
  } finally {
    if (enc.state !== "closed") enc.close();
  }
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  return { blob, mime: "video/mp4", ext: "mp4", codec: cfg.codec, frames: o.frames, durationS: o.frames / o.fps, ms: performance.now() - t0, method: "webcodecs" };
}

async function recordFallback(o: EncodeOptions): Promise<EncodeResult> {
  const rm = recorderMime();
  if (!rm) throw new Error("Ce navigateur ne sait pas encoder de vidéo (ni WebCodecs H.264, ni MediaRecorder). Essayez Chrome, Edge ou Safari récent.");
  const t0 = performance.now();
  const { ctx, canvas } = canvasFor(o.width, o.height);
  await paint(ctx, await o.frameAt(0), o.width, o.height);
  const stream = canvas.captureStream(o.fps);
  const rec = new MediaRecorder(stream, { mimeType: rm.mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  const start = performance.now();
  const durMs = (o.frames / o.fps) * 1000;
  let aborted = false;
  // temps réel : on dessine l'image correspondant à l'horloge (images sautées si le rendu est lent)
  for (;;) {
    if (o.signal?.aborted) {
      aborted = true;
      break;
    }
    const el = performance.now() - start;
    if (el >= durMs) break;
    const i = Math.min(o.frames - 1, Math.floor((el / 1000) * o.fps));
    await paint(ctx, await o.frameAt(i), o.width, o.height);
    o.onProgress?.(i + 1, o.frames);
    const next = start + ((i + 1) * 1000) / o.fps - performance.now();
    if (next > 0) await new Promise((r) => setTimeout(r, next));
  }
  rec.stop();
  await stopped;
  for (const tr of stream.getTracks()) tr.stop();
  if (aborted) throw new ReelAbort();
  let blob = new Blob(chunks, { type: rm.mime.split(";")[0] });
  if (rm.ext === "webm") {
    // MediaRecorder n'écrit pas la durée : sans elle, certains lecteurs n'affichent pas de barre de lecture
    const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
    const fix = webmWithDuration(head, durMs);
    if (fix) blob = new Blob([fix.head as BlobPart, blob.slice(fix.cut)], { type: blob.type });
  }
  return { blob, mime: blob.type, ext: rm.ext, codec: rm.mime, frames: o.frames, durationS: o.frames / o.fps, ms: performance.now() - t0, method: "mediarecorder" };
}

/* ------------------------------------------------ WebM : durée dans l'en-tête */

function vint(buf: Uint8Array, pos: number): { len: number; value: number; unknown: boolean } | null {
  const b0 = buf[pos];
  if (b0 == null || b0 === 0) return null;
  const len = Math.clz32(b0) - 23;
  if (pos + len > buf.length) return null;
  let value = b0 & (0xff >> len);
  let ones = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i];
    ones = ones && buf[pos + i] === 0xff;
  }
  return { len, value, unknown: ones };
}

function readId(buf: Uint8Array, pos: number): { len: number; id: number } | null {
  const b0 = buf[pos];
  if (b0 == null || b0 === 0) return null;
  const len = Math.clz32(b0) - 23;
  if (len > 4 || pos + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { len, id };
}

/** Taille EBML sur `len` octets (au moins), ou plus si la valeur ne tient pas. */
function encodeSize(value: number, len: number): Uint8Array {
  let n = len;
  while (value >= 2 ** (7 * n) - 1) n++;
  const out = new Uint8Array(n);
  let v = value;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (n - 1);
  return out;
}

/**
 * Ajoute l'élément Duration (en ms, TimecodeScale 1 ms) dans Segment › Info d'un WebM MediaRecorder.
 * Renvoie le nouvel en-tête à substituer aux `cut` premiers octets, ou null (déjà présent, en-tête inattendu).
 */
export function webmWithDuration(buf: Uint8Array, durationMs: number): { head: Uint8Array; cut: number } | null {
  const ebml = readId(buf, 0);
  if (!ebml || ebml.id !== 0x1a45dfa3) return null;
  const es = vint(buf, ebml.len);
  if (!es) return null;
  const segPos = ebml.len + es.len + es.value;
  const seg = readId(buf, segPos);
  if (!seg || seg.id !== 0x18538067) return null;
  const ss = vint(buf, segPos + seg.len);
  if (!ss) return null;
  let pos = segPos + seg.len + ss.len;
  for (let guard = 0; guard < 16 && pos < buf.length; guard++) {
    const id = readId(buf, pos);
    if (!id) return null;
    const sz = vint(buf, pos + id.len);
    if (!sz || sz.unknown) return null;
    const content = pos + id.len + sz.len;
    if (id.id !== 0x1549a966) {
      pos = content + sz.value;
      continue;
    }
    const end = content + sz.value;
    if (end > buf.length) return null;
    for (let q = content; q < end; ) {
      const cid = readId(buf, q);
      const cs = cid && vint(buf, q + cid.len);
      if (!cid || !cs) return null;
      if (cid.id === 0x4489) return null;
      q += cid.len + cs.len + cs.value;
    }
    const dur = new Uint8Array(11);
    dur.set([0x44, 0x89, 0x88], 0);
    new DataView(dur.buffer).setFloat64(3, durationMs);
    const infoSize = encodeSize(sz.value + 11, sz.len);
    const grow = infoSize.length + 11 - sz.len;
    const segSize = ss.unknown ? buf.subarray(segPos + seg.len, segPos + seg.len + ss.len) : encodeSize(ss.value + grow, ss.len);
    const parts = [buf.subarray(0, segPos + seg.len), segSize, buf.subarray(segPos + seg.len + ss.len, pos + id.len), infoSize, buf.subarray(content, end), dur];
    const head = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      head.set(p, o);
      o += p.length;
    }
    return { head, cut: end };
  }
  return null;
}
