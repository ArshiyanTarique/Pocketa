/**
 * Receipts and attachments.
 *
 * Files live as Blobs in IndexedDB alongside everything else, so a receipt is
 * as offline and as private as the transaction it belongs to — nothing is
 * uploaded anywhere.
 *
 * Two limits are enforced rather than hoped for: a per-file cap, and a total
 * store cap. A finance app that silently fills a phone's storage until the
 * browser starts evicting data would be losing the user's records, which is the
 * one thing it must never do.
 */

import { nowIso } from '../core/dates';
import { newId } from '../core/ids';
import type { Attachment, ID } from '../core/types';

/** Per file. Big enough for a photographed receipt, small enough to be sane. */
export const MAX_FILE_BYTES = 6 * 1024 * 1024;

/** Across every attachment. Beyond this the app asks the user to prune. */
export const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

export const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
];

export const ACCEPT_ATTRIBUTE = 'image/*,application/pdf';

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

export interface AttachOptions {
  txnId?: ID | null;
  /** Current total bytes already stored, for the cap check. */
  usedBytes?: number;
}

/**
 * Turn a picked file into a stored attachment.
 *
 * Rejects rather than truncates: a half-saved receipt is worse than a refused
 * one, because the user would believe they had a record they do not have.
 */
export async function prepareAttachment(
  file: File,
  opts: AttachOptions = {},
): Promise<AttachResult> {
  if (file.size === 0) {
    return { ok: false, error: `"${file.name}" is empty.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.`,
    };
  }
  const type = file.type || guessType(file.name);
  if (!ACCEPTED_TYPES.includes(type)) {
    return {
      ok: false,
      error: `Pocketa stores photos and PDFs. "${file.name}" is ${type || 'an unknown type'}.`,
    };
  }
  const used = opts.usedBytes ?? 0;
  if (used + file.size > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `That would take receipts past ${formatBytes(MAX_TOTAL_BYTES)}. Remove some older ones first.`,
    };
  }

  return {
    ok: true,
    attachment: {
      id: newId('att'),
      txnId: opts.txnId ?? null,
      name: file.name || 'Receipt',
      mimeType: type,
      size: file.size,
      blob: file,
      thumbnail: await makeThumbnail(file, type),
      createdAt: nowIso(),
    },
  };
}

function guessType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
  };
  return map[ext] ?? '';
}

/**
 * A small inline preview so a list of receipts does not have to hold every full
 * image in memory. Returns null when the format cannot be decoded — HEIC on most
 * desktop browsers, and every PDF — and the UI shows a file icon instead.
 */
async function makeThumbnail(file: Blob, type: string): Promise<string | null> {
  if (!isImage(type)) return null;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 240;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    // An undecodable image is not an error worth surfacing; it just has no preview.
    return null;
  }
}

/** A URL for viewing a stored attachment. The caller must revoke it. */
export function attachmentUrl(attachment: Attachment): string | null {
  if (!attachment.blob) return null;
  return URL.createObjectURL(attachment.blob);
}

// ---------------------------------------------------------------------------
// Backup encoding
// ---------------------------------------------------------------------------

export interface EncodedAttachment extends Omit<Attachment, 'blob'> {
  /** Base64 of the file contents. Absent when receipts were excluded. */
  data: string | null;
}

export async function encodeAttachment(attachment: Attachment): Promise<EncodedAttachment> {
  const { blob, ...rest } = attachment;
  return { ...rest, data: blob ? await blobToBase64(blob) : null };
}

export function decodeAttachment(encoded: EncodedAttachment): Attachment {
  const { data, ...rest } = encoded;
  return { ...rest, blob: data ? base64ToBlob(data, encoded.mimeType) : null };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked so a large file does not blow the argument limit of fromCharCode.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Total bytes held, for the cap check and the storage readout in Settings. */
export function totalBytes(attachments: readonly Attachment[]): number {
  return attachments.reduce((sum, a) => sum + (a.size || 0), 0);
}

/**
 * How much room the browser will actually give us.
 *
 * Reported so a user can see the ceiling before they hit it, rather than
 * discovering it when a save fails.
 */
export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { used: usage, quota };
  } catch {
    return null;
  }
}

/**
 * Ask the browser to stop evicting this origin under storage pressure.
 *
 * Best-effort: browsers grant it on their own terms. Worth requesting for an
 * app whose whole premise is that the data stays on the device.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
