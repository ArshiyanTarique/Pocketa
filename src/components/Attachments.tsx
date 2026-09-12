import * as React from 'react';
import { Camera, FileText, Paperclip, Trash2, X, Download, Share2 } from 'lucide-react';
import { Button, Notice } from '../ui/primitives';
import { Sheet, Confirm } from '../ui/Sheet';
import { cn } from '../ui/cn';
import { useStore } from '../store/useStore';
import {
  ACCEPT_ATTRIBUTE,
  attachmentUrl,
  formatBytes,
  isImage,
  MAX_FILE_BYTES,
} from '../data/attachments';
import { canShareFiles, deliverFile } from '../data/exchange';
import type { Attachment, ID } from '../core/types';

/**
 * Picking receipts.
 *
 * Two entry points because they are genuinely different actions: photographing
 * a paper receipt at the till, and attaching a PDF invoice later. On a phone the
 * camera button opens the camera directly rather than a file browser.
 */
export function AttachmentPicker({
  attachmentIds,
  onChange,
  txnId,
}: {
  attachmentIds: ID[];
  onChange: (ids: ID[]) => void;
  txnId?: ID | null;
}) {
  const attachments = useStore((s) => s.attachments);
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<Attachment | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);

  const mine = React.useMemo(
    () => attachments.filter((a) => attachmentIds.includes(a.id)),
    [attachments, attachmentIds],
  );

  async function take(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    const added: ID[] = [];
    for (const file of Array.from(files)) {
      const result = await addAttachment(file, txnId ?? null);
      if (result.ok && result.id) added.push(result.id);
      else if (result.error) setError(result.error);
    }
    if (added.length) onChange([...attachmentIds, ...added]);
    setBusy(false);
  }

  return (
    <div className="space-y-2.5">
      {mine.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {mine.map((attachment) => (
            <li key={attachment.id} className="group relative">
              <button
                type="button"
                onClick={() => setViewing(attachment)}
                className="block aspect-square w-full overflow-hidden rounded-[11px] border border-line bg-surface-2 transition-colors hover:border-accent"
                aria-label={`View ${attachment.name}`}
              >
                {attachment.thumbnail ? (
                  <img
                    src={attachment.thumbnail}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-1 text-ink-3">
                    <FileText className="size-5" />
                    <span className="px-1 text-[0.5625rem] leading-tight line-clamp-2">
                      {attachment.name}
                    </span>
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={async () => {
                  await removeAttachment(attachment.id);
                  onChange(attachmentIds.filter((x) => x !== attachment.id));
                }}
                aria-label={`Remove ${attachment.name}`}
                className={cn(
                  'absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full',
                  'border border-line bg-surface text-ink-3 shadow-[var(--shadow-sm)]',
                  'transition-colors hover:border-negative hover:text-negative',
                )}
              >
                <X className="size-3" strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={<Camera className="size-3.5" />}
          loading={busy}
          onClick={() => cameraRef.current?.click()}
        >
          Photo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={<Paperclip className="size-3.5" />}
          onClick={() => fileRef.current?.click()}
        >
          Attach a file
        </Button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void take(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void take(e.target.files);
          e.target.value = '';
        }}
      />

      {error && <Notice tone="negative">{error}</Notice>}

      <p className="text-xs text-ink-4">
        Photos and PDFs up to {formatBytes(MAX_FILE_BYTES)}. Receipts stay on this device.
      </p>

      {viewing && <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/**
 * Read-only receipts on a saved transaction.
 */
export function AttachmentStrip({ attachmentIds }: { attachmentIds: ID[] }) {
  const attachments = useStore((s) => s.attachments);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const [viewing, setViewing] = React.useState<Attachment | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<Attachment | null>(null);

  const mine = React.useMemo(
    () => attachments.filter((a) => attachmentIds.includes(a.id)),
    [attachments, attachmentIds],
  );

  if (mine.length === 0) return null;

  return (
    <section>
      <h3 className="eyebrow mb-2.5">
        {mine.length} receipt{mine.length === 1 ? '' : 's'}
      </h3>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {mine.map((attachment) => (
          <li key={attachment.id}>
            <button
              type="button"
              onClick={() => setViewing(attachment)}
              className="block aspect-square w-full overflow-hidden rounded-[11px] border border-line bg-surface-2 transition-colors hover:border-accent"
              aria-label={`View ${attachment.name}`}
            >
              {attachment.thumbnail ? (
                <img src={attachment.thumbnail} alt="" className="size-full object-cover" loading="lazy" />
              ) : (
                <span className="flex size-full flex-col items-center justify-center gap-1 text-ink-3">
                  <FileText className="size-5" />
                  <span className="px-1 text-[0.5625rem] leading-tight line-clamp-2">{attachment.name}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {viewing && (
        <AttachmentViewer
          attachment={viewing}
          onClose={() => setViewing(null)}
          onRemove={() => {
            setConfirmRemove(viewing);
            setViewing(null);
          }}
        />
      )}

      <Confirm
        open={confirmRemove != null}
        onClose={() => setConfirmRemove(null)}
        title="Remove this receipt?"
        tone="danger"
        confirmLabel="Remove"
        body="The file is deleted from this device permanently. The transaction itself is not affected."
        onConfirm={async () => {
          if (confirmRemove) await removeAttachment(confirmRemove.id);
          setConfirmRemove(null);
        }}
      />
    </section>
  );
}

/**
 * Full-size view.
 *
 * Object URLs are created on open and revoked on close, so viewing a hundred
 * receipts in a session does not leak a hundred blobs.
 */
function AttachmentViewer({
  attachment,
  onClose,
  onRemove,
}: {
  attachment: Attachment;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    const objectUrl = attachmentUrl(attachment);
    setUrl(objectUrl);
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);

  const sharing = React.useMemo(() => canShareFiles(), []);

  async function save() {
    // A receipt is the thing most likely to be wanted somewhere else — sent to
    // whoever is splitting the bill, or filed away — so it goes out the same
    // route as every other export.
    if (!attachment.blob) return;
    await deliverFile(attachment.name, attachment.blob);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={attachment.name}
      description={`${formatBytes(attachment.size)} · added ${attachment.createdAt.slice(0, 10)}`}
      size="lg"
      footer={
        <div className="flex gap-2.5">
          {onRemove && (
            <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={onRemove} className="text-negative">
              Remove
            </Button>
          )}
          <Button
            variant="secondary"
            full
            icon={sharing ? <Share2 className="size-4" /> : <Download className="size-4" />}
            onClick={() => void save()}
            disabled={!attachment.blob}
          >
            {sharing ? 'Share or save' : 'Save a copy'}
          </Button>
        </div>
      }
    >
      <div className="flex min-h-[12rem] items-center justify-center rounded-[--radius] border border-line bg-surface-2 p-2">
        {!url ? (
          <p className="p-8 text-sm text-ink-3">This file could not be opened.</p>
        ) : isImage(attachment.mimeType) ? (
          <img
            src={url}
            alt={attachment.name}
            className="max-h-[60dvh] w-auto rounded-[8px] object-contain"
          />
        ) : (
          <object data={url} type={attachment.mimeType} className="h-[60dvh] w-full rounded-[8px]">
            <div className="p-8 text-center">
              <FileText className="mx-auto mb-3 size-8 text-ink-3" />
              <p className="text-sm text-ink-2">
                This browser will not preview {attachment.mimeType} files.
              </p>
              <Button variant="secondary" className="mt-3" onClick={save}>
                Save a copy to open it
              </Button>
            </div>
          </object>
        )}
      </div>
    </Sheet>
  );
}
