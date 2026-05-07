import { chromium, Page } from "playwright";

export type ScrapeOptions = {
  timeoutMs?: number;
  retryTimeoutMs?: number;
};

export async function scrapeUrl(url: string, options: ScrapeOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryTimeoutMs = options.retryTimeoutMs ?? 60_000;

  try {
    return await scrapeUrlOnce(url, timeoutMs);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw error;
    }
    return scrapeUrlOnce(url, retryTimeoutMs);
  }
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function scrapeUrlOnce(url: string, timeoutMs: number) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROME_CHANNEL === "chrome"
      ? { channel: "chrome" as const }
      : {})
  });
  try {
    const context = await browser.newContext({
      userAgent: process.env.RAG_SCRAPER_USER_AGENT ?? DEFAULT_USER_AGENT,
      locale: "en-IN",
      extraHTTPHeaders: {
        "Accept-Language": "en-IN,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    const status = response?.status();
    if (status === 404) {
      throw new Error(`Source URL returned 404: ${url}`);
    }
    if (status && status >= 400) {
      throw new Error(`Source URL returned HTTP ${status}: ${url}`);
    }

    await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, timeoutMs) }).catch(() => {
      // Dynamic pages can keep background requests open; DOM text is enough for ingestion.
    });

    await expandInteractiveSections(page);

    const text = await page.evaluate(() => {
      const removableSelectors = [
        "script", "style", "noscript", "svg", "img",
        "header", "footer", "nav",
        '[class*="footer"]',
        '[class*="Footer"]',
        '[data-testid="footer"]',
        '[class*="breadcrumb"]',
        '[class*="Breadcrumb"]'
      ];
      for (const selector of removableSelectors) {
        document.querySelectorAll(selector).forEach((node) => node.remove());
      }

      const main = document.querySelector("main");
      const mainText = (main?.innerText ?? "").trim();
      if (mainText.length > 400) {
        return mainText;
      }
      const article = document.querySelector("article");
      const articleText = (article?.innerText ?? "").trim();
      if (articleText.length > 400) {
        return articleText;
      }
      const roleMain = document.querySelector('[role="main"]');
      const roleMainText = ((roleMain as HTMLElement | null)?.innerText ?? "").trim();
      if (roleMainText.length > 400) {
        return roleMainText;
      }

      return document.body?.innerText?.trim() ?? "";
    });

    const compact = text.replace(/[ \t]+/g, " ").trim();
    if (!compact) {
      throw new Error(`No readable text found at ${url}`);
    }

    return compact;
  } finally {
    await browser.close();
  }
}

async function expandInteractiveSections(page: Page): Promise<void> {
  // 1. Click "See All" to expose all holdings
  const seeAllButton = page.locator('text="See All"').first();
  if (await seeAllButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await seeAllButton.click();
    await page.waitForTimeout(1500);
  }

  // 2. Click "Absolute returns" tab to expose both return tables
  const absoluteTab = page.locator('text="Absolute returns"').first();
  if (await absoluteTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await absoluteTab.click();
    await page.waitForTimeout(1000);
  }

  // 3. Expand all "Read more" toggles in the About/objective section
  const readMoreButtons = page.locator('text=/Read\\s*more/i');
  const readMoreCount = await readMoreButtons.count();
  for (let i = 0; i < readMoreCount; i++) {
    await readMoreButtons.nth(i).click().catch(() => {});
  }
  if (readMoreCount > 0) {
    await page.waitForTimeout(500);
  }

  // 4. Expand "Holding Analysis" and "Advanced Ratios" accordions/tabs
  for (const label of ["Holding Analysis", "Advanced Ratios"]) {
    const trigger = page.locator(`text="${label}"`).first();
    if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await trigger.click();
      await page.waitForTimeout(1000);
    }
  }
}

function isNotFoundError(error: unknown) {
  return error instanceof Error && error.message.includes("returned 404");
}
