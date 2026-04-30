"use client";

import { getClientAuth } from "@/lib/firebase/client";
import type { AttachmentRef } from "@/lib/types";
import { authedFetch } from "@/components/auth-provider";

interface UploadOpts {
  chatId: string;
  file: File;
}

export async function uploadAttachment(opts: UploadOpts): Promise<AttachmentRef> {
  const { chatId, file } = opts;
  const user = getClientAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  const idToken = await user.getIdToken();

  // Ask server for a signed upload URL + path.
  const sigRes = await authedFetch("/api/files", {
    method: "POST",
    idToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  if (!sigRes.ok) {
    const text = await sigRes.text().catch(() => "");
    throw new Error(`Could not get upload URL: ${text || sigRes.status}`);
  }
  const sig = await sigRes.json();

  // Upload directly to GCS via the signed PUT URL.
  const putRes = await fetch(sig.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

  // Determine kind.
  let kind: AttachmentRef["type"] = "image";
  if (file.type.startsWith("video/")) kind = "video";
  else if (file.type === "application/pdf") kind = "pdf";

  // For PDFs, parse text on the client and return as text-augmented file (we still
  // include the storagePath so the model can see the original if it accepts files).
  let extraText: string | undefined;
  if (kind === "pdf") {
    extraText = await extractPdfText(file).catch(() => undefined);
  }

  return {
    storagePath: sig.storagePath,
    downloadUrl: sig.downloadUrl,
    mimeType: file.type,
    fileName: file.name,
    type: kind,
    size: file.size,
    ...(extraText ? ({ pdfText: extraText } as object) : {}),
  } as AttachmentRef;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Workers in Next.js: use the bundled worker URL via dynamic import + new URL.
  // pdfjs-dist >= 4 ships an ESM worker.
  const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
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
