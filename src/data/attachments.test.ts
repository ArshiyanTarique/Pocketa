// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  prepareAttachment,
  encodeAttachment,
  decodeAttachment,
  blobToBase64,
  base64ToBlob,
  totalBytes,
  formatBytes,
  isImage,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from './attachments';
import type { Attachment } from '../core/types';

function makeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('accepting a file', () => {
  it('accepts a photographed receipt', async () => {
    const result = await prepareAttachment(makeFile('receipt.jpg', 'image/jpeg', 2048));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attachment.name).toBe('receipt.jpg');
      expect(result.attachment.size).toBe(2048);
      expect(result.attachment.blob).toBeInstanceOf(Blob);
    }
  });

  it('accepts a PDF invoice', async () => {
    const result = await prepareAttachment(makeFile('invoice.pdf', 'application/pdf', 4096));
    expect(result.ok).toBe(true);
  });

  it('falls back to the extension when the browser reports no type', async () => {
    const result = await prepareAttachment(makeFile('scan.png', '', 512));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachment.mimeType).toBe('image/png');
  });

  it('refuses an empty file rather than storing a useless record', async () => {
    const result = await prepareAttachment(makeFile('empty.jpg', 'image/jpeg', 0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });

  it('refuses a file over the per-file cap, and says the size', async () => {
    const result = await prepareAttachment(makeFile('huge.jpg', 'image/jpeg', MAX_FILE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/limit/i);
      expect(result.error).toMatch(/huge\.jpg/);
    }
  });

  it('refuses a type it cannot store', async () => {
    const result = await prepareAttachment(makeFile('ledger.exe', 'application/x-msdownload', 100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/photos and PDFs/i);
  });

  it('refuses once the total store cap would be passed', async () => {
    const result = await prepareAttachment(makeFile('one-more.jpg', 'image/jpeg', 1024), {
      usedBytes: MAX_TOTAL_BYTES,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Remove some older ones/i);
  });

  it('links to a transaction when one is supplied', async () => {
    const result = await prepareAttachment(makeFile('r.jpg', 'image/jpeg', 64), { txnId: 'txn_1' });
    expect(result.ok && result.attachment.txnId).toBe('txn_1');
  });
});

describe('backup encoding', () => {
  const attachment: Attachment = {
    id: 'att_1',
    txnId: 'txn_1',
    name: 'receipt.png',
    mimeType: 'image/png',
    size: 5,
    blob: new Blob([new Uint8Array([1, 2, 3, 250, 255])], { type: 'image/png' }),
    thumbnail: 'data:image/jpeg;base64,abc',
    createdAt: '2026-09-01T00:00:00Z',
  };

  it('round-trips a file through base64 without altering a byte', async () => {
    const encoded = await encodeAttachment(attachment);
    expect(typeof encoded.data).toBe('string');
    expect('blob' in encoded).toBe(false);

    const decoded = decodeAttachment(encoded);
    expect(decoded.blob).toBeInstanceOf(Blob);

    const original = new Uint8Array(await attachment.blob!.arrayBuffer());
    const restored = new Uint8Array(await decoded.blob!.arrayBuffer());
    expect([...restored]).toEqual([...original]);
    expect(decoded.thumbnail).toBe(attachment.thumbnail);
    expect(decoded.txnId).toBe('txn_1');
  });

  it('survives bytes across the whole 0-255 range', async () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const base64 = await blobToBase64(new Blob([all]));
    const back = new Uint8Array(await base64ToBlob(base64, 'application/octet-stream').arrayBuffer());
    expect([...back]).toEqual([...all]);
  });

  it('handles a file large enough to need chunked encoding', async () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    const base64 = await blobToBase64(new Blob([big]));
    const back = new Uint8Array(await base64ToBlob(base64, 'application/octet-stream').arrayBuffer());
    expect(back.length).toBe(big.length);
    expect(back[199_999]).toBe(big[199_999]);
  });

  it('encodes an attachment whose blob is missing, rather than throwing', async () => {
    const encoded = await encodeAttachment({ ...attachment, blob: null });
    expect(encoded.data).toBeNull();
    expect(decodeAttachment(encoded).blob).toBeNull();
  });
});

describe('helpers', () => {
  it('totals stored bytes', () => {
    expect(totalBytes([])).toBe(0);
    expect(
      totalBytes([
        { size: 100 } as Attachment,
        { size: 250 } as Attachment,
      ]),
    ).toBe(350);
  });

  it('formats sizes the way a person reads them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('distinguishes images from documents', () => {
    expect(isImage('image/png')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
  });
});
