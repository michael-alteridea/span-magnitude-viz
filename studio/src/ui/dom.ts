/** Mini helper DOM (sans framework). */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
      else if (k === "class") el.className = String(v);
      else if (k === "html") el.innerHTML = String(v);
      else if (k === "value" || k === "checked" || k === "selected" || k === "disabled" || k === "open") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function svgIcon(inner: string, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const ICONS = {
  bar: `<rect x="4" y="11" width="3.5" height="9" rx="1" fill="currentColor" stroke="none"/><rect x="10.25" y="5" width="3.5" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="16.5" y="8" width="3.5" height="12" rx="1" fill="currentColor" stroke="none" opacity=".55"/>`,
  barH: `<rect x="4" y="4" width="10" height="3.5" rx="1" fill="currentColor" stroke="none"/><rect x="4" y="10.25" width="16" height="3.5" rx="1" fill="currentColor" stroke="none"/><rect x="4" y="16.5" width="7" height="3.5" rx="1" fill="currentColor" stroke="none" opacity=".55"/>`,
  groupedBar: `<rect x="3" y="10" width="3" height="10" rx=".8" fill="currentColor" stroke="none"/><rect x="6.5" y="6" width="3" height="14" rx=".8" fill="currentColor" stroke="none" opacity=".55"/><rect x="13" y="8" width="3" height="12" rx=".8" fill="currentColor" stroke="none"/><rect x="16.5" y="12" width="3" height="8" rx=".8" fill="currentColor" stroke="none" opacity=".55"/>`,
  stackedBar: `<rect x="4" y="12" width="4.5" height="8" fill="currentColor" stroke="none"/><rect x="4" y="7" width="4.5" height="5" fill="currentColor" stroke="none" opacity=".5"/><rect x="13" y="9" width="4.5" height="11" fill="currentColor" stroke="none"/><rect x="13" y="4" width="4.5" height="5" fill="currentColor" stroke="none" opacity=".5"/>`,
  line: `<path d="M3 17 L8 11 L12 14 L20 5"/><path d="M3 20 L9 16 L14 18 L20 12" opacity=".5"/>`,
  area: `<path d="M3 19 L3 14 L8 9 L13 12 L21 5 L21 19 Z" fill="currentColor" opacity=".35" stroke="none"/><path d="M3 14 L8 9 L13 12 L21 5"/>`,
  stackedArea: `<path d="M3 20 L3 15 L9 12 L15 14 L21 9 L21 20 Z" fill="currentColor" stroke="none"/><path d="M3 15 L3 10 L9 6 L15 9 L21 4 L21 9 L15 14 L9 12 Z" fill="currentColor" opacity=".45" stroke="none"/>`,
  scatter: `<circle cx="6" cy="16" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" opacity=".6"/><circle cx="16" cy="13" r="2" fill="currentColor" stroke="none"/><circle cx="18" cy="6" r="2.5" fill="currentColor" stroke="none" opacity=".6"/>`,
  pie: `<path d="M12 3 A9 9 0 1 1 3 12 L12 12 Z" fill="currentColor" stroke="none"/><path d="M12 3 A9 9 0 0 0 3 12 L12 12 Z" fill="currentColor" opacity=".45" stroke="none"/>`,
  donut: `<circle cx="12" cy="12" r="7.5" stroke-width="4" opacity=".4"/><path d="M12 4.5 A7.5 7.5 0 1 1 4.5 12" stroke-width="4" stroke-linecap="butt"/>`,
  radialBar: `<path d="M12 3 A9 9 0 1 1 3 12" stroke-width="2.4"/><path d="M12 7 A5 5 0 1 1 7 12" stroke-width="2.4" opacity=".6"/><path d="M12 10.5 A1.5 1.5 0 0 1 13.5 12" stroke-width="2.4" opacity=".4"/>`,
  variance: `<path d="M3 12 H21" opacity=".5"/><rect x="5" y="5" width="3.2" height="7" fill="currentColor" stroke="none"/><rect x="10.4" y="12" width="3.2" height="5" fill="currentColor" stroke="none" opacity=".55"/><rect x="15.8" y="7" width="3.2" height="5" fill="currentColor" stroke="none"/>`,
  explore: `<circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/><path d="M8 12.5 L10 10 L12 11.5 L14 9" stroke-width="1.6"/>`,
  camera: `<path d="M4 8 H8 L9.5 5.5 H14.5 L16 8 H20 V19 H4 Z"/><circle cx="12" cy="13" r="3.3"/>`,
  story: `<rect x="3" y="6" width="5" height="12" rx="1"/><rect x="9.5" y="6" width="5" height="12" rx="1"/><rect x="16" y="6" width="5" height="12" rx="1" opacity=".5"/>`,
  sparkle: `<path d="M12 3 L13.6 9.4 L20 11 L13.6 12.6 L12 19 L10.4 12.6 L4 11 L10.4 9.4 Z" fill="currentColor" stroke="none"/>`,
  refresh: `<path d="M20 12 A8 8 0 1 1 17 5.8"/><path d="M20 4 V9 H15"/>`,
  trash: `<path d="M5 7 H19 M10 7 V4.5 H14 V7 M7 7 L8 20 H16 L17 7"/>`,
  close: `<path d="M6 6 L18 18 M18 6 L6 18"/>`,
  film: `<path d="M3 18 Q6 8 9 18" /><path d="M7 18 Q12 2 17 18" stroke-width="2.6"/><path d="M14 18 Q17.5 11 21 18" opacity=".55"/><path d="M2 18.5 H22" opacity=".4"/>`,
  map: `<path d="M9 4 L3 6 V20 L9 18 L15 20 L21 18 V4 L15 6 Z" opacity=".5"/><path d="M9 4 V18 M15 6 V20" opacity=".5"/><circle cx="12" cy="10" r="2.3" fill="currentColor" stroke="none"/>`,
  play: `<path d="M7 4.5 L19 12 L7 19.5 Z" fill="currentColor" stroke="none"/>`,
  pause: `<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>`,
  restart: `<path d="M4 12 A8 8 0 1 0 7 5.8"/><path d="M4 4 V9 H9"/>`,
  upload: `<path d="M12 16 V4 M7 9 L12 4 L17 9"/><path d="M4 16 V20 H20 V16"/>`,
  download: `<path d="M12 4 V16 M7 11 L12 16 L17 11"/><path d="M4 16 V20 H20 V16"/>`,
  chevronL: `<path d="M15 5 L8 12 L15 19"/>`,
  chevronR: `<path d="M9 5 L16 12 L9 19"/>`,
  table: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9 H21 M3 14.5 H21 M9 4 V20"/>`,
  sliders: `<path d="M4 6 H14 M18 6 H20 M4 12 H8 M12 12 H20 M4 18 H16 M20 18 H20"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>`,
  film2: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5 V19 M17 5 V19 M3 9 H7 M3 15 H7 M17 9 H21 M17 15 H21"/>`,
  paste: `<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4 V3 H15 V4"/><path d="M9 10 H15 M9 14 H15"/>`,
};
