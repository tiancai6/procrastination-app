import { getActiveConfig, ModelConfig, BRAND_PRESETS } from './modelConfig';

// ============ 统一模型调用（OpenAI 兼容格式）============
// 所有品牌（GLM / 豆包 / DeepSeek / Gemini）的 chat/completions 都走这里。
// 联网搜索按品牌注入对应 tools：豆包/GLM 用 web_search，Gemini 用 google_search。

export interface CallOpts {
  temperature?: number;
  maxTokens?: number;
  forceSearch?: boolean; // 即便模型未勾选「联网搜索」，本轮也强制联网
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatPayload = { role: string; content: string | ContentPart[] }[];

const buildTools = (cfg: ModelConfig, forceSearch?: boolean): any[] | undefined => {
  const tool = BRAND_PRESETS[cfg.brand].searchTool;
  if (!tool) return undefined;
  if (!cfg.webSearch && !forceSearch) return undefined;
  return tool === 'google_search' ? [{ google_search: {} }] : [{ type: 'web_search' }];
};

const defaultMaxTokens = (cfg: ModelConfig): number => (cfg.brand === 'glm' ? 1024 : 2048);

// 容错解析 AI 返回的 JSON：自动剥离 ```json ... ``` 围栏及前后多余文字。
// DeepSeek / Gemini 常在 JSON 外包一层 markdown 围栏，直接 JSON.parse 会失败。
export const parseJsonContent = (raw: string): any => {
  if (!raw || !raw.trim()) throw new Error('模型返回为空');
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first && (first > 0 || last < s.length - 1)) {
    s = s.slice(first, last + 1);
  }
  return JSON.parse(s);
};

const buildBody = (cfg: ModelConfig, payload: ChatPayload, opts: CallOpts, stream: boolean) => {
  const body: any = {
    model: cfg.modelId,
    messages: payload,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? defaultMaxTokens(cfg),
    stream,
  };
  const tools = buildTools(cfg, opts.forceSearch);
  if (tools) body.tools = tools;
  return body;
};

// 非流式
export const postChat = async (cfg: ModelConfig, payload: ChatPayload, opts: CallOpts = {}): Promise<string> => {
  if (!cfg?.apiKey) throw new Error('未配置 API Key，请先到「我的 → 管理 AI 模型」添加模型');
  const res = await fetch(cfg.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(buildBody(cfg, payload, opts, false)),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[model] request failed', cfg.brand, res.status, errText);
    throw new Error(`${BRAND_PRESETS[cfg.brand].label} 请求失败（${res.status}），请检查网络或 API Key`);
  }
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型返回为空');
  return content;
};

// 流式（XHR 增量解析 SSE；RN 的 fetch 不支持 response.body 逐块读取）
export const postChatStream = (
  cfg: ModelConfig,
  payload: ChatPayload,
  onToken?: (delta: string) => void,
  signal?: AbortSignal,
  opts: CallOpts = {},
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    (async () => {
      if (!cfg?.apiKey) throw new Error('未配置 API Key，请先到「我的 → 管理 AI 模型」添加模型');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', cfg.baseUrl);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Authorization', `Bearer ${cfg.apiKey}`);
      xhr.responseType = 'text';

      let loaded = 0;
      let buffer = '';
      let full = '';

      const onAbort = () => xhr.abort();
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          reject(new Error('已取消'));
          return;
        }
        signal.addEventListener('abort', onAbort);
      }

      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3 || xhr.readyState === 4) {
          const text = xhr.responseText || '';
          const newChunk = text.slice(loaded);
          loaded = text.length;
          buffer += newChunk;
          let idx: number;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const data = t.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta: string | undefined = json?.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                onToken?.(delta);
              }
            } catch {
              // 非 JSON 行（心跳）忽略
            }
          }
        }
        if (xhr.readyState === 4) {
          if (signal) signal.removeEventListener('abort', onAbort);
          if (xhr.status >= 200 && xhr.status < 300) {
            if (!full) reject(new Error('模型返回为空'));
            else resolve(full);
          } else {
            reject(new Error(`${BRAND_PRESETS[cfg.brand].label} 请求失败（${xhr.status}），请检查网络或 API Key`));
          }
        }
      };
      xhr.onerror = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new Error('网络错误，请检查连接'));
      };
      xhr.send(JSON.stringify(buildBody(cfg, payload, opts, true)));
    })().catch(reject);
  });

// 便捷封装：自动解析「发图片用视觉模型 / 纯文本用默认模型」
export const callModel = async (payload: ChatPayload, useVision: boolean, opts: CallOpts = {}): Promise<string> => {
  const cfg = await getActiveConfig(useVision);
  if (!cfg) throw new Error('未配置任何模型，请先到「我的 → 管理 AI 模型」添加');
  if (useVision && !cfg.isVision) {
    throw new Error('当前默认模型不支持图片，请在模型配置里把某个模型设为「视觉模型」（如 glm-4v-flash）');
  }
  return postChat(cfg, payload, opts);
};

export const callModelStream = (
  payload: ChatPayload,
  useVision: boolean,
  onToken?: (delta: string) => void,
  signal?: AbortSignal,
  opts: CallOpts = {},
): Promise<string> =>
  (async () => {
    const cfg = await getActiveConfig(useVision);
    if (!cfg) throw new Error('未配置任何模型，请先到「我的 → 管理 AI 模型」添加');
    if (useVision && !cfg.isVision) {
      throw new Error('当前默认模型不支持图片，请在模型配置里把某个模型设为「视觉模型」（如 glm-4v-flash）');
    }
    return postChatStream(cfg, payload, onToken, signal, opts);
  })();
