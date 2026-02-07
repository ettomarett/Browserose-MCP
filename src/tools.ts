/**
 * Register MCP tools: list and call handler.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureBrowser, getPage, getContext } from "./browser.js";
import { snapshotMainFrame, snapshotMainFrameWithIframes, snapshotFrame, getChainedFrameLocator, getFrameViewportBbox, getFrameForSelector } from "./snapshot.js";
import { click, hover, type as typeAction, selectOption } from "./actions.js";

function toolResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError && { isError: true }) };
}

const TOOLS = [
  {
    name: "browser_snapshot",
    description: "Capture accessibility snapshot of the current page. Use for getting refs to interact with. Set includeFrames true to include iframe content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        includeFrames: { type: "boolean", description: "Include content of same-origin iframes", default: false },
      },
    },
  },
  {
    name: "browser_snapshot_frame",
    description: "Snapshot a single iframe by selector. Use ' >> ' for nested frames, e.g. iframe#pplayer_iframe >> iframe#modulePlayerIframe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "CSS selector for the iframe, or chained with ' >> ' for nested frames" },
      },
      required: ["frameSelector"],
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL to open" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_go_back",
    description: "Go back in history",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "browser_go_forward",
    description: "Go forward in history",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "browser_wait",
    description: "Wait for a number of seconds",
    inputSchema: {
      type: "object" as const,
      properties: {
        time: { type: "number", description: "Seconds to wait" },
      },
      required: ["time"],
    },
  },
  {
    name: "browser_click",
    description: "Click an element by ref from the snapshot. Use frameSelector for iframes; chain with ' >> ' for nested frames.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot" },
        frameSelector: { type: "string", description: "Optional. Iframe selector, e.g. iframe#id or iframe#a >> iframe#b for nested" },
      },
      required: ["ref"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into the focused element or into the element identified by ref. Use frameSelector for elements inside an iframe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to type" },
        ref: { type: "string", description: "Optional. Target element ref from snapshot" },
        frameSelector: { type: "string", description: "Optional. Iframe selector when target is inside an iframe" },
        submit: { type: "boolean", description: "Press Enter after typing", default: false },
      },
      required: ["text"],
    },
  },
  {
    name: "browser_hover",
    description: "Hover over an element by ref. Use frameSelector when target is inside an iframe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Element ref from snapshot" },
        frameSelector: { type: "string", description: "Optional. Iframe selector when target is inside an iframe" },
      },
      required: ["ref"],
    },
  },
  {
    name: "browser_select_option",
    description: "Select option(s) in a dropdown by ref. Use frameSelector when inside an iframe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "Select element ref from snapshot" },
        values: { type: "array", items: { type: "string" }, description: "Option value(s) to select" },
        frameSelector: { type: "string", description: "Optional. Iframe selector when target is inside an iframe" },
      },
      required: ["ref", "values"],
    },
  },
  {
    name: "browser_press_key",
    description: "Press a key (e.g. Enter, Tab, ArrowRight). Use frameSelector to send to an iframe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "Key to press, e.g. Enter, Tab, ArrowRight" },
        frameSelector: { type: "string", description: "Optional. Iframe selector to target the frame" },
      },
      required: ["key"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the page or of a specific iframe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Optional. Iframe selector to screenshot only that frame" },
      },
    },
  },
  {
    name: "browser_click_at",
    description: "Click at (x, y) relative to a frame's viewport. Use when snapshot/refs are unavailable (e.g. cross-origin or canvas). Chain frameSelector for nested frames.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Frame whose viewport (x,y) is relative to; use ' >> ' for nested" },
        x: { type: "number", description: "X offset from frame viewport left" },
        y: { type: "number", description: "Y offset from frame viewport top" },
        button: { type: "string", description: "left | right", default: "left" },
        clickCount: { type: "number", description: "Number of clicks", default: 1 },
      },
      required: ["frameSelector", "x", "y"],
    },
  },
  {
    name: "browser_click_locator",
    description: "Click by Playwright locator. Use frameSelector for iframes (e.g. iframe#a >> iframe#b); omit for main page. Provide one of: role+name, text, or css. No snapshot needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Optional. Chained iframe selector; omit to target main page" },
        role: { type: "string", description: "ARIA role, e.g. button, link" },
        name: { type: "string", description: "Accessible name (regex or string); use with role" },
        text: { type: "string", description: "Visible text to match (alternative to role+name)" },
        css: { type: "string", description: "CSS selector (e.g. input[type=email], button:has-text(\"Next\"))" },
        force: { type: "boolean", description: "Skip actionability checks", default: false },
        timeoutMs: { type: "number", description: "Timeout in ms", default: 10000 },
      },
    },
  },
  {
    name: "browser_type_locator",
    description: "Type text into an element found by locator. Omit frameSelector for main page. Provide one of: role+name, text, or css.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Optional. Iframe selector; omit for main page" },
        role: { type: "string", description: "ARIA role, e.g. textbox" },
        name: { type: "string", description: "Accessible name; use with role" },
        text: { type: "string", description: "Visible text to match" },
        css: { type: "string", description: "CSS selector, e.g. input[type=email]" },
        input: { type: "string", description: "Text to type into the element" },
        submit: { type: "boolean", description: "Press Enter after typing", default: false },
        timeoutMs: { type: "number", description: "Timeout in ms", default: 10000 },
      },
      required: ["input"],
    },
  },
  {
    name: "browser_list_clickables",
    description: "List visible clickable elements (buttons, links) in a frame. Use to discover what to click without snapshot. Works in cross-origin iframes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Chained iframe selector, e.g. iframe#pplayer_iframe >> iframe#modulePlayerIframe" },
        includeBoundingBox: { type: "boolean", description: "Include x,y,width,height for each", default: false },
        timeoutMs: { type: "number", description: "Timeout to resolve frame and elements", default: 10000 },
      },
      required: ["frameSelector"],
    },
  },
  {
    name: "browser_frame_probe",
    description: "Run a small diagnostic inside a frame: url, title, readyState, counts (buttons, clickables), textSample. Use to see if Playwright can see DOM (if probe fails or counts=0, UI may be canvas).",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Chained iframe selector, e.g. iframe#pplayer_iframe >> iframe#modulePlayerIframe" },
        timeoutMs: { type: "number", description: "Timeout to resolve frame", default: 10000 },
      },
      required: ["frameSelector"],
    },
  },
  {
    name: "browser_frame_bbox",
    description: "Get bounding box (x, y, width, height) of the frame in page coordinates. Use with browser_click_at or to compute relative clicks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Chained iframe selector; use ' >> ' for nested" },
      },
      required: ["frameSelector"],
    },
  },
  {
    name: "browser_click_at_rel",
    description: "Click at relative position (rx, ry) in [0..1] inside the frame. E.g. (0.5, 0.9) = center-bottom. Uses Playwright page.mouse.click for reliable coordinates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Chained iframe selector" },
        rx: { type: "number", description: "Relative X in 0..1 (0=left, 1=right)" },
        ry: { type: "number", description: "Relative Y in 0..1 (0=top, 1=bottom)" },
        button: { type: "string", description: "left | right", default: "left" },
      },
      required: ["frameSelector", "rx", "ry"],
    },
  },
  {
    name: "browser_frame_inventory",
    description: "Run inside the frame: list child iframes (id, name, src, rect), canvas elements (rect), count of open shadow roots, bodyRect. Use to see if visible UI is in a nested iframe or canvas.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Chained iframe selector" },
        timeoutMs: { type: "number", description: "Timeout to resolve frame", default: 10000 },
      },
      required: ["frameSelector"],
    },
  },
  {
    name: "browser_hit_test_rel",
    description: "Return element at relative (rx, ry) in [0..1] inside the frame via elementFromPoint. Returns tag, id, class, rect, pointerEvents, cursor; if iframe, includes src/name. Confirms where clicks land.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Chained iframe selector" },
        rx: { type: "number", description: "Relative X in 0..1" },
        ry: { type: "number", description: "Relative Y in 0..1" },
        timeoutMs: { type: "number", description: "Timeout to resolve frame", default: 10000 },
      },
      required: ["frameSelector", "rx", "ry"],
    },
  },
  {
    name: "browser_click_at_rel_debug",
    description: "Return frame screenshot plus exact page coordinates and in-frame pixel where click_at_rel(rx, ry) would click. No dot drawn; use to verify target.",
    inputSchema: {
      type: "object" as const,
      properties: {
        frameSelector: { type: "string", description: "Chained iframe selector" },
        rx: { type: "number", description: "Relative X in 0..1" },
        ry: { type: "number", description: "Relative Y in 0..1" },
      },
      required: ["frameSelector", "rx", "ry"],
    },
  },
];

export function registerTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args || {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "browser_snapshot": {
          const { page } = await ensureBrowser();
          const context = getContext();
          const includeFrames = Boolean(params.includeFrames);
          const text = includeFrames
            ? await snapshotMainFrameWithIframes(page, context)
            : (await snapshotMainFrame(page)).text;
          return toolResult(text);
        }
        case "browser_snapshot_frame": {
          const { page } = await ensureBrowser();
          const context = getContext();
          const frameSelector = String(params.frameSelector ?? "");
          if (!frameSelector) return toolResult("Missing frameSelector", true);
          // For chained selectors (nested iframes), try CDP first to avoid long evaluate timeouts on cross-origin frames
          const isChained = frameSelector.includes(">>");
          if (!isChained) {
            try {
              const result = await snapshotFrame(page, frameSelector);
              return toolResult(result.text);
            } catch {
              // fall through to CDP
            }
          }
          if (context) {
              try {
                const cdp = await context.newCDPSession(page);
                await cdp.send("Page.enable" as any);
                const tree = await cdp.send("Page.getFrameTree" as any);
                interface Ftn { id: string; childFrames?: { frame: Ftn }[] }
                const root = (tree as { frameTree?: { frame: Ftn } }).frameTree?.frame;
                let frameId: string | null = null;
                if (root) {
                  const list: string[] = [];
                  function collect(f: Ftn) {
                    list.push(f.id);
                    f.childFrames?.forEach((c) => collect(c.frame));
                  }
                  collect(root);
                  const idToSel = await import("./cdp.js").then((m) => m.buildFrameIdToSelector(cdp, list));
                  // For chained selectors (e.g. "iframe#a >> iframe#b"), match by the innermost part so CDP finds the nested frame
                  const selectorToMatch = frameSelector.includes(">>")
                    ? frameSelector.split(">>").map((s) => s.trim()).filter(Boolean).pop()!
                    : frameSelector;
                  for (const [fid, sel] of idToSel) {
                    if (sel === selectorToMatch || sel === frameSelector || (frameSelector === "iframe" && sel.startsWith("iframe"))) {
                      frameId = fid;
                      break;
                    }
                  }
                  if (!frameId && list.length > 1) frameId = list[1];
                }
                if (frameId) {
                  const cdpMod = await import("./cdp.js");
                  let cdpResult = await cdpMod.snapshotFrameViaCDP(cdp, frameId!, frameSelector, "f1e");
                  if (cdpResult.entries.size === 0) {
                    const domResult = await cdpMod.snapshotFrameViaDOMSnapshot(cdp, frameId!, frameSelector, "f1e", []);
                    if (domResult) cdpResult = domResult;
                  }
                  const entries = new Map<string, import("./snapshot.js").RefEntry>();
                  cdpResult.entries.forEach((e, ref) => {
                    entries.set(ref, {
                      role: e.role,
                      name: e.name,
                      frameId: e.frameId,
                      backendDOMNodeId: e.backendDOMNodeId,
                      viewportClickPoint: e.viewportClickPoint,
                    });
                  });
                  (await import("./snapshot.js")).setRefMap(frameSelector, entries);
                  (cdp as { detach?: () => Promise<void> }).detach?.().catch(() => {});
                  return toolResult(cdpResult.text);
                }
                (cdp as { detach?: () => Promise<void> }).detach?.().catch(() => {});
              } catch (_) {}
            }
          return toolResult(`Frame snapshot failed (cross-origin or invalid selector): ${frameSelector}`, true);
        }
        case "browser_navigate": {
          const { page } = await ensureBrowser();
          const url = String(params.url ?? "");
          if (!url) return toolResult("Missing url", true);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
          return toolResult(`Navigated to ${page.url()}`);
        }
        case "browser_go_back": {
          const p = getPage();
          if (!p) return toolResult("No page. Call browser_navigate first.", true);
          await p.goBack({ timeout: 10000 });
          return toolResult(`Went back to ${p.url()}`);
        }
        case "browser_go_forward": {
          const p = getPage();
          if (!p) return toolResult("No page. Call browser_navigate first.", true);
          await p.goForward({ timeout: 10000 });
          return toolResult(`Went forward to ${p.url()}`);
        }
        case "browser_wait": {
          const time = Number(params.time) || 1;
          await new Promise((r) => setTimeout(r, time * 1000));
          return toolResult(`Waited ${time}s`);
        }
        case "browser_click": {
          const { page } = await ensureBrowser();
          const context = getContext();
          const ref = String(params.ref ?? "");
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : undefined;
          if (!ref) return toolResult("Missing ref", true);
          await click(page, ref, frameSelector, context);
          return toolResult(`Clicked ${ref}`);
        }
        case "browser_type": {
          const { page } = await ensureBrowser();
          const text = String(params.text ?? "");
          const ref = params.ref != null ? String(params.ref) : undefined;
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : undefined;
          const submit = Boolean(params.submit);
          await typeAction(page, text, { ref, frameSelector, submit });
          return toolResult("Typed");
        }
        case "browser_hover": {
          const { page } = await ensureBrowser();
          const ref = String(params.ref ?? "");
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : undefined;
          if (!ref) return toolResult("Missing ref", true);
          await hover(page, ref, frameSelector);
          return toolResult(`Hovered ${ref}`);
        }
        case "browser_select_option": {
          const { page } = await ensureBrowser();
          const ref = String(params.ref ?? "");
          const values = Array.isArray(params.values) ? (params.values as string[]) : [String(params.values ?? "")];
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : undefined;
          if (!ref) return toolResult("Missing ref", true);
          await selectOption(page, ref, values, frameSelector);
          return toolResult("Selected option(s)");
        }
        case "browser_press_key": {
          const { page } = await ensureBrowser();
          const key = String(params.key ?? "Enter");
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : undefined;
          if (frameSelector) {
            const frame = getChainedFrameLocator(page, frameSelector);
            await frame.locator("body").press(key);
          } else {
            await page.keyboard.press(key);
          }
          return toolResult(`Pressed ${key}`);
        }
        case "browser_screenshot": {
          const { page } = await ensureBrowser();
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : undefined;
          let buffer: Buffer;
          if (frameSelector) {
            const frame = getChainedFrameLocator(page, frameSelector);
            const loc = frame.locator("body");
            buffer = await loc.screenshot({ timeout: 10000 });
          } else {
            buffer = await page.screenshot({ timeout: 10000 });
          }
          const base64 = buffer.toString("base64");
          return {
            content: [{ type: "image" as const, data: base64, mimeType: "image/png" }],
          };
        }
        case "browser_click_at": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          const x = Number(params.x);
          const y = Number(params.y);
          if (!frameSelector || Number.isNaN(x) || Number.isNaN(y)) {
            return toolResult("Missing frameSelector, x, or y", true);
          }
          const bbox = await getFrameViewportBbox(page, frameSelector);
          const pageX = bbox.x + x;
          const pageY = bbox.y + y;
          const button = (params.button === "right" ? "right" : "left") as "left" | "right";
          const clickCount = Math.max(1, Math.floor(Number(params.clickCount) || 1));
          await page.mouse.click(pageX, pageY, { button, clickCount });
          return toolResult(`Clicked at (${pageX}, ${pageY})`);
        }
        case "browser_click_locator": {
          const { page } = await ensureBrowser();
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : "";
          const timeoutMs = Number(params.timeoutMs) || 10000;
          const force = Boolean(params.force);
          const root = frameSelector
            ? getChainedFrameLocator(page, frameSelector)
            : (page as unknown as { getByRole: typeof page.getByRole; getByText: typeof page.getByText; locator: typeof page.locator });
          const role = params.role != null ? String(params.role) : undefined;
          const name = params.name != null ? String(params.name) : undefined;
          const text = params.text != null ? String(params.text) : undefined;
          const css = params.css != null ? String(params.css) : undefined;

          let locator: any;
          if (role !== undefined) {
            locator = name
              ? root.getByRole(role as "button" | "link" | "textbox", { name: new RegExp(name, "i") }).first()
              : root.getByRole(role as "button" | "link").first();
          } else if (text !== undefined) {
            locator = root.getByText(text, { exact: false }).first();
          } else if (css !== undefined) {
            locator = root.locator(css).first();
          } else {
            return toolResult("Provide one of: role (+ optional name), text, or css", true);
          }
          try {
            await locator.click({ timeout: timeoutMs, force });
            return toolResult(`Clicked (${role ? `role=${role}` : text !== undefined ? `text="${text}"` : `css=${css}`})`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toolResult(`Click failed: ${msg}`, true);
          }
        }
        case "browser_type_locator": {
          const { page } = await ensureBrowser();
          const frameSelector = params.frameSelector != null ? String(params.frameSelector) : "";
          const timeoutMs = Number(params.timeoutMs) || 10000;
          const root = frameSelector
            ? getChainedFrameLocator(page, frameSelector)
            : (page as unknown as { getByRole: typeof page.getByRole; getByText: typeof page.getByText; locator: typeof page.locator });
          const role = params.role != null ? String(params.role) : undefined;
          const name = params.name != null ? String(params.name) : undefined;
          const text = params.text != null ? String(params.text) : undefined;
          const css = params.css != null ? String(params.css) : undefined;
          const input = String(params.input ?? "");
          if (!input && !params.submit) return toolResult("Provide input text (or submit: true to press Enter)", true);
          let locator: any;
          if (role !== undefined) {
            locator = name
              ? root.getByRole(role as "textbox" | "searchbox", { name: new RegExp(name, "i") }).first()
              : root.getByRole(role as "textbox").first();
          } else if (text !== undefined) {
            locator = root.getByText(text, { exact: false }).first();
          } else if (css !== undefined) {
            locator = root.locator(css).first();
          } else {
            return toolResult("Provide one of: role (+ optional name), text, or css", true);
          }
          try {
            if (input) await locator.fill(input, { timeout: timeoutMs });
            if (params.submit) await locator.press("Enter", { timeout: timeoutMs });
            return toolResult(input ? `Typed ${input.length} chars` : "Pressed Enter");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toolResult(`Type failed: ${msg}`, true);
          }
        }
        case "browser_list_clickables": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          if (!frameSelector) return toolResult("Missing frameSelector", true);
          const timeoutMs = Number(params.timeoutMs) || 10000;
          const includeBoundingBox = Boolean(params.includeBoundingBox);
          const frame = getChainedFrameLocator(page, frameSelector);
          const selector =
            'button, a[href], [role="button"], [role="link"], input[type="submit"], input[type="button"]';
          const locator = frame.locator(selector);
          try {
            const all = await locator.all();
            const lines: string[] = [`Found ${all.length} clickable(s) in frame:`];
            for (let i = 0; i < all.length; i++) {
              const node = all[i];
              const text = await node.textContent().catch(() => null);
              const aria = await node.getAttribute("aria-label").catch(() => null);
              const disabled = await node.isDisabled().catch(() => true);
              const label = (aria ?? text ?? "").trim().slice(0, 100) || "(no text)";
              let line = `${i + 1}. "${label}" ${disabled ? "[disabled]" : "[enabled]"}`;
              if (includeBoundingBox) {
                const bbox = await node.boundingBox().catch(() => null);
                if (bbox) line += `  bbox: x=${Math.round(bbox.x)} y=${Math.round(bbox.y)} w=${Math.round(bbox.width)} h=${Math.round(bbox.height)}`;
              }
              lines.push(line);
            }
            return toolResult(lines.join("\n"));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toolResult(`List clickables failed: ${msg}`, true);
          }
        }
        case "browser_frame_probe": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          if (!frameSelector) return toolResult("Missing frameSelector", true);
          const timeoutMs = Number(params.timeoutMs) || 10000;
          try {
            const frame = await getFrameForSelector(page, frameSelector);
            if (!frame) return toolResult("Frame not found or not yet attached", true);
            const result = await frame.evaluate(() => {
              const body = document.body;
              const text = body?.innerText ?? "";
              return {
                url: window.location.href,
                title: document.title,
                readyState: document.readyState,
                buttons: document.querySelectorAll("button").length,
                clickables: document.querySelectorAll('a, button, input, [role="button"], [onclick], [tabindex]').length,
                textSample: text.slice(0, 200),
              };
            });
            return toolResult(JSON.stringify(result, null, 2));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toolResult(`Probe failed (frame may be cross-origin or not loaded): ${msg}`, true);
          }
        }
        case "browser_frame_bbox": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          if (!frameSelector) return toolResult("Missing frameSelector", true);
          try {
            const bbox = await getFrameViewportBbox(page, frameSelector);
            return toolResult(JSON.stringify({ x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toolResult(`bbox failed: ${msg}`, true);
          }
        }
        case "browser_click_at_rel": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          const rx = Number(params.rx);
          const ry = Number(params.ry);
          if (!frameSelector || Number.isNaN(rx) || Number.isNaN(ry)) {
            return toolResult("Missing frameSelector, rx, or ry", true);
          }
          const bbox = await getFrameViewportBbox(page, frameSelector);
          const x = bbox.x + Math.max(0, Math.min(1, rx)) * bbox.width;
          const y = bbox.y + Math.max(0, Math.min(1, ry)) * bbox.height;
          const button = (params.button === "right" ? "right" : "left") as "left" | "right";
          await page.mouse.click(x, y, { button });
          return toolResult(`Clicked at relative (${rx}, ${ry}) -> (${Math.round(x)}, ${Math.round(y)})`);
        }
        case "browser_frame_inventory": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          if (!frameSelector) return toolResult("Missing frameSelector", true);
          try {
            const frame = await getFrameForSelector(page, frameSelector);
            if (!frame) return toolResult("Frame not found or not yet attached", true);
            const result = await frame.evaluate(() => {
              const iframes = Array.from(document.querySelectorAll("iframe")).map((el, i) => {
                const r = el.getBoundingClientRect();
                return {
                  index: i,
                  id: el.id || null,
                  name: (el as HTMLIFrameElement).name || null,
                  src: (el as HTMLIFrameElement).src || null,
                  rect: { x: r.x, y: r.y, w: r.width, h: r.height },
                };
              });
              const canvas = Array.from(document.querySelectorAll("canvas")).map((el, i) => {
                const r = el.getBoundingClientRect();
                return { index: i, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
              });
              let shadowHosts = 0;
              document.querySelectorAll("*").forEach((el) => {
                if (el.shadowRoot) shadowHosts++;
              });
              const body = document.body;
              const docEl = document.documentElement;
              const bodyRect =
                body && docEl
                  ? { w: body.clientWidth, h: body.clientHeight, scrollHeight: docEl.scrollHeight }
                  : null;
              return { iframes, canvas, shadowHosts, bodyRect };
            });
            return toolResult(JSON.stringify(result, null, 2));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toolResult(`Inventory failed: ${msg}`, true);
          }
        }
        case "browser_hit_test_rel": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          const rx = Number(params.rx);
          const ry = Number(params.ry);
          if (!frameSelector || Number.isNaN(rx) || Number.isNaN(ry)) {
            return toolResult("Missing frameSelector, rx, or ry", true);
          }
          try {
            const frame = await getFrameForSelector(page, frameSelector);
            if (!frame) return toolResult("Frame not found", true);
            const result = await frame.evaluate(
              ({ rx: rxx, ry: ryy }) => {
                const x = rxx * window.innerWidth;
                const y = ryy * window.innerHeight;
                const el = document.elementFromPoint(x, y);
                if (!el) return { tag: null, id: null, className: null, rect: null, pointerEvents: null, cursor: null };
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const out: Record<string, unknown> = {
                  tag: el.tagName,
                  id: el.id || null,
                  className: (el as Element).className || null,
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  pointerEvents: style.pointerEvents,
                  cursor: style.cursor,
                };
                if (el.tagName === "IFRAME") {
                  const ifr = el as HTMLIFrameElement;
                  out.src = ifr.src || null;
                  out.name = ifr.name || null;
                }
                return out;
              },
              { rx, ry }
            );
            return toolResult(JSON.stringify(result, null, 2));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toolResult(`Hit test failed: ${msg}`, true);
          }
        }
        case "browser_click_at_rel_debug": {
          const { page } = await ensureBrowser();
          const frameSelector = String(params.frameSelector ?? "");
          const rx = Number(params.rx);
          const ry = Number(params.ry);
          if (!frameSelector || Number.isNaN(rx) || Number.isNaN(ry)) {
            return toolResult("Missing frameSelector, rx, or ry", true);
          }
          const bbox = await getFrameViewportBbox(page, frameSelector);
          const absX = bbox.x + Math.max(0, Math.min(1, rx)) * bbox.width;
          const absY = bbox.y + Math.max(0, Math.min(1, ry)) * bbox.height;
          const localX = Math.round(rx * bbox.width);
          const localY = Math.round(ry * bbox.height);
          const frame = getChainedFrameLocator(page, frameSelector);
          const buffer = await frame.locator("body").screenshot({ timeout: 10000 });
          const base64 = buffer.toString("base64");
          const text = `Relative (${rx}, ${ry}) → page coords (${Math.round(absX)}, ${Math.round(absY)}). In frame image: pixel (${localX}, ${localY}). Frame bbox: x=${bbox.x} y=${bbox.y} w=${bbox.width} h=${bbox.height}.`;
          return {
            content: [
              { type: "text" as const, text },
              { type: "image" as const, data: base64, mimeType: "image/png" },
            ],
          };
        }
        default:
          return toolResult(`Unknown tool: ${name}`, true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolResult(`Error: ${msg}`, true);
    }
  });
}
