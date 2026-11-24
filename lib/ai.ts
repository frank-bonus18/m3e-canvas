import { Doc, Frame, Group, Item, frameOfGroup } from "./tokens";
import { buildPrompt } from "./prompt";
import { isProject } from "./project";
import { Lang } from "./i18n";

/* Optional AI helpers. The browser talks to the model provider directly with the
 * author's own key; there is no server in between. Every action has a fixed
 * prompt and a fixed JSON answer shape, and the result is only applied after the
 * author has looked at it. Coordinates are never touched by the model. */

export type Provider = "claude" | "openai" | "gemini" | "deepseek";

export type AiSettings = {
  provider: Provider;
  baseUrl: string;
  model: string;
  key: string;
};

export const PROVIDERS: { key: Provider; label: string; baseUrl: string; model: string; keysUrl?: string }[] = [
  { key: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna", keysUrl: "https://platform.openai.com/api-keys" },
  { key: "claude", label: "Claude", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5", keysUrl: "https://console.anthropic.com/settings/keys" },
  { key: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", keysUrl: "https://aistudio.google.com/apikey" },
  { key: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", keysUrl: "https://platform.deepseek.com/api_keys" },
];

export const providerSpec = (k: Provider) => PROVIDERS.find((p) => p.key === k) ?? PROVIDERS[0];

/* 推理模型（DeepSeek 的 deepseek-flash / deepseek-v4-pro）把思考过程也算进
   max_tokens：思考写完了正文就没了，接口回 finish_reason=length、content 为空。
   旧上限 8192 在几屏的设计上会稳定踩到，所以放到 32768。这只是上限，
   不会因为调高而多花钱，但足够装下思考 + 正文。 */
const MAX_OUT = 32768;

export const DEFAULT_AI: AiSettings = { provider: PROVIDERS[0].key, baseUrl: PROVIDERS[0].baseUrl, model: PROVIDERS[0].model, key: "" };

const STORE_KEY = "m3e:ai";

export function loadAiSettings(): AiSettings {
  const s = { ...DEFAULT_AI };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<AiSettings>;
      if (PROVIDERS.some((p) => p.key === v.provider)) s.provider = v.provider as Provider;
      if (typeof v.baseUrl === "string") s.baseUrl = v.baseUrl;
      if (typeof v.model === "string") s.model = v.model;
      if (typeof v.key === "string") s.key = v.key;
    }
  } catch {}
  /* 旧版本存下来的模型名可能属于另一家服务：切了 provider 却留下上一家的 model，
     对方会以 400（不支持的模型）拒掉，界面只显示「AI 请求失败」。按已知前缀纠正一次。 */
  s.model = normaliseModel(s.provider, s.baseUrl, s.model);
  return s;
}

/** 这家服务官方接口的域名。只有指到官方接口时才敢纠正模型名 —— */
const OFFICIAL_HOST: Record<Provider, string> = {
  openai: "api.openai.com",
  claude: "api.anthropic.com",
  gemini: "generativelanguage.googleapis.com",
  deepseek: "api.deepseek.com",
};

/** 模型名各家的前缀：用来认出「这个模型属于别家」。 */
const MODEL_OWNER: [Provider, RegExp][] = [
  ["openai", /^(gpt-|o\d|chatgpt-|text-|davinci)/i],
  ["claude", /^claude/i],
  ["gemini", /^(gemini|models\/gemini)/i],
  ["deepseek", /^deepseek/i],
];

/** 清掉「这家 provider + 别家模型名」的组合。

 *  只有 baseUrl 指向该 provider 的官方接口时才纠正；填了自建网关的一律原样返回，
 *  因为网关上叫什么名字都是合理的。空模型名回落到这家服务的默认值。 */
export function normaliseModel(provider: Provider, baseUrl: string, model: string): string {
  const m = (model ?? "").trim();
  if (!m) return providerSpec(provider).model;
  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return m;
  }
  if (host !== OFFICIAL_HOST[provider]) return m;
  const owner = MODEL_OWNER.find(([, re]) => re.test(m))?.[0];
  if (!owner || owner === provider) return m;
  return providerSpec(provider).model;
}

/** Settings live in this browser only, like the document itself. */
export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {}
}

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u.trim());

/** a hosted endpoint needs a key; a server on this machine may run without one */
export const hasKey = (s: AiSettings) => s.key.trim().length > 0 || isLocal(s.baseUrl);

/** the key must not travel over plain http, except to this machine */
export const isSecureUrl = (u: string) => /^https:\/\//i.test(u.trim()) || isLocal(u);

const trimSlash = (u: string) => u.trim().replace(/\/+$/, "");

async function readError(res: Response): Promise<string> {
  let detail = "";
  try {
    const j = await res.json();
    detail = j?.error?.message ?? j?.message ?? JSON.stringify(j);
  } catch {
    try {
      detail = await res.text();
    } catch {}
  }
  return `${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ""}`;
}

/** one round trip: a system prompt and a user message in, the model's text out */
export async function complete(s: AiSettings, system: string, user: string, signal?: AbortSignal, maxTokens = 4096): Promise<string> {
  const base = trimSlash(s.baseUrl);
  const model = s.model.trim();
  if (!model) throw new Error("model");
  if (!isSecureUrl(base)) throw new Error("insecure");
  if (s.provider === "claude") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": s.key.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: Math.min(maxTokens, MAX_OUT), system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const j = await res.json();
    if (j.stop_reason === "refusal") throw new Error("refusal");
    if (j.stop_reason === "max_tokens") throw new Error("long");
    return (j.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (s.key.trim()) headers.authorization = `Bearer ${s.key.trim()}`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      model,
      /* OpenAI's newer models refuse `max_tokens` and default generously, so they get no budget;
         the other compatible endpoints cap around 8k */
      ...(s.provider === "openai" ? {} : { max_tokens: Math.min(maxTokens, MAX_OUT) }),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const j = await res.json();
  const choice = j.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("long");
  const c = choice?.message?.content;
  if (typeof c === "string" && c.trim()) return c;
  if (Array.isArray(c)) {
    const text = c.map((x: { text?: string }) => x.text ?? "").join("");
    if (text.trim()) return text;
  }
  /* 正文空但思考有内容：预算被思考吃光。报「太长」比报「读不懂」更接近真相。 */
  if (typeof choice?.message?.reasoning_content === "string" && choice.message.reasoning_content) throw new Error("long");
  throw new Error("empty");
}

/** the first JSON object in a reply; code fences are stripped only when the
 *  reply does not parse as it stands, so backticks inside a value survive. */
function parseJsonObject(text: string): Record<string, unknown> {
  const objectIn = (source: string): Record<string, unknown> => {
    const a = source.indexOf("{");
    const b = source.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("json");
    const v = JSON.parse(source.slice(a, b + 1));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("json");
    return v as Record<string, unknown>;
  };
  try {
    return objectIn(text);
  } catch {
    return objectIn(text.replace(/```(?:json)?/gi, ""));
  }
}

/* ---------- actions ---------- */

const LANG_NAME: Record<Lang, string> = { ja: "Japanese", en: "English", zh: "Simplified Chinese", ko: "Korean" };

const hasText = (v?: string | null) => !!v && v.trim().length > 0;

const itemsOnFrame = (doc: Doc, frame: Frame, widths: Record<string, number>): Item[] =>
  doc.groups.filter((g: Group) => frameOfGroup(g, doc.frames, widths)?.id === frame.id).flatMap((g) => g.items);

const describeItem = (it: Item) => {
  const bits = [`id=${it.id}`, `kind=${it.kind}`];
  if (hasText(it.label)) bits.push(`label=${JSON.stringify(it.label)}`);
  if (hasText(it.supporting)) bits.push(`supporting=${JSON.stringify(it.supporting)}`);
  if (it.icon) bits.push(`icon=${it.icon}`);
  if (it.tabs?.length) bits.push(`items=${JSON.stringify(it.tabs.map((t) => t.label || t.icon))}`);
  if (it.action) bits.push(`tap=${it.action.to}`);
  if (it.toggle) bits.push("toggle");
  if (hasText(it.note)) bits.push(`current_note=${JSON.stringify(it.note)}`);
  return bits.join(" ");
};

const context = (doc: Doc, widths: Record<string, number>, frame: Frame, lang: Lang) =>
  [
    "The author is sketching a Material 3 Expressive app. Below is the generated description of the whole design, then the screen to work on.",
    "",
    "=== Whole design ===",
    buildPrompt(doc, widths, undefined, lang),
    "",
    `=== Screen to work on: ${JSON.stringify(frame.name || "(unnamed)")} ===`,
  ].join("\n");

const SYSTEM = "You help an app designer finish a sketch. Answer with a single JSON object and nothing else: no prose, no markdown fence.";

/** picks the strings the model returned for exactly the parts asked about */
function pickStrings(v: unknown, parts: Item[], max: number): Record<string, string> {
  const map = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const it of parts) {
    const s = map[it.id];
    if (typeof s === "string" && s.trim()) out[it.id] = s.trim().slice(0, max);
  }
  return out;
}

/** a short behavior note for one part; an existing note is refined rather than replaced */
export async function proposeBehavior(s: AiSettings, doc: Doc, widths: Record<string, number>, frame: Frame, lang: Lang, itemId: string, signal?: AbortSignal): Promise<string | undefined> {
  const parts = itemsOnFrame(doc, frame, widths).filter((it) => it.id === itemId);
  if (!parts.length) return undefined;
  const user = [
    context(doc, widths, frame, lang),
    "",
    "For the part listed below, write what happens when the user interacts with it: what it does, where it leads, what it shows. One sentence, concrete, in the voice of a product spec (no 'should', no hedging). Infer from the labels, icons and the other screens; do not invent screens that do not exist.",
    "A part with a current_note already has the author's own wording: keep its intent and facts, and improve it (clearer, more specific, consistent with the rest of the screen). Do not contradict it.",
    `Write in ${LANG_NAME[lang]}.`,
    "",
    "Part:",
    describeItem(parts[0]),
    "",
    'Answer as {"notes": {"<id>": "<sentence>"}} using exactly the id above.',
  ].join("\n");
  const j = parseJsonObject(await complete(s, SYSTEM, user, signal));
  return pickStrings(j.notes, parts, 300)[itemId];
}

/** a name (only when the screen has none) and a one-line purpose for the screen; an existing description is refined */
export async function proposeDescription(s: AiSettings, doc: Doc, widths: Record<string, number>, frame: Frame, lang: Lang, signal?: AbortSignal): Promise<{ name?: string; note: string }> {
  const user = [
    context(doc, widths, frame, lang),
    "",
    "Describe this screen's purpose in one or two sentences: who opens it, what they see and what they can do here. Also propose a short screen name (one to three words).",
    hasText(frame.note) ? `The author's current description is ${JSON.stringify(frame.note)}: keep its intent and facts, and improve it.` : "",
    `Write in ${LANG_NAME[lang]}.`,
    "",
    'Answer as {"name": "<name>", "description": "<sentences>"}.',
  ]
    .filter((l) => l !== "")
    .join("\n");
  const j = parseJsonObject(await complete(s, SYSTEM, user, signal));
  const note = typeof j.description === "string" ? j.description.trim().slice(0, 400) : "";
  if (!note) throw new Error("json");
  const name = typeof j.name === "string" ? j.name.trim().slice(0, 40) : "";
  return { name: !hasText(frame.name) && name ? name : undefined, note };
}

/** the value a rewritten field had before, so the rewrite can be undone; an empty field leaves nothing to go back to */
export const pushHistory = (history: string[] | undefined, replaced: string | undefined): string[] | undefined => {
  const cur = (replaced ?? "").trim();
  return cur ? [cur] : history?.length ? history : undefined;
};

/** the patch that swaps a field with what it said before the AI wrote it; pressing again swaps back */
export function popHistory<V extends string, H extends string>(current: string | undefined, history: string[] | undefined, valueKey: V, historyKey: H): Record<V, string> & Record<H, string[] | undefined> {
  const [prev] = history ?? [];
  const cur = (current ?? "").trim();
  return { [valueKey]: prev ?? "", [historyKey]: cur ? [cur] : undefined } as Record<V, string> & Record<H, string[] | undefined>;
}

/** A whole design from an idea, drafted by the author's own model. `guide` is the same
 *  agent guide a coding agent reads (public/agent.md), so both paths follow one spec.
 *  The answer is the document itself; a link would be pointless here. */
export async function draftDesign(s: AiSettings, guide: string, idea: string, lang: Lang, signal?: AbortSignal): Promise<Doc> {
  const system = [
    "You draft M3E Canvas designs. Follow the guide below exactly.",
    "Reply with the JSON document only: no share link, no prose, no markdown fence, no explanation.",
    "",
    guide,
  ].join("\n");
  const user = [`Sketch this app: ${idea.trim()}`, `Write every label, title and note in ${LANG_NAME[lang]}.`, "Three to five screens. Keep it simple."].join("\n");
  const j = parseJsonObject(await complete(s, system, user, signal, 12000));
  if (!isProject(j)) throw new Error("json");
  return j;
}

