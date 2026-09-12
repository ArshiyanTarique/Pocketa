// @vitest-environment jsdom
/**
 * Getting a file to the person who asked for it.
 *
 * The interesting cases are all failure cases: a browser that cannot share
 * files, a share that goes wrong, and — the one that matters most — a share the
 * person deliberately dismissed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deliverFile, deliverText } from './exchange';

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

/** Records anchor clicks, which is how a fallback download shows up. */
let downloads: string[];

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn(() => 'blob:stub');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function withShare(impl: (data: ShareData) => Promise<void>, canShare = true) {
  const share = vi.fn(impl);
  vi.stubGlobal('navigator', {
    ...navigator,
    share,
    canShare: vi.fn(() => canShare),
  });
  return share;
}

describe('delivering a file', () => {
  it('uses the share sheet when the device has one', async () => {
    const share = withShare(async () => {});

    const result = await deliverFile('pocketa.csv', new Blob(['a,b'], { type: 'text/csv' }));

    expect(result).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    const shared = share.mock.calls[0][0] as ShareData;
    expect(shared.files?.[0].name).toBe('pocketa.csv');
    expect(downloads).toEqual([]);
  });

  it('falls back to a download where files cannot be shared', async () => {
    withShare(async () => {}, false);

    const result = await deliverFile('pocketa.csv', new Blob(['a,b'], { type: 'text/csv' }));

    expect(result).toBe('downloaded');
    expect(downloads).toEqual(['pocketa.csv']);
  });

  it('falls back to a download when the browser has no share at all', async () => {
    vi.stubGlobal('navigator', { userAgent: 'test' });

    const result = await deliverFile('backup.json', new Blob(['{}'], { type: 'application/json' }));

    expect(result).toBe('downloaded');
    expect(downloads).toEqual(['backup.json']);
  });

  it('does nothing at all when the person dismisses the sheet', async () => {
    withShare(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });

    const result = await deliverFile('pocketa.csv', new Blob(['a,b'], { type: 'text/csv' }));

    // Answering "no thanks" by writing the file to Downloads anyway is the
    // opposite of what was asked.
    expect(result).toBe('cancelled');
    expect(downloads).toEqual([]);
  });

  it('still delivers the file when a share goes wrong for any other reason', async () => {
    withShare(async () => {
      throw new DOMException('Share target failed', 'DataError');
    });

    const result = await deliverFile('pocketa.csv', new Blob(['a,b'], { type: 'text/csv' }));

    expect(result).toBe('downloaded');
    expect(downloads).toEqual(['pocketa.csv']);
  });

  it('carries the text and its type through', async () => {
    const share = withShare(async () => {});

    await deliverText('pocketa.csv', 'date,amount\n2026-09-01,100', 'text/csv');

    const file = (share.mock.calls[0][0] as ShareData).files![0];
    expect(file.type).toContain('text/csv');
    expect(await file.text()).toContain('2026-09-01');
  });
});
