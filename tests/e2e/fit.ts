import type { Page } from "@playwright/test";

/**
 * Horizontal overflow check used by every layout test. body has no overflow-x: hidden, so a wide
 * element really widens the document. Both the page and <main> must fit: main must exist.
 */
export async function overflowReport(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      mainExists: main !== null,
      mainFits: main !== null && main.scrollWidth <= main.clientWidth,
    };
  });
}

export const FITS = { pageFits: true, mainExists: true, mainFits: true } as const;
