"use client";

import { useState, useTransition, useEffect } from "react";
import { useTheme } from "next-themes";
import { Loader2, Save, Check } from "lucide-react";
import { toast } from "sonner";
import { authedFetch } from "@/components/auth-provider";
import { ModelPicker } from "@/components/chat/model-picker";
import { Segmented } from "@/components/ui/segmented";
import type { ThinkingMode, Theme } from "@/lib/types";

interface Props {
  initialDisplayName: string;
  initialLastModel: string;
  initialThinkingDefault: ThinkingMode;
  initialTheme: Theme;
}

export function SettingsForm({
  initialDisplayName,
  initialLastModel,
  initialThinkingDefault,
  initialTheme,
}: Props) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [lastModel, setLastModel] = useState(initialLastModel);
  const [thinking, setThinking] = useState<ThinkingMode>(initialThinkingDefault);
  const [theme, setLocalTheme] = useState<Theme>(initialTheme);
  const { setTheme: setNextTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setNextTheme(theme);
  }, [theme, setNextTheme]);

  function save() {
    startTransition(async () => {
      const res = await authedFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          lastModel,
          thinkingDefault: thinking,
          theme,
        }),
      });
      if (!res.ok) {
        toast.error("Could not save settings.");
        return;
      }
      setSavedAt(Date.now());
      toast.success("Settings saved.");
    });
  }

  return (
    <section className="card p-6 space-y-5">
      <h2 className="text-lg font-semibold tracking-tight">Preferences</h2>

      <div>
        <label className="text-sm font-medium">Display name</label>
        <input
          className="input mt-1.5"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          maxLength={80}
        />
      </div>

      <div>
        <label className="text-sm font-medium">Default model</label>
        <p className="text-xs mt-0.5" style={{ color: "rgb(var(--color-fg-muted))" }}>
          New chats will start with this model selected.
        </p>
        <div className="mt-2">
          <ModelPicker modelId={lastModel} onChange={setLastModel} />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">Default thinking depth</label>
        <p className="text-xs mt-0.5" style={{ color: "rgb(var(--color-fg-muted))" }}>
          Models that support reasoning traces will start at this level.
        </p>
        <div className="mt-2">
          <Segmented<ThinkingMode>
            value={thinking}
            onChange={setThinking}
            options={[
              { value: "off", label: "Off" },
              { value: "high", label: "Think" },
              { value: "max", label: "Max" },
            ]}
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">Theme</label>
        <div className="mt-2">
          <Segmented<Theme>
            value={theme}
            onChange={setLocalTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </div>
      </div>

      <div className="pt-2 flex items-center justify-end gap-2">
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="text-xs flex items-center gap-1" style={{ color: "rgb(var(--color-success))" }}>
            <Check className="h-3 w-3" />
            Saved
          </span>
        )}
        <button onClick={save} disabled={pending} className="btn btn-primary">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
      </div>
    </section>
  );
}
