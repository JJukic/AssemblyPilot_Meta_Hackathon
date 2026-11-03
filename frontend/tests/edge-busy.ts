import type { Locator, Page, Response } from "@playwright/test";

/**
 * `/api/vision/edges` is single-flight on the backend: a concurrent extraction
 * answers HTTP 429 "Edge extraction is busy. Please retry shortly." (by design).
 * Parallel Playwright workers share that one backend, so a test can legitimately
 * hit 429. Like a user, retry the same button (bounded) until a real result arrives.
 */
export async function detectEdges(page: Page, button: Locator, attempts = 20): Promise<Response> {
  for (let i = 1; ; i++) {
    const response = page.waitForResponse("**/api/vision/edges");
    await button.click();
    const result = await response;
    if (result.status() !== 429 || i >= attempts) return result;
    await page.waitForTimeout(150 * i);
  }
}
