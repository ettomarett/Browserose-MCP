/**
 * Resolve ref to locator (main or frame) and perform click, type, hover, select.
 * Uses CDP click when ref has backendDOMNodeId (cross-origin iframe).
 */
import type { BrowserContext, Page } from "playwright";
import { getRefEntry, getChainedFrameLocator, getMainFrameKey } from "./snapshot.js";
import { clickViaCDP } from "./cdp.js";

function getLocatorForRef(
  page: Page,
  frameSelector: string | undefined,
  ref: string
): { locator: ReturnType<Page["getByRole"]>; frameKey: string } {
  const frameKey = frameSelector ?? getMainFrameKey();
  const entry = getRefEntry(frameKey, ref);
  if (!entry) throw new Error(`Ref not found: ${ref} (take a snapshot first)`);

  const role = entry.role as "button" | "link" | "textbox" | "checkbox" | "radio" | "combobox";
  const nameOpt = { name: entry.name };

  if (frameSelector) {
    const frame = getChainedFrameLocator(page, frameSelector);
    const locator = frame.getByRole(role, nameOpt).first();
    return { locator, frameKey };
  }
  const locator = page.getByRole(role, nameOpt).first();
  return { locator, frameKey };
}

export async function click(
  page: Page,
  ref: string,
  frameSelector?: string,
  context?: BrowserContext | null
): Promise<void> {
  const frameKey = frameSelector ?? getMainFrameKey();
  const entry = getRefEntry(frameKey, ref);
  if (!entry) throw new Error(`Ref not found: ${ref} (take a snapshot first)`);

  if (context && (entry.backendDOMNodeId != null || entry.viewportClickPoint != null)) {
    const cdp = await context.newCDPSession(page);
    try {
      if (entry.viewportClickPoint) {
        const { dispatchClickAtPoint } = await import("./cdp.js");
        await dispatchClickAtPoint(cdp, entry.viewportClickPoint.x, entry.viewportClickPoint.y);
      } else if (entry.backendDOMNodeId != null) {
        await clickViaCDP(cdp, entry.backendDOMNodeId);
      }
    } finally {
      (cdp as { detach?: () => Promise<void> }).detach?.().catch(() => {});
    }
    return;
  }

  const { locator } = getLocatorForRef(page, frameSelector, ref);
  await locator.click({ timeout: 10000 });
}

export async function type(
  page: Page,
  text: string,
  options: { ref?: string; frameSelector?: string; submit?: boolean }
): Promise<void> {
  if (options.ref) {
    const { locator } = getLocatorForRef(page, options.frameSelector, options.ref);
    await locator.fill(text);
    if (options.submit) await locator.press("Enter");
  } else {
    if (options.frameSelector) {
      const frame = getChainedFrameLocator(page, options.frameSelector);
      await frame.locator(":focus").fill(text).catch(() => {
        throw new Error("No focused element in frame; pass ref to target an input.");
      });
    } else {
      await page.keyboard.type(text, { delay: 0 });
    }
    if (options.submit) await page.keyboard.press("Enter");
  }
}

export async function hover(
  page: Page,
  ref: string,
  frameSelector?: string
): Promise<void> {
  const { locator } = getLocatorForRef(page, frameSelector, ref);
  await locator.hover({ timeout: 10000 });
}

export async function selectOption(
  page: Page,
  ref: string,
  values: string[],
  frameSelector?: string
): Promise<void> {
  const { locator } = getLocatorForRef(page, frameSelector, ref);
  await locator.selectOption(values, { timeout: 10000 });
}
