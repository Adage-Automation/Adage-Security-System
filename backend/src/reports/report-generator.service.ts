import { Injectable, InternalServerErrorException, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { renderMovementReportHtml } from './report.template';

interface MovementRow {
  movementAt: Date;
  movementType: 'ENTRY' | 'EXIT';
}

interface GenerateReportInput {
  companyName: string;
  employeeName: string;
  employeeCode: string;
  dateLabel: string;
  movements: MovementRow[];
}

@Injectable()
export class ReportGeneratorService implements OnModuleDestroy {
  // A launch costs real time and memory; reused across requests instead of
  // one-per-report (found in the 2026-09-09 audit — fine at low volume,
  // would degrade under concurrent "Email Details" clicks or a download
  // burst, and is a plausible OOM risk on a small hosting instance). Only
  // the page is opened/closed per call.
  private browserPromise: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox'] }).then((browser) => {
        // If the pooled browser dies mid-session (OOM kill, renderer
        // crash — more likely under the concurrent load this pooling
        // change specifically targets) rather than at launch, nothing
        // previously noticed: every later call kept returning the same
        // dead Browser, whose .newPage() rejects forever until the whole
        // Node process restarts. Found in the 2026-09-10 audit. Listening
        // for 'disconnected' clears the cache so the next call relaunches
        // instead of staying permanently broken.
        browser.on('disconnected', () => {
          if (this.browserPromise) {
            this.browserPromise = null;
          }
        });
        return browser;
      });
      // If launch itself fails, don't cache the rejected promise — the
      // next call should retry a fresh launch rather than fail forever.
      this.browserPromise.catch(() => {
        this.browserPromise = null;
      });
    }
    return this.browserPromise;
  }

  async onModuleDestroy() {
    const browser = await this.browserPromise?.catch(() => null);
    await browser?.close();
  }

  async generatePng(input: GenerateReportInput): Promise<Buffer> {
    const html = renderMovementReportHtml(input);
    const raw = await this.renderWithPuppeteer<Uint8Array>(html, async (page) => {
      // Extends vertically for long histories rather than shrinking text
      // (spec §35) — clip to the actual rendered content height.
      const bodyHandle = await page.$('body');
      const box = await bodyHandle?.boundingBox();
      if (!box) {
        // Not currently reachable (the template always renders a visible
        // body), but a failed layout/detached-frame race is a real
        // Puppeteer failure mode — fail clearly rather than crash on a
        // non-null assertion against `undefined`.
        throw new InternalServerErrorException('Failed to render report: page layout unavailable');
      }
      return page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: box.width, height: box.height },
      });
    });
    // Puppeteer returns a Uint8Array, not a true Node Buffer — Express's
    // res.send() silently JSON-serializes anything that fails
    // Buffer.isBuffer(), so this must be wrapped before it reaches a
    // controller, or "downloading" a report produces a JSON blob instead
    // of an image.
    return Buffer.from(raw);
  }

  async generatePdf(input: GenerateReportInput): Promise<Buffer> {
    const html = renderMovementReportHtml(input);
    const raw = await this.renderWithPuppeteer<Uint8Array>(html, (page) =>
      page.pdf({ printBackground: true, width: '720px', preferCSSPageSize: false }),
    );
    return Buffer.from(raw);
  }

  // How long a single report render may run before we give up on it and
  // treat the pooled browser as wedged. The 'disconnected' listener in
  // getBrowser() above only catches a browser that actually crashes —
  // it does nothing for one that's still technically connected but stuck
  // (a hung renderer, a page.setContent that never settles), which would
  // otherwise hang every future report request behind the same dead
  // instance with no way to notice. Found in the 2026-09-22 audit.
  private static readonly RENDER_TIMEOUT_MS = 30_000;

  private async renderWithPuppeteer<T>(html: string, action: (page: any) => Promise<T>, isRetry = false): Promise<T> {
    const browser = await this.getBrowser();
    let page: any;
    try {
      page = await browser.newPage();
    } catch (err) {
      // newPage() failing (as opposed to a clean 'disconnected' event) is
      // still a sign this pooled browser is unusable — discard it and
      // retry once with a freshly launched one rather than surfacing a
      // transient failure as a hard error.
      if (this.browserPromise) this.browserPromise = null;
      if (isRetry) throw err;
      return this.renderWithPuppeteer(html, action, true);
    }

    let timedOut = false;
    try {
      const result = await Promise.race([
        (async () => {
          await page.setContent(html, { waitUntil: 'networkidle0' });
          return action(page);
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            timedOut = true;
            reject(new InternalServerErrorException('Report generation timed out'));
          }, ReportGeneratorService.RENDER_TIMEOUT_MS),
        ),
      ]);
      return result;
    } catch (err) {
      // Only a timeout is treated as "this pooled browser may be wedged
      // for every future request too" — an ordinary render error (bad
      // input, a template bug) says nothing about the browser's health
      // and shouldn't force-relaunch it on every occurrence.
      if (timedOut && this.browserPromise) {
        void browser.close().catch(() => undefined);
        this.browserPromise = null;
      }
      throw err;
    } finally {
      // Close the page, not the browser — the browser instance is reused
      // across requests. Best-effort: if the browser itself is already
      // wedged/closed, this may also fail, which is fine — it's already
      // been discarded above in that case.
      await page.close().catch(() => undefined);
    }
  }
}
