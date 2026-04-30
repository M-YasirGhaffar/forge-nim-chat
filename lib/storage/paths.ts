export function userAttachmentPath(uid: string, chatId: string, messageId: string, fileName: string) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `users/${uid}/attachments/${chatId}/${messageId}/${safe}`;
}

export function generatedImagePath(uid: string, chatId: string, messageId: string) {
  return `users/${uid}/generated/${chatId}/${messageId}.png`;
}

export function maxAttachmentBytes(type: "image" | "video" | "pdf"): number {
  switch (type) {
    case "image":
      return 8 * 1024 * 1024;
    case "video":
      return 30 * 1024 * 1024;
    case "pdf":
      return 16 * 1024 * 1024;
  }
}

export function attachmentTypeFromMime(mime: string): "image" | "video" | "pdf" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return null;
}
