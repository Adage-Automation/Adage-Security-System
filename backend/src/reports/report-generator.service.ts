import { Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer';
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
export class ReportGeneratorService {
  async generatePng(input: GenerateReportInput): Promise<Buffer> {
    const html = renderMovementReportHtml(input);
    const raw = await this.renderWithPuppeteer<Uint8Array>(html, async (page) => {
      // Extends vertically for long histories rather than shrinking text
      // (spec §35) — clip to the actual rendered content height.
      const bodyHandle = await page.$('body');
      const box = await bodyHandle!.boundingBox();
      return page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: box!.width, height: box!.height },
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

  private async renderWithPuppeteer<T>(html: string, action: (page: any) => Promise<T>): Promise<T> {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      return await action(page);
    } finally {
      await browser.close();
    }
  }
}
