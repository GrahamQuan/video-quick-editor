import { useEffect, useState } from "react";
import type { ModelProfile, ModelProfiles, ModelUpdate } from "@video-quick-editor/shared";
import { useStore } from "./store.js";
import { copyFor } from "./i18n.js";
export function useModelProfiles() {
  const [profiles, setProfiles] = useState<ModelProfiles>({
    version: 1,
    revision: 0,
    profiles: [],
    selectedProfileId: null,
    error: null,
  });
  useEffect(() => {
    const update = (next: ModelProfiles) =>
      setProfiles((previous) => (next.revision < previous.revision ? previous : next));
    void window.videoQuickEditor.listModelProfiles().then(update);
    return window.videoQuickEditor.subscribeModelProfiles(update);
  }, []);
  return profiles;
}
const defaults = {
  baseURL: "https://api.deepseek.com",
  modelId: "deepseek-v4-flash",
  contextBudget: 16384,
};
export function ModelSettings(): React.JSX.Element {
  const { settings } = useStore();
  const copy = copyFor(settings?.language ?? "en");
  const collection = useModelProfiles();
  const [id, setId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [form, setForm] = useState<ModelUpdate>(defaults);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const current = collection.profiles.find((p) => p.id === id);
  const edit = (profile?: ModelProfile) => {
    setId(profile?.id);
    setName(profile?.name ?? "");
    setKey("");
    setStatus("");
    setForm(
      profile
        ? {
            provider: profile.provider,
            baseURL: profile.baseURL,
            modelId: profile.modelId,
            contextBudget: profile.contextBudget,
          }
        : defaults,
    );
  };
  const change = (patch: Partial<ModelUpdate>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setStatus("");
  };
  async function action(kind: "save" | "test" | "delete" | "key") {
    setBusy(true);
    setStatus("");
    const input = {
      ...form,
      ...(id ? { id } : {}),
      ...(key ? { apiKey: key } : {}),
      deleteKey: kind === "key",
    };
    try {
      if (kind === "test") {
        const result = await window.videoQuickEditor.testModelProfile(input);
        setStatus(result.message);
      } else if (kind === "delete" && id) {
        await window.videoQuickEditor.deleteModelProfile({
          id,
          expectedRevision: collection.revision,
        });
        edit();
        setStatus(copy.modelDeleted);
      } else {
        const next = await window.videoQuickEditor.saveModelProfile({
          ...input,
          name,
          expectedRevision: collection.revision,
        });
        const saved = next.profiles.find((p) => p.id === id) ?? next.profiles.at(-1);
        if (saved) edit(saved);
        setStatus(copy.modelSaved);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="model-settings">
      <h2>{copy.models}</h2>
      <p>OpenAI-compatible · Chat Completions</p>
      {collection.error && <p role="alert">{collection.error}</p>}
      <div className="model-profile-list">
        {collection.profiles.map((profile) => (
          <button
            key={profile.id}
            disabled={busy}
            onClick={() => edit(profile)}
            aria-pressed={id === profile.id}
          >
            <strong>{profile.name}</strong> · {profile.modelId} · {new URL(profile.baseURL).host}
            <small>
              {profile.id === collection.selectedProfileId ? copy.modelSelected : ""} ·{" "}
              {profile.hasApiKey ? copy.modelKeyReady : copy.modelKeyMissing}
            </small>
          </button>
        ))}
      </div>
      <button disabled={busy} onClick={() => edit()}>
        {copy.modelAdd}
      </button>
      <fieldset disabled={busy}>
        <label>
          {copy.modelName}
          <input
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
              setStatus("");
            }}
          />
        </label>
        <label>
          Base URL
          <input
            value={form.baseURL}
            onChange={(event) => change({ baseURL: event.target.value })}
          />
        </label>
        <label>
          Model ID
          <input
            value={form.modelId}
            onChange={(event) => change({ modelId: event.target.value })}
          />
        </label>
        <label>
          API key {current?.hasApiKey ? copy.modelKeepKey : ""}
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setStatus("");
            }}
          />
        </label>
        <label>
          {copy.modelBudget}
          <input
            type="number"
            min={8192}
            max={262144}
            value={form.contextBudget}
            onChange={(event) => change({ contextBudget: Number(event.target.value) })}
          />
        </label>
        <div className="model-actions">
          <button onClick={() => void action("test")}>{copy.modelTest}</button>
          <button disabled={!name.trim()} onClick={() => void action("save")}>
            {copy.modelSave}
          </button>
          <button disabled={!current} onClick={() => void action("key")}>
            {copy.modelDeleteKey}
          </button>
          <button disabled={!id} onClick={() => void action("delete")}>
            {copy.modelDelete}
          </button>
        </div>
      </fieldset>
      <p role="status">{status}</p>
    </section>
  );
}
