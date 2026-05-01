"use client";

import type { AttachmentRef } from "@/lib/types";
import { nanoid } from "nanoid";

interface UploadOpts {
  chatId: string;
  file: File;
}

/**
 * Inline-attachment pipeline. We deliberately do NOT use Cloud Storage — Firebase
 * Storage requires the Blaze (paid) plan since Oct 2024 and the upstream NIM chat
 * endpoints accept base64 `data:` URLs natively, so we encode small media into the
 * chat message itself.
 *
 * Constraints we honor:
 *   - Firestore document limit is 1 MB; we cap the encoded payload at ~700 KB to
 *     leave room for surrounding text + metadata. Images are downscaled + recoded
 *     as JPEG until they fit.
 *   - PDFs are parsed for text on the client (extractPdfText) and the parsed text
 *     is what reaches the model — the binary is not embedded.
 *   - Videos are typically far too large to inline; we accept them only when the
 *     raw size is below the inline cap.
 */

const INLINE_MAX_BYTES = 700_000;
const IMAGE_MAX_LONG_EDGE = 1568;

export async function uploadAttachment(opts: UploadOpts): Promise<AttachmentRef> {
  const { file } = opts;

  let kind: AttachmentRef["type"] = "image";
  if (file.type.startsWith("video/")) kind = "video";
  else if (file.type === "application/pdf") kind = "pdf";

  const id = nanoid(12);
  const storagePath = `inline://${id}/${file.name}`;

  if (kind === "image") {
    const { dataUrl, mimeType, byteLength } = await encodeImageInline(file);
    return {
      storagePath,
      downloadUrl: dataUrl,
      mimeType,
      fileName: file.name,
      type: "image",
      size: byteLength,
    };
  }

  if (kind === "video") {
    if (file.size > INLINE_MAX_BYTES) {
      throw new Error(
        `Video is ${(file.size / 1024).toFixed(0)} KB — must be under ${(INLINE_MAX_BYTES / 1024).toFixed(0)} KB to attach inline.`,
      );
    }
    const dataUrl = await readAsDataUrl(file);
    return {
      storagePath,
      downloadUrl: dataUrl,
      mimeType: file.type,
      fileName: file.name,
      type: "video",
      size: file.size,
    };
  }

  // PDF: extract text client-side. The model never sees the binary, so we don't
  // embed it; we still return an attachment ref so the chip renders, with an empty
  // downloadUrl. The PDF text is attached to the AttachmentRef as `pdfText` (read
  // by chat-shell when composing the outgoing message).
  const pdfText = await extractPdfText(file).catch(() => "");
  return {
    storagePath,
    downloadUrl: "",
    mimeType: file.type,
    fileName: file.name,
    type: "pdf",
    size: file.size,
    ...(pdfText ? ({ pdfText } as object) : {}),
  } as AttachmentRef;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Read an image file, optionally downscale to fit `IMAGE_MAX_LONG_EDGE`, and
 * re-encode as JPEG until the encoded size fits the inline cap. Walks quality
 * from 0.9 down to 0.55 in three steps before giving up.
 */
async function encodeImageInline(
  file: File,
): Promise<{ dataUrl: string; mimeType: string; byteLength: number }> {
  // GIF / SVG / animated formats lose semantics under canvas re-encode. Pass them
  // through verbatim if they already fit.
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    if (file.size > INLINE_MAX_BYTES) {
      throw new Error(
        `${file.type === "image/gif" ? "GIF" : "SVG"} is ${(file.size / 1024).toFixed(0)} KB — must be under ${(INLINE_MAX_BYTES / 1024).toFixed(0)} KB to attach inline.`,
      );
    }
    const dataUrl = await readAsDataUrl(file);
    return { dataUrl, mimeType: file.type, byteLength: file.size };
  }

  const bitmap = await createImageBitmap(file);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > IMAGE_MAX_LONG_EDGE ? IMAGE_MAX_LONG_EDGE / longEdge : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  for (const quality of [0.9, 0.75, 0.6]) {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    if (!blob) continue;
    if (blob.size <= INLINE_MAX_BYTES) {
      const dataUrl = await readAsDataUrl(blob);
      return { dataUrl, mimeType: "image/jpeg", byteLength: blob.size };
    }
  }

  throw new Error(
    `Image is too large to attach inline even after downscaling — try a smaller picture (under ~${(INLINE_MAX_BYTES / 1024).toFixed(0)} KB encoded).`,
  );
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: arrayBuf }).promise;
  const out: string[] = [];
  const limit = Math.min(doc.numPages, 20);
  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const text = tc.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    out.push(`--- Page ${p} ---\n${text}`);
  }
  if (doc.numPages > limit) out.push(`\n[…${doc.numPages - limit} more pages omitted]`);
  return out.join("\n\n").slice(0, 80_000);
}
