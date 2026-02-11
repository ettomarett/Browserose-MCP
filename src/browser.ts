/**
 * Browser state: launch Chrome (Playwright), one context, one page.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const HEADLESS = process.env.PLAYWRIGHT_MCP_HEADLESS === "1" || process.env.PLAYWRIGHT_MCP_HEADLESS === "true";
const USE_CHROMIUM = process.env.PLAYWRIGHT_MCP_USE_CHROMIUM === "1" || process.env.PLAYWRIGHT_MCP_USE_CHROMIUM === "true";

// Default: maximized. Set PLAYWRIGHT_MCP_VIEWPORT_MAXIMIZED=0 to use width/height instead.
const VIEWPORT_MAXIMIZED = process.env.PLAYWRIGHT_MCP_VIEWPORT_MAXIMIZED === "0" || process.env.PLAYWRIGHT_MCP_VIEWPORT_MAXIMIZED === "false"
  ? false
  : true;
const VIEWPORT_WIDTH = process.env.PLAYWRIGHT_MCP_VIEWPORT_WIDTH != null
  ? parseInt(process.env.PLAYWRIGHT_MCP_VIEWPORT_WIDTH, 10)
  : 1280;
const VIEWPORT_HEIGHT = process.env.PLAYWRIGHT_MCP_VIEWPORT_HEIGHT != null
  ? parseInt(process.env.PLAYWRIGHT_MCP_VIEWPORT_HEIGHT, 10)
  : 800;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

export async function ensureBrowser(): Promise<{ page: Page }> {
  if (page && !page.isClosed()) return { page };
  browser = null;
  context = null;
  page = null;

  const launchArgs = HEADLESS ? [] : ["--no-sandbox"];
  if (!HEADLESS && VIEWPORT_MAXIMIZED) launchArgs.push("--start-maximized");

  browser = await chromium.launch({
    headless: HEADLESS,
    ...(USE_CHROMIUM ? {} : { channel: "chrome" }),
    args: launchArgs,
  });

  const viewport = VIEWPORT_MAXIMIZED
    ? null
    : { width: Number.isNaN(VIEWPORT_WIDTH) ? 1280 : VIEWPORT_WIDTH, height: Number.isNaN(VIEWPORT_HEIGHT) ? 800 : VIEWPORT_HEIGHT };

  context = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: true,
  });

  // When "Go to activity" or any link opens a new tab, attach to it so tools operate on the new page
  context.on("page", (newPage: Page) => {
    page = newPage;
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
