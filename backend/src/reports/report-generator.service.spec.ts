import { ReportGeneratorService } from './report-generator.service';
import puppeteer from 'puppeteer';

// Mocks the launched browser's shape just enough to exercise the pooling/
// retry/timeout logic in renderWithPuppeteer — real rendering is covered
// by manual/Puppeteer-driven verification, not unit tests.
jest.mock('puppeteer', () => ({
  launch: jest.fn(),
}));
const launch = jest.mocked(puppeteer.launch);

function makePage(overrides: Partial<any> = {}) {
  return {
    setContent: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    $: jest.fn(),
    pdf: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    ...overrides,
  };
}

function makeBrowser(overrides: Partial<any> = {}) {
  const listeners: Record<string, () => void> = {};
  return {
    newPage: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    emitDisconnected: () => listeners['disconnected']?.(),
    ...overrides,
  };
}

const input = { companyName: 'Adage', employeeName: 'Test', employeeCode: 'E1', dateLabel: 'Today', movements: [] };

describe('ReportGeneratorService pooling/retry/timeout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retries once with a fresh browser if newPage() fails on the pooled instance', async () => {
    const badBrowser = makeBrowser({ newPage: jest.fn().mockRejectedValue(new Error('crashed')) });
    const goodPage = makePage();
    const goodBrowser = makeBrowser({ newPage: jest.fn().mockResolvedValue(goodPage) });
    launch.mockResolvedValueOnce(badBrowser as any).mockResolvedValueOnce(goodBrowser as any);

    const service = new ReportGeneratorService();
    const result = await service.generatePdf(input);

    expect(launch).toHaveBeenCalledTimes(2);
    expect(goodBrowser.newPage).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('discards the pooled browser after a render timeout, so the next call launches a fresh one', async () => {
    jest.useFakeTimers();
    // A page whose setContent never resolves — simulates a wedged renderer.
    const hungPage = makePage({ setContent: jest.fn(() => new Promise(() => undefined)) });
    const hungBrowser = makeBrowser({ newPage: jest.fn().mockResolvedValue(hungPage) });
    const freshPage = makePage();
    const freshBrowser = makeBrowser({ newPage: jest.fn().mockResolvedValue(freshPage) });
    launch.mockResolvedValueOnce(hungBrowser as any).mockResolvedValueOnce(freshBrowser as any);

    const service = new ReportGeneratorService();
    const firstCall = service.generatePdf(input);
    // Suppress the unhandled-rejection warning until we actually await it below.
    firstCall.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(30_000);
    await expect(firstCall).rejects.toThrow('Report generation timed out');
    expect(hungBrowser.close).toHaveBeenCalledTimes(1);

    const secondPageContent = freshPage.setContent as jest.Mock;
    secondPageContent.mockResolvedValue(undefined);
    await service.generatePdf(input);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(freshBrowser.newPage).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('does NOT discard the pooled browser for an ordinary render error (not a timeout)', async () => {
    const page = makePage();
    const browser = makeBrowser({ newPage: jest.fn().mockResolvedValue(page) });
    launch.mockResolvedValue(browser as any);

    const service = new ReportGeneratorService();
    // generatePng throws InternalServerErrorException itself if body
    // bounding box is unavailable — page.$('body') resolving to a handle
    // whose boundingBox() returns null triggers that path without any
    // Puppeteer failure at all.
    (page.$ as jest.Mock).mockResolvedValue({ boundingBox: jest.fn().mockResolvedValue(null) });

    await expect(service.generatePng(input)).rejects.toThrow('Failed to render report');
    expect(browser.close).not.toHaveBeenCalled();

    // A second call reuses the SAME pooled browser (no relaunch).
    (page.$ as jest.Mock).mockResolvedValue({ boundingBox: jest.fn().mockResolvedValue({ width: 10, height: 10 }) });
    (page as any).screenshot = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    await service.generatePng(input);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
