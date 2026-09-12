// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { encodeBackup, decodeBackup, isGzip, formatBackupSize, compressionSupported } from './backup';

const snapshot = {
  format: 'pocketa.snapshot',
  version: 1,
  data: {
    transactions: Array.from({ length: 500 }, (_, i) => ({
      id: `txn_${i}`,
      date: '2026-09-01',
      merchant: 'Imtiaz',
      postings: [
        { id: `p${i}a`, accountId: 'acc_cash', amount: -1200, baseAmount: -1200 },
        { id: `p${i}b`, accountId: 'cat_food', amount: 1200, baseAmount: 1200 },
      ],
    })),
  },
};

describe('writing a backup', () => {
  it('produces a compressed file that is far smaller than the raw JSON', async () => {
    const { blob, filename, compressed } = await encodeBackup(snapshot, 'pocketa-backup-2026-09-06');
    expect(compressed).toBe(compressionSupported);

    if (compressionSupported) {
      expect(filename).toBe('pocketa-backup-2026-09-06.json.gz');
      const raw = JSON.stringify(snapshot).length;
      // Highly repetitive ledger data compresses hard; anything near the raw
      // size would mean compression silently did nothing.
      expect(blob.size).toBeLessThan(raw / 4);
    } else {
      expect(filename).toBe('pocketa-backup-2026-09-06.json');
    }
  });

  it('does not pretty-print, which nearly doubled the file for no reader', async () => {
    const { blob } = await encodeBackup({ a: 1, b: { c: 2 } }, 'x');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isGzip(bytes)) {
      expect(new TextDecoder().decode(bytes)).not.toMatch(/\n\s\s/);
    }
  });
});

describe('reading a backup', () => {
  it('round-trips a compressed backup exactly', async () => {
    const { blob } = await encodeBackup(snapshot, 'b');
    const decoded = await decodeBackup(blob);
    expect(decoded).toEqual(snapshot);
  });

  it('still opens a plain uncompressed backup from an earlier version', async () => {
    // A backup you cannot open is not a backup; older files must keep working.
    const legacy = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    expect(await decodeBackup(legacy)).toEqual(snapshot);
  });

  it('detects the format by content, not by file name', async () => {
    const { blob } = await encodeBackup(snapshot, 'b');
    // Renamed on the way through a cloud drive, as happens.
    const renamed = new Blob([await blob.arrayBuffer()], { type: 'text/plain' });
    expect(await decodeBackup(renamed)).toEqual(snapshot);
  });

  it('rejects a file that is neither', async () => {
    const junk = new Blob(['this is not a backup at all'], { type: 'text/plain' });
    await expect(decodeBackup(junk)).rejects.toThrow();
  });

  it('handles unicode in merchant names without mangling it', async () => {
    const withUnicode = { data: { merchants: ['کراچی', 'Café', '日本', '🧾'] } };
    const { blob } = await encodeBackup(withUnicode, 'u');
    expect(await decodeBackup(blob)).toEqual(withUnicode);
  });
});

describe('gzip detection', () => {
  it('recognises the magic bytes', () => {
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
    expect(isGzip(new Uint8Array([0x7b, 0x22, 0x61]))).toBe(false); // '{"a'
    expect(isGzip(new Uint8Array([]))).toBe(false);
    expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
  });
});

describe('size formatting', () => {
  it('reads the way a person expects', () => {
    expect(formatBackupSize(900)).toBe('900 B');
    expect(formatBackupSize(2048)).toBe('2 KB');
    expect(formatBackupSize(21 * 1024 * 1024)).toBe('21.0 MB');
  });
});
