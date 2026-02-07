/**
 * Snapshot: build accessibility-like tree for main frame and iframes.
 * Ref map: frameKey -> ref -> { role, name } for resolving clicks.
 */

const MAIN_FRAME_KEY = "";

interface FrameTreeNode {
  id: string;
  childFrames?: { frame: FrameTreeNode }[];
}

export type RefEntry = {
  role: string;
  name: string;
  /** When set, use CDP click (for cross-origin iframes). */
  frameId?: string;
  backendDOMNodeId?: number;
  /** When set (e.g. from DOMSnapshot fallback), click at this viewport point instead of by node. */
  viewportClickPoint?: { x: number; y: number };
};

const refMap = new Map<string, Map<string, RefEntry>>();

export function getRefEntry(frameKey: string, ref: string): RefEntry | undefined {
  return refMap.get(frameKey)?.get(ref);
}

export function setRefMap(frameKey: string, entries: Map<string, RefEntry>): void {
  refMap.set(frameKey, entries);
}

/** Script run inside the page/frame to collect interactive elements (role + name). */
const SNAPSHOT_SCRIPT = () => {
  const nodes: { role: string; name: string }[] = [];
  const seen = new Set<Element>();
  const getRole = (el: Element): string => {
    const r = el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    const roleMap: Record<string, string> = {
      button: "button",
      a: "link",
      input: (el as HTMLInputElement).type === "submit" ? "button" : (el as HTMLInputElement).type === "button" ? "button" : (el as HTMLInputElement).type === "checkbox" ? "checkbox" : (el as HTMLInputElement).type === "radio" ? "radio" : "textbox",
      select: "combobox",
      textarea: "textbox",
      h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
    };
    return roleMap[tag] ?? "generic";
  };
  const getName = (el: Element): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder.trim();
    if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button" || el.type === "reset")) {
      return (el as HTMLInputElement).value || el.textContent?.trim().slice(0, 100) || "";
    }
    const text = el.textContent?.trim().slice(0, 200) || "";
    return text || "(unnamed)";
  };
  const add = (el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    nodes.push({ role: getRole(el), name: getName(el) });
  };
  const focusable = document.querySelectorAll(
    "button, a[href], input, select, textarea, [role='button'], [role='link'], [role='textbox'], [role='checkbox'], [role='radio'], [role='combobox'], [role='tab'], [contenteditable='true'], [tabindex]:not([tabindex='-1'])"
  );
  focusable.forEach(add);
  if (nodes.length === 0) {
    const fallback = document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading'], [role='region'], [role='main'], [role='banner'], a, button, input, select, textarea");
    fallback.forEach(add);
  }
  return nodes;
};

const REF_PREFIX_MAIN = "s1e";

export interface SnapshotResult {
  text: string;
  refPrefix: string;
}

/**
 * Build main-frame snapshot: run script in page, assign refs, store ref map, return tree text.
 */
export async function snapshotMainFrame(page: import("playwright").Page): Promise<SnapshotResult> {
  let raw: { role: string; name: string }[];
  try {
    raw = await page.evaluate(SNAPSHOT_SCRIPT);
  } catch (e) {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];
  const entries = new Map<string, RefEntry>();
  const lines: string[] = ["- document [ref=" + REF_PREFIX_MAIN + "0]:"];
  raw.forEach((node, i) => {
    const ref = REF_PREFIX_MAIN + (i + 1);
    entries.set(ref, { role: node.role, name: node.name });
    const nameEsc = node.name ? ` "${node.name.replace(/"/g, '\\"')}"` : "";
    lines.push(`  - ${node.role}${nameEsc} [ref=${ref}]`);
  });
  if (lines.length === 1) lines.push("  - (no focusable elements; page may have loaded in an iframe)");
  setRefMap(MAIN_FRAME_KEY, entries);
  return { text: lines.join("\n"), refPrefix: REF_PREFIX_MAIN };
}

/**
 * Build snapshot for a single iframe. frameSelector can be chained for nested frames,
 * e.g. "iframe#pplayer_iframe" or "iframe#pplayer_iframe >> iframe#modulePlayerIframe".
 */
export async function snapshotFrame(
  page: import("playwright").Page,
  frameSelector: string
): Promise<SnapshotResult> {
  const frame = getChainedFrameLocator(page, frameSelector);
  let raw: { role: string; name: string }[];
  const EVALUATE_TIMEOUT_MS = 5000;
  try {
    raw = await frame.locator("body").evaluate(SNAPSHOT_SCRIPT, { timeout: EVALUATE_TIMEOUT_MS });
  } catch {
    // Rethrow so tools.ts can fall back to CDP for cross-origin / inaccessible frames
    throw new Error("Frame evaluate failed (cross-origin or timeout)");
  }
  if (!Array.isArray(raw)) raw = [];
  const refPrefix = "f1e";
  const entries = new Map<string, RefEntry>();
  const lines: string[] = [`- frame ${frameSelector} [ref=${refPrefix}0]:`];
  raw.forEach((node, i) => {
    const ref = refPrefix + (i + 1);
    entries.set(ref, { role: node.role, name: node.name });
    const nameEsc = node.name ? ` "${node.name.replace(/"/g, '\\"')}"` : "";
    lines.push(`  - ${node.role}${nameEsc} [ref=${ref}]`);
  });
  if (lines.length === 1) lines.push("  - (frame empty or still loading)");
  setRefMap(frameSelector, entries);
  return { text: lines.join("\n"), refPrefix };
}

/**
 * When includeFrames is true, append snapshot of each iframe. Uses CDP fallback for
 * cross-origin frames so we can still snapshot and click inside them.
 */
export async function snapshotMainFrameWithIframes(
  page: import("playwright").Page,
  context?: import("playwright").BrowserContext | null
): Promise<string> {
  const main = await snapshotMainFrame(page);
  const lines: string[] = [main.text];
  const frames = page.frames().slice(1);
  let cdp: import("playwright").CDPSession | null = null;
  let flatFrameIds: string[] = [];
  if (context) {
    try {
      cdp = await context.newCDPSession(page);
      await cdp.send("Page.enable" as any);
      await cdp.send("Accessibility.enable" as any);
      const tree = await cdp.send("Page.getFrameTree" as any);
      const frameTree = (tree as { frameTree?: { frame: FrameTreeNode } }).frameTree;
      const root = frameTree?.frame;
      if (root) {
        const list: string[] = [];
        function collect(f: FrameTreeNode) {
          list.push(f.id);
          f.childFrames?.forEach((c) => collect(c.frame));
        }
        collect(root);
        flatFrameIds = list;
      }
    } catch {
      flatFrameIds = [];
    }
  }
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    let selector: string;
    try {
      const frameEl = await frame.frameElement();
      const idOrName = frameEl
        ? await frameEl.evaluate((el: HTMLIFrameElement) => {
            const id = el.id;
            const name = el.name;
            return id ? `iframe#${id}` : name ? `iframe[name="${name}"]` : null;
          })
        : null;
      selector = idOrName ?? `iframe:nth-of-type(${i + 1})`;
    } catch {
      selector = `iframe:nth-of-type(${i + 1})`;
    }
    try {
      const result = await snapshotFrame(page, selector);
      lines.push("", result.text);
    } catch {
      if (cdp && flatFrameIds.length > i + 1) {
        const frameId = flatFrameIds[i + 1];
        try {
          const cdpResult = await import("./cdp.js").then((m) =>
            m.snapshotFrameViaCDP(cdp!, frameId, selector, `f${i + 1}e`)
          );
          lines.push("", cdpResult.text);
          const entries = new Map<string, RefEntry>();
          cdpResult.entries.forEach((e, ref) => {
            entries.set(ref, {
              role: e.role,
              name: e.name,
              frameId: e.frameId,
              backendDOMNodeId: e.backendDOMNodeId,
            });
          });
          setRefMap(selector, entries);
        } catch {
          lines.push("", `- iframe [${selector}] (CDP snapshot failed)`);
        }
      } else {
        lines.push("", `- iframe [${selector}] (cross-origin or unavailable)`);
      }
    }
  }
  if (cdp) (cdp as { detach?: () => Promise<void> }).detach?.().catch(() => {});
  return lines.join("\n");
}

export function getMainFrameKey(): string {
  return MAIN_FRAME_KEY;
}

/**
 * Resolve a frame selector, optionally chained with " >> ", to a FrameLocator.
 * E.g. "iframe#pplayer_iframe >> iframe#modulePlayerIframe" for nested iframes.
 */
export function getChainedFrameLocator(
  page: import("playwright").Page,
  frameSelector: string
): import("playwright").FrameLocator {
  const parts = frameSelector.split(">>").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("Empty frame selector");
  let frame = page.frameLocator(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    frame = frame.frameLocator(parts[i]);
  }
  return frame;
}

/**
 * Get the viewport bounding box of the iframe(s) specified by frameSelector.
 * For chained selectors, returns the innermost iframe element's bbox (in page coordinates).
 * Used by browser_click_at to convert (x,y) relative to frame into page coordinates.
 */
export async function getFrameViewportBbox(
  page: import("playwright").Page,
  frameSelector: string
): Promise<{ x: number; y: number; width: number; height: number }> {
  const parts = frameSelector.split(">>").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("Empty frame selector");
  let locator: import("playwright").Locator;
  if (parts.length === 1) {
    locator = page.locator(parts[0]);
  } else {
    let frame = page.frameLocator(parts[0]);
    for (let i = 1; i < parts.length - 1; i++) {
      frame = frame.frameLocator(parts[i]);
    }
    locator = frame.locator(parts[parts.length - 1]);
  }
  const box = await locator.boundingBox({ timeout: 10000 });
  if (!box) throw new Error(`Frame not found or not visible: ${frameSelector}`);
  return box;
}

/**
 * Resolve frameSelector to the Playwright Frame (content of the innermost iframe).
 * Used by browser_frame_probe to run evaluate() inside the frame.
 */
export async function getFrameForSelector(
  page: import("playwright").Page,
  frameSelector: string
): Promise<import("playwright").Frame | null> {
  const parts = frameSelector.split(">>").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let locator: import("playwright").Locator;
  if (parts.length === 1) {
    locator = page.locator(parts[0]);
  } else {
    let frame = page.frameLocator(parts[0]);
    for (let i = 1; i < parts.length - 1; i++) {
      frame = frame.frameLocator(parts[i]);
    }
    locator = frame.locator(parts[parts.length - 1]);
  }
  const handle = await locator.elementHandle({ timeout: 10000 }).catch(() => null);
  if (!handle) return null;
  const frame = await handle.contentFrame().catch(() => null);
  await handle.dispose().catch(() => {});
  return frame;
}
