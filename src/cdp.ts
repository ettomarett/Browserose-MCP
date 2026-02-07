/**
 * CDP-based snapshot and click for frames (including cross-origin) that
 * we cannot run evaluate() in. Uses Accessibility.getFullAXTree and
 * DOM.getBoxModel + Input.dispatchMouseEvent.
 */
import type { CDPSession } from "playwright";
import type { BrowserContext, Page } from "playwright";

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio", "combobox", "tab",
  "menuitem", "option", "switch", "searchbox", "spinbutton",
  "heading", "region", "graphic", "img", "group",
]);

interface AXNode {
  nodeId?: string;
  parentId?: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
  frameId?: string;
  childIds?: string[];
}

interface FrameTreeFrame {
  id: string;
  url: string;
  childFrames?: FrameTreeFrame[];
}

function axRole(node: AXNode): string {
  const r = node.role?.value;
  return r ?? "generic";
}

function axName(node: AXNode): string {
  const n = node.name?.value;
  return (n && n.trim()) ? n.trim().slice(0, 200) : "(unnamed)";
}

function isInteractive(node: AXNode): boolean {
  const role = axRole(node);
  return INTERACTIVE_ROLES.has(role) || role === "generic";
}

/** Collect interactive AX nodes (flat list) from tree. */
function collectInteractiveNodes(nodes: AXNode[]): AXNode[] {
  const out: AXNode[] = [];
  const byId = new Map<string, AXNode>();
  nodes.forEach((n) => { if (n.nodeId) byId.set(n.nodeId, n); });
  function walk(id: string): void {
    const node = byId.get(id);
    if (!node) return;
    if (!node.ignored && node.backendDOMNodeId != null && isInteractive(node)) {
      out.push(node);
    }
    node.childIds?.forEach(walk);
  }
  const roots = nodes.filter((n) => !n.parentId);
  roots.forEach((n) => n.nodeId && walk(n.nodeId));
  if (out.length === 0 && nodes.length > 0) {
    nodes.forEach((n) => {
      if (!n.ignored && n.backendDOMNodeId != null && (n.role?.value || n.name?.value)) {
        out.push(n);
      }
    });
  }
  return out;
}

export interface CDPRefEntry {
  role: string;
  name: string;
  frameId: string;
  backendDOMNodeId?: number;
  /** When set, click at this viewport point (from DOMSnapshot fallback). */
  viewportClickPoint?: { x: number; y: number };
}

export interface CDPSnapshotResult {
  text: string;
  refPrefix: string;
  frameKey: string;
  entries: Map<string, CDPRefEntry>;
}

/** Get CDP session for the page (Chromium only). */
export async function getCDPSession(context: BrowserContext, page: Page): Promise<CDPSession | null> {
  try {
    return await context.newCDPSession(page);
  } catch {
    return null;
  }
}

/** Get full frame tree from CDP. */
export async function getFrameTree(cdp: CDPSession): Promise<FrameTreeFrame | null> {
  try {
    const r = await cdp.send("Page.getFrameTree" as any);
    return (r as { frameTree: { frame: FrameTreeFrame } }).frameTree?.frame ?? null;
  } catch {
    return null;
  }
}

/** Flatten frame tree to list of frames with ids. */
export function flattenFrames(root: FrameTreeFrame): { id: string; url: string }[] {
  const out: { id: string; url: string }[] = [];
  function visit(f: FrameTreeFrame) {
    out.push({ id: f.id, url: f.url });
    f.childFrames?.forEach(visit);
  }
  visit(root);
  return out;
}

/** Build map frameId -> selector (e.g. "iframe#id") using DOM.getFrameOwner + getAttributes. */
export async function buildFrameIdToSelector(cdp: CDPSession, frameIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await cdp.send("DOM.enable" as any);
  for (let i = 0; i < frameIds.length; i++) {
    const frameId = frameIds[i];
    try {
      const owner = await cdp.send("DOM.getFrameOwner" as any, { frameId });
      const backendNodeId = (owner as { backendNodeId?: number }).backendNodeId;
      if (backendNodeId == null) continue;
      const req = await cdp.send("DOM.requestNode" as any, { backendNodeId });
      const nodeId = (req as { nodeId: number }).nodeId;
      if (nodeId == null) continue;
      const attrs = await cdp.send("DOM.getAttributes" as any, { nodeId });
      const arr = (attrs as { attributes: string[] }).attributes ?? [];
      let id: string | null = null;
      let name: string | null = null;
      for (let j = 0; j < arr.length - 1; j += 2) {
        if (arr[j] === "id") id = arr[j + 1];
        if (arr[j] === "name") name = arr[j + 1];
      }
      const selector = id ? `iframe#${id}` : name ? `iframe[name="${name}"]` : `iframe:nth-of-type(${i})`;
      map.set(frameId, selector);
    } catch {
      map.set(frameId, `iframe:nth-of-type(${i})`);
    }
  }
  return map;
}

/** Get accessibility tree for a frame via CDP. Works for cross-origin frames. */
export async function getAXTreeForFrame(cdp: CDPSession, frameId: string): Promise<AXNode[]> {
  try {
    await cdp.send("Accessibility.enable" as any);
    const r = await cdp.send("Accessibility.getFullAXTree" as any, { frameId });
    const nodes = (r as { nodes?: AXNode[] }).nodes ?? [];
    return nodes;
  } catch {
    return [];
  }
}

/** Build snapshot text and ref map from AX nodes for one frame. */
export function buildSnapshotFromAXNodes(
  nodes: AXNode[],
  frameLabel: string,
  refPrefix: string,
  frameId: string,
  frameKey: string
): { text: string; entries: Map<string, CDPRefEntry> } {
  const interactive = collectInteractiveNodes(nodes);
  const entries = new Map<string, CDPRefEntry>();
  const lines: string[] = [`- frame ${frameLabel} [ref=${refPrefix}0]:`];
  interactive.forEach((node, i) => {
    const ref = refPrefix + (i + 1);
    const role = axRole(node);
    const name = axName(node);
    if (node.backendDOMNodeId != null) {
      entries.set(ref, { role, name, frameId, backendDOMNodeId: node.backendDOMNodeId });
    }
    const nameEsc = name ? ` "${name.replace(/"/g, '\\"')}"` : "";
    lines.push(`  - ${role}${nameEsc} [ref=${ref}]`);
  });
  if (lines.length === 1) lines.push(`  - (CDP: ${nodes.length} AX nodes, none matched)`);
  return { text: lines.join("\n"), entries };
}

/** Snapshot a frame via CDP when evaluate fails (e.g. cross-origin). */
export async function snapshotFrameViaCDP(
  cdp: CDPSession,
  frameId: string,
  frameKey: string,
  refPrefix: string
): Promise<CDPSnapshotResult> {
  const nodes = await getAXTreeForFrame(cdp, frameId);
  const { text, entries } = buildSnapshotFromAXNodes(
    nodes,
    frameKey,
    refPrefix,
    frameId,
    frameKey
  );
  return { text, refPrefix, frameKey, entries };
}

/** Click an element by backendDOMNodeId using CDP (works in any frame). */
export async function clickViaCDP(
  cdp: CDPSession,
  backendDOMNodeId: number
): Promise<void> {
  await cdp.send("DOM.enable" as any);
  const req = await cdp.send("DOM.requestNode" as any, { backendNodeId: backendDOMNodeId });
  const nodeId = (req as { nodeId: number }).nodeId;
  if (nodeId == null) throw new Error("Could not resolve node for click");
  await dispatchClickAtNode(cdp, nodeId);
}

async function dispatchClickAtNode(cdp: CDPSession, nodeId: number): Promise<void> {
  const box = await cdp.send("DOM.getBoxModel" as any, { nodeId });
  const model = box as { model?: { content: number[] } };
  const content = model?.model?.content;
  if (!content || content.length < 6) throw new Error("No box model for element");
  const x = (content[0] + content[2]) / 2;
  const y = (content[1] + content[5]) / 2;
  await dispatchClickAtPoint(cdp, x, y);
}

/** Click at viewport coordinates (e.g. from DOMSnapshot or browser_click_at). */
export async function dispatchClickAtPoint(
  cdp: CDPSession,
  x: number,
  y: number,
  options?: { button?: "left" | "right"; clickCount?: number }
): Promise<void> {
  const button = options?.button ?? "left";
  const clickCount = options?.clickCount ?? 1;
  await cdp.send("Input.dispatchMouseEvent" as any, {
    type: "mousePressed",
    x,
    y,
    button,
    clickCount,
  });
  await cdp.send("Input.dispatchMouseEvent" as any, {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount,
  });
}

/** Get iframe element's content box in viewport (for converting frame-document coords to viewport). */
export async function getIframeViewportRect(
  cdp: CDPSession,
  frameId: string
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    await cdp.send("DOM.enable" as any);
    const owner = await cdp.send("DOM.getFrameOwner" as any, { frameId });
    const backendNodeId = (owner as { backendNodeId?: number }).backendNodeId;
    if (backendNodeId == null) return null;
    const req = await cdp.send("DOM.requestNode" as any, { backendNodeId });
    const nodeId = (req as { nodeId: number }).nodeId;
    if (nodeId == null) return null;
    const box = await cdp.send("DOM.getBoxModel" as any, { nodeId });
    const model = box as { model?: { content: number[] } };
    const c = model?.model?.content;
    if (!c || c.length < 8) return null;
    return { x: c[0], y: c[1], width: c[2] - c[0], height: c[5] - c[1] };
  } catch {
    return null;
  }
}

// --- DOMSnapshot fallback (Tier B) when AX tree is empty ---

const CLICKABLE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"]);

interface DocSnapshot {
  frameId?: number;
  nodes: {
    parentIndex: number[];
    nodeType: number[];
    nodeName: number[];
    backendNodeId: number[];
    attributes: number[][];
    isClickable?: { index: number[]; value: number[] };
  };
  layout: {
    nodeIndex: number[];
    bounds: number[][];
    text?: number[];
  };
  scrollOffsetX: number;
  scrollOffsetY: number;
}

function getRareBooleanAt(data: { index: number[]; value: number[] } | undefined, nodeIndex: number): boolean {
  if (!data) return false;
  const i = data.index.indexOf(nodeIndex);
  return i >= 0 ? Boolean(data.value[i]) : false;
}

function getAttr(nodes: DocSnapshot["nodes"], strings: string[], nodeIdx: number, name: string): string | null {
  const attrs = nodes.attributes?.[nodeIdx];
  if (!attrs || !Array.isArray(attrs)) return null;
  for (let k = 0; k < attrs.length - 1; k += 2) {
    const key = strings[attrs[k]];
    if (key?.toLowerCase() === name.toLowerCase()) return strings[attrs[k + 1]] ?? null;
  }
  return null;
}

/**
 * Snapshot a frame via DOMSnapshot when AX tree is empty (e.g. SCORM/canvas).
 * Builds refs with viewportClickPoint for click via Input.dispatchMouseEvent.
 */
export async function snapshotFrameViaDOMSnapshot(
  cdp: CDPSession,
  frameId: string,
  frameKey: string,
  refPrefix: string,
  strings: string[]
): Promise<CDPSnapshotResult | null> {
  try {
    await cdp.send("DOMSnapshot.enable" as any);
    const snap = await cdp.send("DOMSnapshot.captureSnapshot" as any, {
      computedStyles: [],
      includeDOMRects: true,
    });
    const documents = (snap as { documents?: unknown[] }).documents ?? [];
    const strTable = (snap as { strings?: string[] }).strings ?? strings;
    const doc = documents.find((d: unknown) => {
      const fid = (d as { frameId?: number }).frameId;
      return fid != null && strTable[fid] === frameId;
    }) as DocSnapshot | undefined;
    if (!doc?.layout?.nodeIndex || !doc.layout?.bounds || !doc?.nodes) return null;

    const iframeRect = await getIframeViewportRect(cdp, frameId);
    if (!iframeRect) return null;

    const scrollX = doc.scrollOffsetX ?? 0;
    const scrollY = doc.scrollOffsetY ?? 0;
    const nodeIndex = doc.layout.nodeIndex as number[];
    const bounds = doc.layout.bounds as number[][];
    const nodeName = doc.nodes.nodeName as number[];
    const isClickable = doc.nodes.isClickable as { index: number[]; value: number[] } | undefined;

    const entries = new Map<string, CDPRefEntry>();
    const lines: string[] = [`- frame ${frameKey} [ref=${refPrefix}0] (DOMSnapshot):`];
    let refIdx = 0;

    for (let i = 0; i < nodeIndex.length; i++) {
      const domIdx = nodeIndex[i];
      const b = bounds[i];
      if (!b || b.length < 4 || b[2] <= 0 || b[3] <= 0) continue;

      const tag = strTable[nodeName?.[domIdx]];
      const tagUpper = (tag ?? "").toUpperCase();
      const clickable =
        getRareBooleanAt(isClickable, domIdx) ||
        CLICKABLE_TAGS.has(tagUpper) ||
        getAttr(doc.nodes, strTable, domIdx, "role") !== null;

      if (!clickable) continue;

      const ariaLabel = getAttr(doc.nodes, strTable, domIdx, "aria-label");
      const title = getAttr(doc.nodes, strTable, domIdx, "title");
      const label = (ariaLabel ?? title ?? tag ?? "element").trim().slice(0, 200) || "(unnamed)";
      const role =
        tagUpper === "A" ? "link" : tagUpper === "BUTTON" ? "button" : tagUpper === "INPUT" ? "textbox" : "button";

      const centerX = b[0] + b[2] / 2 - scrollX;
      const centerY = b[1] + b[3] / 2 - scrollY;
      const viewportX = iframeRect.x + centerX;
      const viewportY = iframeRect.y + centerY;

      refIdx++;
      const ref = refPrefix + refIdx;
      entries.set(ref, {
        role,
        name: label,
        frameId,
        viewportClickPoint: { x: viewportX, y: viewportY },
      });
      const nameEsc = label ? ` "${label.replace(/"/g, '\\"')}"` : "";
      lines.push(`  - ${role}${nameEsc} [ref=${ref}]`);
    }

    if (entries.size === 0) return null;
    return { text: lines.join("\n"), refPrefix, frameKey, entries };
  } catch {
    return null;
  }
}
