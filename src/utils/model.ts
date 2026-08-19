import { getActiveConfig, ModelConfig, BRAND_PRESETS } from './modelConfig';
import { recordAiUsage, recordAiRaw } from './usage';
import { showToast } from './toast';

// ============ 统一模型调用（OpenAI 兼容格式）============
// 所有品牌（GLM / 豆包 / DeepSeek / Gemini）的 chat/completions 都走这里。
// 联网搜索按品牌注入对应 tools：豆包/GLM 用 web_search，Gemini 用 google_search。

export interface CallOpts {
  temperature?: number;
  maxTokens?: number;
  forceSearch?: boolean; // 即便模型未勾选「联网搜索」，本轮也强制联网
  feature?: string; // 调用来源标签（三餐估算/运动消耗/AI对话…），用于用量记录
  jsonMode?: boolean; // 要求 API 以 json_object 模式返回，强制合法 JSON，降低「模型不按格式返回」导致解析失败的概率
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatPayload = { role: string; content: string | ContentPart[] }[];

const payloadHasImage = (payload: ChatPayload): boolean =>
  payload.some((m) => Array.isArray(m.content) && m.content.some((p: any) => p?.type === 'image_url'));

const buildTools = (cfg: ModelConfig, forceSearch?: boolean, hasImage?: boolean): any[] | undefined => {
  const tool = BRAND_PRESETS[cfg.brand].searchTool;
  if (!tool) return undefined;
  // 🔧 视觉请求（带图片）不挂联网搜索工具：GLM/Gemini 等品牌的 Chat Completions 端点不支持「图片 + 工具」同发，
  // 会直接 400。识图本身也不需要联网搜索，故带图时一律跳过工具注入。
  if (hasImage) return undefined;
  if (!cfg.webSearch && !forceSearch) return undefined;
  // 豆包（火山）的 web_search 工具只在 Responses API 端点（/api/v3/responses）可用；本 App 的
  // Chat Completions 路径（postChat / postChatStream）不认该工具 → 这里仍对豆包返回 undefined（避免 400）。
  // 联网搜索改走 model.ts 的 Responses 通道：营养估算用 postChatResponses、ChatPage 流式用 postChatStreamResponses
  // （由 nutrition.ts / chat.ts 在「品牌=火山 且需联网」时分流）。
  if (cfg.brand === 'doubao') return undefined;
  return tool === 'google_search' ? [{ google_search: {} }] : [{ type: 'web_search' }];
};

const defaultMaxTokens = (cfg: ModelConfig): number => (cfg.brand === 'glm' ? 2048 : 4096);

// 解析各品牌返回的 usage（Chat Completions 用 prompt_tokens/completion_tokens；Responses API 用 input_tokens/output_tokens），
// 写入用量记录并弹 Toast 提示「模型 + token 用量」。
const reportUsage = (cfg: ModelConfig, usage: any, feature: string): void => {
  if (!usage) return;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  if (!totalTokens) return;
  recordAiUsage({
    brand: cfg.brand,
    modelId: cfg.modelId,
    feature: feature || 'AI调用',
    promptTokens,
    completionTokens,
    totalTokens,
  }).catch(() => {});
  const label = cfg.name || cfg.modelId;
  showToast(`模型 ${label} · 本约 ${totalTokens} token（入${promptTokens}/出${completionTokens}）`);
};

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
  const hasImage = payloadHasImage(payload);
  const body: any = {
    model: cfg.modelId,
    messages: payload,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? defaultMaxTokens(cfg),
    stream,
  };
  const tools = buildTools(cfg, opts.forceSearch, hasImage);
  if (tools) body.tools = tools;
  // JSON 模式：让 API 强制返回合法 JSON 对象，降低「模型不按格式返回」导致解析失败的概率。
  // 注意：OpenAI 兼容接口禁止 json_object 与 tools 同时出现，故仅在无 tools 时附加，避免 400。
  if (opts.jsonMode && !tools) body.response_format = { type: 'json_object' };
  return body;
};

// 非流式
export const postChat = async (cfg: ModelConfig, payload: ChatPayload, opts: CallOpts = {}): Promise<string> => {
  if (!cfg?.apiKey) throw new Error('未配置 API Key，请先到「我的 → 管理 AI 模型」添加模型');
  // 🔧 运行时保护：豆包模型标识必须是 ep-xxxx，否则火山方舟会 404 或行为异常
  if (cfg.brand === 'doubao' && !cfg.modelId.startsWith('ep-')) {
    console.warn(`[model] ⚠️ 豆包模型标识 "${cfg.modelId}" 不是 ep- 开头的接入点 ID！火山方舟可能无法正确路由此请求。请到「管理 AI 模型」修正该模型的标识为 ep-xxxx 格式。`);
  }
  // 🔧 推理模型（如 doubao-seed-evolving / 2-0-mini）会先把大量输出 token 花在"思考"上，
  // 若 max_tokens 太小会被截断（finish_reason=length）导致 content 为空。这里检测到截断就自动翻倍额度重试。
  // Evolving 官方最大回答 256K，这里把重试上限放到 20000 留足安全余量（日常三餐根本用不到这么多）。
  let maxOutput = opts.maxTokens ?? defaultMaxTokens(cfg);
  // GLM 免费模型 max_tokens 上限仅 1024，翻倍会 400，故按品牌设上限；其余品牌（豆包/DeepSeek/Gemini）给到 32000，
  // 配合下方「截断自动翻倍重试」，长回答也能一轮拿到完整正文。
  const MAX_OUTPUT_CAP = cfg.brand === 'glm' ? 1024 : 32000;
  let lastEmpty = '模型返回为空';
  for (let attempt = 0; attempt <= 2; attempt++) {
    const res = await fetch(cfg.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(buildBody(cfg, payload, { ...opts, maxTokens: maxOutput }, false)),
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
        if (cfg.brand === 'doubao') {
          msg += '：接口/模型找不到。火山方舟须填推理接入点 ID（ep-xxxx），不能直接填模型名。请确认接入点 ID 正确且该接入点已启用。';
        } else {
          msg += '：模型/接口找不到，请确认模型标识是否正确（可能已被下架或改名）。';
        }
      } else if (res.status === 429) {
        msg += '：触发频率限制，请稍候重试。';
      }
      if (errText) msg += ` 详情：${errText.slice(0, 400)}`;
      throw new Error(msg);
    }
    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    const finishReason: string | undefined = data?.choices?.[0]?.finish_reason;
    reportUsage(cfg, data?.usage, opts.feature || 'AI调用');
    const rawStr = JSON.stringify(data);
    // 🔧 截断（思考耗尽额度）优先重试：哪怕已吐出部分正文也加大额度重生成完整回答；已到上限才退化为返回已有内容
    if (finishReason === 'length' && maxOutput < MAX_OUTPUT_CAP) {
      await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[TRUNCATED length] max_tokens=${maxOutput} ${rawStr}`).catch(() => {});
      console.error('[model] ⚠️ 输出被截断(length)，加大 max_tokens 重试:', maxOutput, '→', Math.min(maxOutput * 2, MAX_OUTPUT_CAP));
      maxOutput = Math.min(maxOutput * 2, MAX_OUTPUT_CAP);
      lastEmpty = '模型输出被截断（思考耗尽了输出额度，未生成完整正文）。已自动加大额度重试仍失败，请到「管理 AI 模型」换非推理模型或关闭联网搜索。';
      continue;
    }
    if (content) {
      await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, content).catch(() => {});
      return content;
    }
    await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[CONTENT_EMPTY] ${rawStr}`).catch(() => {});
    console.error('[model] ⚠️ 模型返回为空但 HTTP 成功！完整响应:', rawStr.slice(0, 1500));
    throw new Error('模型返回为空');
  }
  throw new Error(lastEmpty);
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
  // 🔧 推理模型会先把输出额度花在"思考"上，阈值太小会被截断（status=incomplete/reason=length）→ content 为空。
  // 检测到截断就自动翻倍 max_output_tokens 重试，直至上限。Evolving 官方最大回答 256K，这里上限放到 20000。
  let maxOutput = opts.maxTokens ?? 1000;
  // GLM 免费模型 max_tokens 上限仅 1024，翻倍会 400，故按品牌设上限；其余品牌给到 32000，长回答也能一轮拿全。
  const MAX_OUTPUT_CAP = cfg.brand === 'glm' ? 1024 : 32000;
  let lastEmpty = '模型返回为空';
  for (let attempt = 0; attempt <= 2; attempt++) {
    const hasImage = payloadHasImage(payload);
    const body: any = {
      model: cfg.modelId,
      stream: false,
      input,
      // 🔧 视觉请求（带图片）不挂联网搜索工具：识图不需要联网，且部分品牌图片+工具组合会 400
      tools: opts.forceSearch && !hasImage ? [{ type: 'web_search' }] : undefined,
      temperature: opts.temperature ?? 0.7,
      max_output_tokens: maxOutput,
    };
    if (instructions) body.instructions = instructions;
    // JSON 模式（火山 Responses API 同样兼容 response_format）。与 web_search 工具冲突时跳过，避免 400。
    if (opts.jsonMode && !body.tools) body.response_format = { type: 'json_object' };

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
      let msg = `${BRAND_PRESETS[cfg.brand].label} 模型请求失败（${res.status}）`;
      if (res.status === 400) {
        msg += '：请求被拒绝（400）。常见原因：模型标识不是 ep-xxxx 接入点格式、接入点未开启对应能力、图片格式/base64 无效，或参数不受该接入点支持。';
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
    const truncated = data?.status === 'incomplete' && data?.incomplete_details?.reason === 'length';
    reportUsage(cfg, data?.usage, opts.feature || 'AI调用');
    const rawStr = JSON.stringify(data);
    // 🔧 截断（思考耗尽额度）优先重试：哪怕已吐出部分正文也加大额度重生成完整回答；已到上限才退化为返回已有内容
    if (truncated && maxOutput < MAX_OUTPUT_CAP) {
      await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[TRUNCATED length] max_output_tokens=${maxOutput} ${rawStr}`).catch(() => {});
      console.error('[model] ⚠️ Responses 输出被截断(length)，加大 max_output_tokens 重试:', maxOutput, '→', Math.min(maxOutput * 2, MAX_OUTPUT_CAP));
      maxOutput = Math.min(maxOutput * 2, MAX_OUTPUT_CAP);
      lastEmpty = '模型输出被截断（思考耗尽了输出额度，未生成完整正文）。已自动加大额度重试仍失败，请到「管理 AI 模型」换非推理模型或关闭联网搜索。';
      continue;
    }
    if (content) {
      await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, content).catch(() => {});
      return content;
    }
    await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[CONTENT_EMPTY] ${rawStr}`).catch(() => {});
    console.error('[model] ⚠️ Responses API 返回为空但 HTTP 成功！完整响应:', rawStr.slice(0, 1500));
    throw new Error('模型返回为空');
  }
  throw new Error(lastEmpty);
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
      // 推理模型（Evolving/2-0-mini）会先把输出 token 花在"思考"上，max_output_tokens 太小会被截断。
      let maxOutput = opts.maxTokens ?? defaultMaxTokens(cfg);
      // GLM 免费模型 max_tokens 上限仅 1024，翻倍会 400，故按品牌设上限；其余品牌给到 32000，长回答也能一轮拿全。
      const MAX_OUTPUT_CAP = cfg.brand === 'glm' ? 1024 : 32000;
      let lastEmpty = '模型返回为空';

      for (let attempt = 0; attempt <= 2; attempt++) {
        const body: any = {
          model: cfg.modelId,
          stream: true,
          input,
          tools: opts.forceSearch ? [{ type: 'web_search' }] : undefined,
          temperature: opts.temperature ?? 0.7,
          max_output_tokens: maxOutput,
        };
        if (instructions) body.instructions = instructions;

        const result: { full: string; truncated: boolean; lastRaw?: any } = await new Promise((res, rej) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.setRequestHeader('Accept', 'text/event-stream');
          xhr.setRequestHeader('Authorization', `Bearer ${cfg.apiKey}`);
          xhr.responseType = 'text';

          let loaded = 0;
          let buffer = '';
          let full = '';
          let lastRaw: any;
          let truncated = false;

          const onAbort = () => xhr.abort();
          const cleanAbort = () => {
            if (signal) signal.removeEventListener('abort', onAbort);
          };
          if (signal) {
            if (signal.aborted) {
              xhr.abort();
              rej(new Error('已取消'));
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
                  // 流式末尾的 response.completed 事件带 usage（用于用量记录）
                  if (json?.type === 'response.completed') {
                    if (json.response?.usage) reportUsage(cfg, json.response.usage, opts.feature || 'AI调用');
                    lastRaw = json.response;
                    if (json.response?.status === 'incomplete' && json.response?.incomplete_details?.reason === 'length') {
                      truncated = true;
                    }
                  }
                } catch {
                  // 非 JSON 行（event 行 / 心跳）忽略
                }
              }
            }
            if (xhr.readyState === 4) {
              cleanAbort();
              if (xhr.status >= 200 && xhr.status < 300) {
                res({ full, truncated, lastRaw });
              } else {
                let msg = `${BRAND_PRESETS[cfg.brand].label} 联网搜索请求失败（${xhr.status}）`;
                if (xhr.status === 400) msg += '：请求被拒绝（400）。火山 Responses API 要求模型标识为接入点 ID（ep-xxxx），且已开启「联网搜索」插件。';
                else if (xhr.status === 401 || xhr.status === 403) msg += '：API Key 无效或没有权限。';
                else if (xhr.status === 404) msg += '：接口/模型找不到，请确认接入点 ID 正确且支持 Responses API。';
                else if (xhr.status === 429) msg += '：触发频率限制，请稍候重试。';
                rej(new Error(msg));
              }
            }
          };
          xhr.onerror = () => {
            cleanAbort();
            rej(new Error('网络错误，请检查连接'));
          };
          xhr.send(JSON.stringify(body));
        });

        if (result.full) {
          // 未被截断：正常返回完整内容
          if (!result.truncated) return resolve(result.full);
          // 已吐出部分内容但被截断：仍有额度空间则加大 max_output_tokens 重新生成完整回答，避免返回半截
          if (maxOutput < MAX_OUTPUT_CAP) {
            const rawStr = JSON.stringify(result.lastRaw);
            await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[TRUNCATED length] max_output_tokens=${maxOutput} ${rawStr}`).catch(() => {});
            console.error('[model] ⚠️ Responses 流式输出被截断(length)但已有部分内容，加大 max_output_tokens 重试以获取完整回答:', maxOutput, '→', Math.min(maxOutput * 2, MAX_OUTPUT_CAP));
            maxOutput = Math.min(maxOutput * 2, MAX_OUTPUT_CAP);
            lastEmpty = '模型输出被截断（思考耗尽了输出额度，未生成完整正文）。已自动加大额度重试仍失败，请到「管理 AI 模型」换非推理模型或关闭联网搜索。';
            continue;
          }
          // 已到额度上限仍被截断：返回当前已生成的最好结果（避免死循环，也避免返回空）
          console.warn('[model] ⚠️ Responses 流式输出被截断(length)且已到额度上限，返回已生成的部分内容。');
          return resolve(result.full);
        }

        const rawStr = JSON.stringify(result.lastRaw);
        if (result.truncated && maxOutput < MAX_OUTPUT_CAP) {
          await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[TRUNCATED length] max_output_tokens=${maxOutput} ${rawStr}`).catch(() => {});
          console.error('[model] ⚠️ Responses 流式输出被截断(length)且为空，加大 max_output_tokens 重试:', maxOutput, '→', Math.min(maxOutput * 2, MAX_OUTPUT_CAP));
          maxOutput = Math.min(maxOutput * 2, MAX_OUTPUT_CAP);
          lastEmpty = '模型输出被截断（思考耗尽了输出额度，未生成正文）。已自动加大额度重试仍失败，请到「管理 AI 模型」换非推理模型或关闭联网搜索。';
          continue;
        }
        await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[CONTENT_EMPTY] ${rawStr}`).catch(() => {});
        console.error('[model] ⚠️ Responses 流式 API 返回为空但 HTTP 成功！最后响应:', rawStr.slice(0, 1500));
        break;
      }
      throw new Error(lastEmpty);
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
      // 运行时保护：豆包模型标识必须是 ep-xxxx
      if (cfg.brand === 'doubao' && !cfg.modelId.startsWith('ep-')) {
        console.warn(`[model] ⚠️ 豆包模型标识 "${cfg.modelId}" 不是 ep- 开头的接入点 ID！火山方舟可能无法正确路由此请求。`);
      }
      // 推理模型（Evolving/2-0-mini）会先把输出 token 花在"思考"上，max_tokens 太小会被截断。
      let maxOutput = opts.maxTokens ?? defaultMaxTokens(cfg);
      // GLM 免费模型 max_tokens 上限仅 1024，翻倍会 400，故按品牌设上限；其余品牌给到 32000，长回答也能一轮拿全。
      const MAX_OUTPUT_CAP = cfg.brand === 'glm' ? 1024 : 32000;
      let lastEmpty = '模型返回为空';

      for (let attempt = 0; attempt <= 2; attempt++) {
        const result: { full: string; truncated: boolean; lastRaw?: any } = await new Promise((res, rej) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', cfg.baseUrl);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.setRequestHeader('Authorization', `Bearer ${cfg.apiKey}`);
          xhr.responseType = 'text';

          let loaded = 0;
          let buffer = '';
          let full = '';
          let lastRaw: any;
          let truncated = false;

          const onAbort = () => xhr.abort();
          const cleanAbort = () => {
            if (signal) signal.removeEventListener('abort', onAbort);
          };
          if (signal) {
            if (signal.aborted) {
              xhr.abort();
              rej(new Error('已取消'));
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
                  // 检测流式截断
                  const finishReason = json?.choices?.[0]?.finish_reason;
                  if (finishReason) {
                    lastRaw = json;
                    if (finishReason === 'length') truncated = true;
                  }
                  // 部分供应商在流式末尾的 chunk 带 usage（best-effort，用于用量记录）
                  if (json?.usage) reportUsage(cfg, json.usage, opts.feature || 'AI调用');
                } catch {
                  // 非 JSON 行（心跳）忽略
                }
              }
            }
            if (xhr.readyState === 4) {
              cleanAbort();
              if (xhr.status >= 200 && xhr.status < 300) {
                res({ full, truncated, lastRaw });
              } else {
                let msg = `${BRAND_PRESETS[cfg.brand].label} 请求失败（${xhr.status}）`;
                if (xhr.status === 400) msg += '：请求被拒绝（400）。常见原因：①开启了「联网搜索」但当前品牌在 Chat Completions 端点不支持该工具；②模型标识/接口填错。';
                else if (xhr.status === 401 || xhr.status === 403) msg += '：API Key 无效或没有权限。';
                else if (xhr.status === 404) msg += '：接口/模型找不到，请确认模型标识是否正确。';
                else if (xhr.status === 429) msg += '：触发频率限制，请稍候重试。';
                rej(new Error(msg));
              }
            }
          };
          xhr.onerror = () => {
            cleanAbort();
            rej(new Error('网络错误，请检查连接'));
          };
          xhr.send(JSON.stringify(buildBody(cfg, payload, { ...opts, maxTokens: maxOutput }, true)));
        });

        if (result.full) {
          // 未被截断：正常返回完整内容
          if (!result.truncated) return resolve(result.full);
          // 已吐出部分内容但被截断：仍有额度空间则加大 max_tokens 重新生成完整回答，避免返回半截
          if (maxOutput < MAX_OUTPUT_CAP) {
            const rawStr = JSON.stringify(result.lastRaw);
            await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[TRUNCATED length] max_tokens=${maxOutput} ${rawStr}`).catch(() => {});
            console.error('[model] ⚠️ 流式输出被截断(length)但已有部分内容，加大 max_tokens 重试以获取完整回答:', maxOutput, '→', Math.min(maxOutput * 2, MAX_OUTPUT_CAP));
            maxOutput = Math.min(maxOutput * 2, MAX_OUTPUT_CAP);
            lastEmpty = '模型输出被截断（思考耗尽了输出额度，未生成完整正文）。已自动加大额度重试仍失败，请到「管理 AI 模型」换非推理模型或关闭联网搜索。';
            continue;
          }
          // 已到额度上限仍被截断：返回当前已生成的最好结果（避免死循环，也避免返回空）
          console.warn('[model] ⚠️ 流式输出被截断(length)且已到额度上限，返回已生成的部分内容。');
          return resolve(result.full);
        }

        const rawStr = JSON.stringify(result.lastRaw);
        if (result.truncated && maxOutput < MAX_OUTPUT_CAP) {
          await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[TRUNCATED length] max_tokens=${maxOutput} ${rawStr}`).catch(() => {});
          console.error('[model] ⚠️ 流式输出被截断(length)且为空，加大 max_tokens 重试:', maxOutput, '→', Math.min(maxOutput * 2, MAX_OUTPUT_CAP));
          maxOutput = Math.min(maxOutput * 2, MAX_OUTPUT_CAP);
          lastEmpty = '模型输出被截断（思考耗尽了输出额度，未生成正文）。已自动加大额度重试仍失败，请到「管理 AI 模型」换非推理模型或关闭联网搜索。';
          continue;
        }
        await recordAiRaw(opts.feature || 'AI调用', cfg.modelId, `[CONTENT_EMPTY] ${rawStr}`).catch(() => {});
        console.error('[model] ⚠️ 流式 API 返回为空但 HTTP 成功！最后响应:', rawStr.slice(0, 1500));
        break;
      }
      throw new Error(lastEmpty);
    })().catch(reject);
  });

// 便捷封装：自动解析「发图片用视觉模型 / 纯文本用默认模型」
// 🔧 视觉识别只认 isVision 开关，不写死品牌：只要用户在「管理 AI 模型」勾选了「设为视觉模型」即可用于识图。
//   - 豆包（火山）多模态视觉只在 Responses API（/responses）受支持，故豆包视觉请求走 postChatResponses；
//   - GLM / Gemini / DeepSeek 等在 Chat Completions（postChat）即可传图。
//   各品牌 max_tokens 上限不同（GLM 免费档仅 1024，写死 2000/4096 会被 API 直接拒 400），这里按品牌 clamp。
export const callModel = async (payload: ChatPayload, useVision: boolean, opts: CallOpts = {}): Promise<string> => {
  const cfg = await getActiveConfig(useVision);
  if (!cfg) throw new Error('未配置任何模型，请先到「我的 → 管理 AI 模型」添加');
  if (useVision && !cfg.isVision) {
    throw new Error('当前用于图片识别的模型没有勾选「支持图片」。请到「管理 AI 模型」把某个支持图片的模型（如 GLM 的 glm-4v-flash、豆包 Evolving）勾选「设为视觉模型」后再试。');
  }
  // DeepSeek 全系无视觉能力，即便误勾了「支持图片」，发图也会 400，提前拦截给出明确提示
  if (useVision && cfg.brand === 'deepseek') {
    throw new Error('DeepSeek 不支持图片识别。请到「管理 AI 模型」把视觉模型换成豆包 Evolving 或 GLM 的 glm-4v-flash。');
  }
  // 按品牌 clamp 视觉请求的 max_tokens 上限（GLM 免费档 ≤1024，写死 2000 会被 API 拒）
  const visionCap = cfg.brand === 'glm' ? 1024 : cfg.brand === 'doubao' ? 8000 : 4096;
  const realOpts: CallOpts = useVision
    ? { ...opts, maxTokens: Math.min(opts.maxTokens ?? visionCap, visionCap) }
    : opts;
  if (useVision && cfg.brand === 'doubao') return postChatResponses(cfg, payload, realOpts);
  return postChat(cfg, payload, realOpts);
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
