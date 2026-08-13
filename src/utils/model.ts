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
  // 豆包（火山）的 web_search 工具只在 Responses API 端点（/api/v3/responses）可用；本 App 的
  // Chat Completions 路径（postChat / postChatStream）不认该工具 → 这里仍对豆包返回 undefined（避免 400）。
  // 联网搜索改走 model.ts 的 Responses 通道：营养估算用 postChatResponses、ChatPage 流式用 postChatStreamResponses
  // （由 nutrition.ts / chat.ts 在「品牌=火山 且需联网」时分流）。
  if (cfg.brand === 'doubao') return undefined;
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
  // 🔧 运行时保护：豆包模型标识必须是 ep-xxxx，否则火山方舟会 404 或行为异常
  if (cfg.brand === 'doubao' && !cfg.modelId.startsWith('ep-')) {
    console.warn(`[model] ⚠️ 豆包模型标识 "${cfg.modelId}" 不是 ep- 开头的接入点 ID！火山方舟可能无法正确路由此请求。请到「管理 AI 模型」修正该模型的标识为 ep-xxxx 格式。`);
  }
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
    let msg = `${BRAND_PRESETS[cfg.brand].label} 请求失败（${res.status}）`;
    if (res.status === 400) {
      msg += '：请求被服务器拒绝（400）。常见原因：①开启了「联网搜索」但当前品牌在 Chat Completions 端点不支持该工具（豆包暂不支持，请到「管理 AI 模型」关掉该模型的联网搜索开关）；②模型标识/接口填错。';
    } else if (res.status === 401 || res.status === 403) {
      msg += '：API Key 无效或没有权限，请检查密钥。';
    } else if (res.status === 404) {
      msg += '：模型/接口找不到，请确认模型标识填的是接入点 ID（ep-xxxx）而非模型名。';
    } else if (res.status === 429) {
      msg += '：触发频率限制，请稍候重试。';
    }
    if (errText) msg += ` 详情：${errText.slice(0, 400)}`;
    throw new Error(msg);
  }
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型返回为空');
  return content;
};

// ============ 火山方舟（豆包）Responses API 通道 ============
// 火山的联网搜索（web_search）只在 Responses API（/api/v3/responses）提供，Chat Completions 端点不认该工具。
// 仅当默认模型为火山、且需要联网搜索（如营养估算遇到陌生食物）时，由 nutrition.ts 调用本函数。
// 请求体结构与 Chat Completions 不同：messages → input（每项 content 为 input_text 结构）、系统提示词 → instructions。

const toResponsesUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/chat\/completions\/?$/, '/responses');

// 把 ChatPayload（含 system + user/assistant 消息，可能带图片）转成 Responses API 的 { instructions, input }
const toResponsesBody = (payload: ChatPayload) => {
  let instructions: string | undefined;
  const input: any[] = [];
  for (const m of payload) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
      instructions = instructions ? instructions + '\n' + text : text;
    } else {
      const content =
        typeof m.content === 'string'
          ? [{ type: 'input_text', text: m.content }]
          : m.content.map((p) =>
              p.type === 'image_url' ? { type: 'input_image', image_url: p.image_url.url } : { type: 'input_text', text: p.text },
            );
      input.push({ role: m.role, content });
    }
  }
  return { instructions, input };
};

// 从 Responses API 响应里取模型最终文本（兼容 output_text 便捷字段与 output[].content 结构）
const extractResponsesText = (data: any): string | undefined => {
  if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
  const msg = (data?.output || []).find((o: any) => o?.type === 'message');
  if (msg?.content) {
    const txt = msg.content
      .filter((c: any) => c?.type === 'output_text' && c?.text)
      .map((c: any) => c.text)
      .join('');
    if (txt) return txt;
  }
  return undefined;
};

export const postChatResponses = async (cfg: ModelConfig, payload: ChatPayload, opts: CallOpts = {}): Promise<string> => {
  if (!cfg?.apiKey) throw new Error('未配置 API Key，请先到「我的 → 管理 AI 模型」添加模型');
  const url = toResponsesUrl(cfg.baseUrl);
  const { instructions, input } = toResponsesBody(payload);
  const body: any = {
    model: cfg.modelId,
    stream: false,
    input,
    tools: opts.forceSearch ? [{ type: 'web_search' }] : undefined,
    temperature: opts.temperature ?? 0.7,
    max_output_tokens: opts.maxTokens ?? 1000,
  };
  if (instructions) body.instructions = instructions;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[model] responses request failed', cfg.brand, res.status, errText);
    let msg = `${BRAND_PRESETS[cfg.brand].label} 联网搜索请求失败（${res.status}）`;
    if (res.status === 400) {
      msg += '：请求被拒绝（400）。火山 Responses API 要求模型标识为接入点 ID（ep-xxxx），且已在控制台为该接入点开启「联网搜索」插件。';
    } else if (res.status === 401 || res.status === 403) {
      msg += '：API Key 无效或没有权限，请检查密钥。';
    } else if (res.status === 404) {
      msg += '：接口/模型找不到，请确认接入点 ID（ep-xxxx）正确，且该接入点已支持 Responses API 与联网搜索。';
    } else if (res.status === 429) {
      msg += '：触发频率限制，请稍候重试。';
    }
    if (errText) msg += ` 详情：${errText.slice(0, 400)}`;
    throw new Error(msg);
  }
  const data = await res.json();
  const content = extractResponsesText(data);
  if (!content) throw new Error('模型返回为空');
  return content;
};

// 流式版本：走 Responses API（/api/v3/responses），XHR 增量解析 SSE。
// 火山 Responses 流式事件的文本增量在 data 行的 json.type === 'response.output_text.delta' 的 delta 字段，
// 与 Chat Completions 的 choices[0].delta.content 不同，故单独解析。
export const postChatStreamResponses = (
  cfg: ModelConfig,
  payload: ChatPayload,
  onToken?: (delta: string) => void,
  signal?: AbortSignal,
  opts: CallOpts = {},
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    (async () => {
      if (!cfg?.apiKey) throw new Error('未配置 API Key，请先到「我的 → 管理 AI 模型」添加模型');
      const url = toResponsesUrl(cfg.baseUrl);
      const { instructions, input } = toResponsesBody(payload);
      const body: any = {
        model: cfg.modelId,
        stream: true,
        input,
        tools: opts.forceSearch ? [{ type: 'web_search' }] : undefined,
        temperature: opts.temperature ?? 0.7,
        max_output_tokens: opts.maxTokens ?? 2048,
      };
      if (instructions) body.instructions = instructions;

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'text/event-stream');
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
              // 火山 Responses 流式：文本增量事件
              if (json?.type === 'response.output_text.delta' && json.delta) {
                full += json.delta;
                onToken?.(json.delta);
              }
            } catch {
              // 非 JSON 行（event 行 / 心跳）忽略
            }
          }
        }
        if (xhr.readyState === 4) {
          if (signal) signal.removeEventListener('abort', onAbort);
          if (xhr.status >= 200 && xhr.status < 300) {
            if (!full) reject(new Error('模型返回为空'));
            else resolve(full);
          } else {
            let msg = `${BRAND_PRESETS[cfg.brand].label} 联网搜索请求失败（${xhr.status}）`;
            if (xhr.status === 400) msg += '：请求被拒绝（400）。火山 Responses API 要求模型标识为接入点 ID（ep-xxxx），且已开启「联网搜索」插件。';
            else if (xhr.status === 401 || xhr.status === 403) msg += '：API Key 无效或没有权限。';
            else if (xhr.status === 404) msg += '：接口/模型找不到，请确认接入点 ID 正确且支持 Responses API。';
            else if (xhr.status === 429) msg += '：触发频率限制，请稍候重试。';
            reject(new Error(msg));
          }
        }
      };
      xhr.onerror = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new Error('网络错误，请检查连接'));
      };
      xhr.send(JSON.stringify(body));
    })().catch(reject);
  });

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
      // 🔧 运行时保护：豆包模型标识必须是 ep-xxxx
      if (cfg.brand === 'doubao' && !cfg.modelId.startsWith('ep-')) {
        console.warn(`[model] ⚠️ 豆包模型标识 "${cfg.modelId}" 不是 ep- 开头的接入点 ID！火山方舟可能无法正确路由此请求。`);
      }

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
