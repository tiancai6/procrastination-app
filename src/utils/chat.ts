import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { getActiveConfig, ModelConfig } from './modelConfig';
import { postChat, postChatStream, postChatStreamResponses } from './model';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  // 用户发送的图片（存于 App 沙盒 chat_images/ 下的文件 uri，非 base64，避免撑爆 AsyncStorage）
  images?: string[];
}

// ============ 视觉模型 ============
// glm-4-flash 等纯文本模型无法识别图片，发送图片时需切换到支持视觉的模型。
export const VISION_MODEL = 'glm-4v-flash';

// 已知支持图片输入的 GLM 视觉模型（免费/付费）
const KNOWN_VISION_MODELS = [
  'glm-4v-flash',
  'glm-4v',
  'glm-4v-plus',
  'glm-4.5v',
  'glm-4.1v',
  'glm-4v-9b',
];

export const isVisionModel = (model: string): boolean => {
  const m = (model || '').toLowerCase();
  if (KNOWN_VISION_MODELS.some((v) => m === v || m.startsWith(v))) return true;
  // 兜底：模型名里带 v 且不是纯数字版本号的，通常就是视觉模型（如 glm-4v-*）
  return /glm-[\d.]*v/.test(m);
};

// 视觉模型单次可处理的图片张数上限。
// 据智谱官方文档：glm-4v-flash（免费）仅支持单张；glm-4v / glm-4v-plus 等最多 5 张。
export const getVisionImageLimit = (model: string): number => {
  const m = (model || '').toLowerCase();
  if (m.includes('flash')) return 1; // glm-4v-flash 单图
  return 5;
};

// GLM 输出 token 上限：免费模型的 max_tokens 合法范围为 [1,1024]，统一封顶避免 400 报错
export const MAX_OUTPUT_TOKENS = 1024;

// ============ 聊天图片的存储与读取 ============
const CHAT_IMG_DIR = `${FileSystem.documentDirectory}chat_images/`;

// 图片发送给 GLM 前的最大边长（压缩后体积可控，避免 1210 解析错误）
const MAX_IMAGE_DIM = 1024;

// 把选择器返回的原始图片（可能是 HEIC/PNG/大图）用 expo-image-manipulator
// 统一转成 JPEG 并缩放到 MAX_IMAGE_DIM 以内，再写入沙盒，返回文件 uri。
// 这个函数解决两个问题：
//   1. iPhone HEIC → GLM 不识别 → 1210 错误
//   2. 原图 4000×3000 → base64 超大 → 请求失败或极慢
export const processAndSaveImage = async (imageUri: string): Promise<string> => {
  const info = await FileSystem.getInfoAsync(CHAT_IMG_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CHAT_IMG_DIR, { intermediates: true });

  // 统一转 JPEG + 缩放
  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: MAX_IMAGE_DIM } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
  );
  if (!result?.uri) throw new Error('图片处理失败');

  // 读取处理后的 JPEG 为 base64，存到 chat_images/ 目录（统一 .jpg 后缀）
  const base64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const destUri = `${CHAT_IMG_DIR}${name}`;
  await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return destUri;
};

// 兼容旧接口：直接传入 base64 字符串保存（不经过 manipulator 转换）
export const saveChatImage = async (base64: string, mime: string): Promise<string> => {
  const info = await FileSystem.getInfoAsync(CHAT_IMG_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CHAT_IMG_DIR, { intermediates: true });
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uri = `${CHAT_IMG_DIR}${name}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
};

// 读取沙盒图片为 base64，并拼成 GLM 需要的 data URL（image/jpeg 或 image/png）
export const readChatImageBase64 = async (uri: string): Promise<string> => {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const ext = uri.split('.').pop()?.toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
};

// 清空聊天时一并删除图片沙盒目录
export const clearChatImages = async (): Promise<void> => {
  try {
    const info = await FileSystem.getInfoAsync(CHAT_IMG_DIR);
    if (info.exists) await FileSystem.deleteAsync(CHAT_IMG_DIR, { idempotent: true });
  } catch (e) {
    console.error('[chat] clearChatImages failed', e);
  }
};

export interface ChatMeta {
  compressCount: number;
  lastCompressedAt: number | null;
}

// 超过该字符预算时提醒用户可压缩（中文约 字符 × 0.6 ≈ token，6000 字 ≈ 3600 token）
export const CHAT_BUDGET_CHARS = 6000;

// 压缩时保留最近 N 条原文，其余交给 GLM 压成摘要
export const COMPRESS_KEEP_RECENT = 6;

export const estimateChars = (messages: ChatMessage[], summary = ''): number =>
  messages.reduce((sum, m) => sum + (m.content?.length || 0), 0) + summary.length;

// 多轮对话：把消息数组直接发给当前默认模型。systemContext 作为 system 角色注入（不计入可见聊天）。
// 用户消息可携带 images（沙盒文件 uri 数组）；若有图片且当前模型不支持视觉，自动切换到 VISION_MODEL。
export const sendChat = async (
  messages: ChatMessage[],
  systemContext?: string,
): Promise<string> => {
  const hasImages = messages.some((m) => m.role === 'user' && m.images && m.images.length > 0);
  const cfg = await getActiveConfig(hasImages);
  if (!cfg) throw new Error('未配置任何模型，请先到「我的 → 管理 AI 模型」添加');

  type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
  const payload: { role: string; content: string | ContentPart[] }[] = [];
  if (systemContext) payload.push({ role: 'system', content: systemContext });
  for (const m of messages) {
    if (m.role === 'assistant') {
      payload.push({ role: 'assistant', content: m.content });
      continue;
    }
    // 用户消息
    if (m.images && m.images.length > 0) {
      const parts: ContentPart[] = [];
      if (m.content && m.content.trim()) parts.push({ type: 'text', text: m.content });
      for (const uri of m.images) {
        try {
          const dataUrl = await readChatImageBase64(uri);
          parts.push({ type: 'image_url', image_url: { url: dataUrl } });
        } catch (e) {
          console.error('[chat] 读取图片失败，跳过该图', uri, e);
        }
      }
      payload.push({ role: 'user', content: parts });
    } else {
      payload.push({ role: 'user', content: m.content });
    }
  }

  const content = await postChat(cfg, payload, { maxTokens: MAX_OUTPUT_TOKENS });
  return content;
};

const COMPRESS_SYSTEM_PROMPT = `你是个人记忆压缩器。用户输入：现有摘要（SKILL.md 风格 markdown）+ 一段要压缩的对话。
请输出更新后的同格式 markdown，要求：
1. 保留 YAML frontmatter（name / version 递增 / updated 日期）与全部章节（用户画像 / 专注模式 / 关键事实 / 未结话题 / 已决事项 / 待办 / 情绪基调 / 疑问）；
2. 把旧信息收敛、去重、修正，形成长期记忆；
3. 只写对话中明确出现的事实，不要编造；
4. 若用户此前手动改过摘要，优先保留其修改意图；
5. 直接输出 markdown，不要输出任何额外说明文字。`;

// 压缩：把「现有摘要 + 旧消息」交给 GLM，合并成更新后的摘要 markdown
export const compressChat = async (
  existingMd: string,
  oldMessages: ChatMessage[],
): Promise<string> => {
  const cfg = await getActiveConfig(false);
  if (!cfg) throw new Error('未配置任何模型，请先到「我的 → 管理 AI 模型」添加');

  const conversationText = oldMessages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    .join('\n');

  const userPrompt = `现有摘要：\n${existingMd || '(无)'}\n\n待压缩对话：\n${conversationText}\n\n请输出更新后的摘要 markdown。`;

  return await postChat(
    cfg,
    [
      { role: 'system', content: COMPRESS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.3, maxTokens: 4096 },
  );
};

// ============ 重新生成（兜底）============
// 用户手动改乱了摘要时，把当前 md 交给 GLM 重新整理为标准 SKILL.md 格式（尽量不丢信息）。
const REBUILD_SYSTEM_PROMPT = (today: string) => `你是个人档案整理器。用户输入一段用户手动编辑过的个人档案（markdown，SKILL.md 风格）。
请在不丢失重要信息的前提下，将其重新整理为符合标准格式的输出，要求：
1. 必须有 YAML frontmatter，含 name / description / version / updated（updated 固定为 ${today}；version 在原有基础上 +1，若原稿无 version 则从 1 开始）；
2. 保持以下章节（若原稿缺失某章节则新建空章节）：用户画像 / 专注模式 / 关键事实 / 未结话题 / 已决事项 / 待办 / 情绪基调 / 疑问；
3. 合并重复、修正格式、去除无效标记，但不要编造原稿没有的事实；
4. 直接输出 markdown，不要输出任何额外说明文字。`;

export const rebuildSummary = async (md: string): Promise<string> => {
  const cfg = await getActiveConfig(false);
  if (!cfg) throw new Error('未配置任何模型，请先到「我的 → 管理 AI 模型」添加');
  const today = new Date().toISOString().slice(0, 10);

  return await postChat(
    cfg,
    [
      { role: 'system', content: REBUILD_SYSTEM_PROMPT(today) },
      { role: 'user', content: md },
    ],
    { temperature: 0.3, maxTokens: 4096 },
  );
};

// ============ 流式对话（SSE）============
// 与 sendChat 的区别：stream:true，逐 token 通过 onToken 回调吐出，体感更快。
// ⚠️ React Native 的 fetch 不支持 response.body 流式读取，故用 XMLHttpRequest 的
//    增量 responseText 解析 SSE（data:{...} 行），中文由 XHR 自动按 UTF-8 解码。
// 返回 Promise<string> 为完整文本（供调用方落库）。signal 可传 AbortSignal 取消。
export const sendChatStream = (
  messages: ChatMessage[],
  systemContext?: string,
  onToken?: (delta: string) => void,
  signal?: AbortSignal,
  forceSearch = false,
  cfgOverride?: ModelConfig,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    (async () => {
      const hasImages = messages.some((m) => m.role === 'user' && m.images && m.images.length > 0);
      // 用户若手动选了模型，优先用它；但若带了图片而所选模型不支持视觉，则自动回落到视觉默认模型，
      // 避免「文字模型读不了图」导致整条对话报错。
      let cfg: ModelConfig | null;
      if (cfgOverride && (!hasImages || cfgOverride.isVision)) {
        cfg = cfgOverride;
      } else {
        cfg = await getActiveConfig(hasImages);
      }
      if (!cfg) throw new Error('未配置任何模型，请先到「我的 → 管理 AI 模型」添加');
      // 🔧 调试日志：确认实际使用的模型配置（品牌/端点/模型标识），方便排查「设了豆包但走了 GLM」的问题
      console.log(`[Chat] 使用模型: brand=${cfg.brand}, modelId=${cfg.modelId}, baseUrl=${cfg.baseUrl}, isVision=${cfg.isVision}, webSearch=${cfg.webSearch}, override=${!!cfgOverride}`);

      type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
      const payload: { role: string; content: string | ContentPart[] }[] = [];
      if (systemContext) payload.push({ role: 'system', content: systemContext });
      for (const m of messages) {
        if (m.role === 'assistant') {
          payload.push({ role: 'assistant', content: m.content });
          continue;
        }
        if (m.images && m.images.length > 0) {
          const parts: ContentPart[] = [];
          if (m.content && m.content.trim()) parts.push({ type: 'text', text: m.content });
          for (const uri of m.images) {
            try {
              const dataUrl = await readChatImageBase64(uri);
              parts.push({ type: 'image_url', image_url: { url: dataUrl } });
            } catch (e) {
              console.error('[chat] 读取图片失败，跳过该图', uri, e);
            }
          }
          payload.push({ role: 'user', content: parts });
        } else {
          payload.push({ role: 'user', content: m.content });
        }
      }

      // 火山（豆包）的联网搜索只在 Responses API 可用，且只在用户开了「联网搜索」开关或模型已开启搜索时走该通道；
      // 其余品牌（GLM/Gemini）继续走 Chat Completions 的 postChatStream。
      const useResponsesSearch = cfg.brand === 'doubao' && (forceSearch || cfg.webSearch);
      if (useResponsesSearch) {
        postChatStreamResponses(cfg, payload, onToken, signal, { maxTokens: MAX_OUTPUT_TOKENS, forceSearch: true }).then(resolve, reject);
      } else {
        postChatStream(cfg, payload, onToken, signal, { maxTokens: MAX_OUTPUT_TOKENS, forceSearch }).then(resolve, reject);
      }
    })().catch(reject);
  });
