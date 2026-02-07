/**
 * Browser state: launch Chrome (Playwright), one context, one page.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const HEADLESS = process.env.PLAYWRIGHT_MCP_HEADLESS === "1" || process.env.PLAYWRIGHT_MCP_HEADLESS === "true";
const USE_CHROMIUM = process.env.PLAYWRIGHT_MCP_USE_CHROMIUM === "1" || process.env.PLAYWRIGHT_MCP_USE_CHROMIUM === "true";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

export async function ensureBrowser(): Promise<{ page: Page }> {
  if (page) return { page };

  browser = await chromium.launch({
    headless: HEADLESS,
    ...(USE_CHROMIUM ? {} : { channel: "chrome" }),
    args: HEADLESS ? [] : ["--no-sandbox"],
  });

  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  page = await context.newPage();
  return { page };
}

export function getPage(): Page | null {
  return page;
}

export function getContext(): BrowserContext | null {
  return context;
}

export function getBrowser(): Browser | null {
  return browser;
}

export async function getFrameLocator(frameSelector: string): Promise<ReturnType<Page["frameLocator"]> | null> {
  const p = getPage();
  if (!p) return null;
  return p.frameLocator(frameSelector);
}

export async function closeBrowser(): Promise<void> {
  if (context) await context.close().catch(() => {});
  context = null;
  page = null;
  if (browser) await browser.close().catch(() => {});
  browser = null;
}
