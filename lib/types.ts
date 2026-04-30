export type ThinkingMode = "off" | "high" | "max";
export type Theme = "light" | "dark" | "system";
export type UserTier = "free" | "early-supporter";

export type ModelCategory = "reasoning" | "multimodal" | "image";
export type ModelKind = "llm" | "vlm" | "image";

export interface ModelEntry {
  id: string;
  vendor: string;
  displayName: string;
  category: ModelCategory;
  kind: ModelKind;
  contextWindow: number;
  maxOutput: number;
  supportsImages: boolean;
  supportsVideo: boolean;
  supportsTools: boolean;
  supportsThinking: boolean;
  thinkingModes: ThinkingMode[];
  defaultThinking?: ThinkingMode;
  paramHint: string;
  paramCountB: number;
  activatedB?: number;
  license: string;
  licenseCommercial: boolean;
  tagline: string;
  notes?: string;
  endpoint: "chat" | "infer";
  recommendedTemperature?: number;
  recommendedTopP?: number;
  recommendedTopK?: number;
}

export type ArtifactType = "html" | "react" | "svg" | "mermaid" | "code" | "document";

export interface ArtifactRecord {
  id: string;
  type: ArtifactType;
  title: string;
  language?: string;
  body: string;
  version: number;
  createdAt: number;
  createdByMessageId?: string;
}

export type MessagePartType =
  | "text"
  | "image"
  | "file"
  | "reasoning"
  | "artifact-ref"
  | "tool-call"
  | "tool-result";

export interface MessagePart {
  type: MessagePartType;
  text?: string;
  storagePath?: string;
  downloadUrl?: string;
  mimeType?: string;
  fileName?: string;
  reasoningText?: string;
  durationMs?: number;
  artifactId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  parts: MessagePart[];
  model?: string;
  thinkingMode?: ThinkingMode | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  finishReason?: string | null;
  createdAt: number;
}

export interface ChatMeta {
  id: string;
  ownerId: string;
  title: string;
  modelLastUsed: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
}

export interface AttachmentRef {
  storagePath: string;
  downloadUrl: string;
  mimeType: string;
  fileName: string;
  type: "image" | "video" | "pdf";
  size: number;
}
