import { NextRequest } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireUser, maybeRequireAppCheck, GuardError } from "@/lib/auth/guard";
import { getAdminStorage } from "@/lib/firebase/admin";
import { userAttachmentPath, maxAttachmentBytes, attachmentTypeFromMime } from "@/lib/storage/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  chatId: z.string().min(1),
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  size: z.number().int().min(1).max(40 * 1024 * 1024),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
    await maybeRequireAppCheck(req);
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    throw e;
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: "invalid_body", detail: String(e) }, { status: 400 });
  }

  const kind = attachmentTypeFromMime(body.contentType);
  if (!kind) return Response.json({ error: "unsupported_type" }, { status: 400 });
  if (body.size > maxAttachmentBytes(kind)) {
    return Response.json({ error: "too_large", maxBytes: maxAttachmentBytes(kind) }, { status: 413 });
  }

  const messageId = nanoid(12);
  const path = userAttachmentPath(user.uid, body.chatId, messageId, body.fileName);

  const bucket = getAdminStorage().bucket();
  const [uploadUrl] = await bucket.file(path).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 10 * 60 * 1000,
    contentType: body.contentType,
  });
  const [readUrl] = await bucket.file(path).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 24 * 60 * 60 * 1000,
  });

  return Response.json({
    storagePath: path,
    uploadUrl,
    downloadUrl: readUrl,
    method: "PUT",
    headers: { "Content-Type": body.contentType },
  });
}
