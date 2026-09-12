/**
 * Backup encoding.
 *
 * A full ledger with a few years of history serialises to tens of megabytes —
 * measured at 21 MB for 20,000 transactions, largely because it was being
 * pretty-printed. Backups are machine-read, so the whitespace bought nothing,
 * and gzip takes what remains down by roughly another order of magnitude.
 *
 * Restore sniffs the file rather than trusting its name, so a backup written by
 * an earlier version — plain, pretty-printed JSON — still restores. That
 * matters more than the compression does: a backup you cannot open is not a
 * backup.
 */

const GZIP_MAGIC = [0x1f, 0x8b];

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

export const compressionSupported =
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  // Built from the bytes directly rather than via Blob.stream(), which is
  // missing in some embedded webviews.
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export interface EncodedBackup {
  blob: Blob;
  filename: string;
  compressed: boolean;
}

/**
 * Serialise a snapshot for download.
 *
 * Falls back to plain JSON where compression is unavailable, so the export
 * always produces something restorable rather than failing.
 */
export async function encodeBackup(snapshot: unknown, baseName: string): Promise<EncodedBackup> {
  // No pretty-printing: nothing reads this by eye, and the indentation nearly
  // doubles the file.
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json) as Uint8Array<ArrayBuffer>;

  if (!compressionSupported) {
    return {
      blob: new Blob([bytes], { type: 'application/json' }),
      filename: `${baseName}.json`,
      compressed: false,
    };
  }

  const gzipped = await new Response(
    streamOf(bytes).pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();

  return {
    blob: new Blob([gzipped], { type: 'application/gzip' }),
    filename: `${baseName}.json.gz`,
    compressed: true,
  };
}

/**
 * Read a backup file, compressed or not.
 *
 * Detection is by content, not by extension, so a file renamed on the way
 * through a cloud drive still opens.
 */
export async function decodeBackup(file: Blob): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>;

  if (!isGzip(bytes)) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  if (!compressionSupported) {
    throw new Error('This browser cannot open compressed backups.');
  }

  const text = await new Response(
    streamOf(bytes).pipeThrough(new DecompressionStream('gzip')),
  ).text();
  return JSON.parse(text);
}

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
