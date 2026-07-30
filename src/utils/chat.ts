import { GLM_ENDPOINT } from './ai';
import { getApiKey, getModel } from './storage';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

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

const buildHeaders = (apiKey: string) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: `Bearer ${apiKey}`,
});

// 多轮对话：把消息数组直接发给 GLM。systemContext 作为 system 角色注入（不计入可见聊天）。
export const sendChat = async (
  messages: ChatMessage[],
  systemContext?: string,
): Promise<string> => {
  const apiKey = await getApiKey();
  const model = await getModel();
  if (!apiKey) throw new Error('未设置 API Key，请先到「我的」页面填写');

  const payload: { role: string; content: string }[] = [];
  if (systemContext) payload.push({ role: 'system', content: systemContext });
  for (const m of messages) {
    payload.push({ role: m.role, content: m.content });
  }

  const res = await fetch(GLM_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: payload,
      temperature: 0.7,
      max_tokens: 1500,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[Chat] GLM send failed', res.status, errText);
    throw new Error(`GLM 请求失败（${res.status}），请检查网络或 API Key`);
  }
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('GLM 返回为空');
  return content;
};

const COMPRESS_SYSTEM_PROMPT = `你是个人记忆压缩器。用户输入：现有摘要（SKILL.md 风格 markdown）+ 一段要压缩的对话。
请输出更新后的同格式 markdown，要求：
1. 保留 YAML frontmatter（name / version 递增 / updated 日期）与全部章节（用户画像 / 拖延模式 / 关键事实 / 未结话题 / 已决事项 / 待办 / 情绪基调 / 疑问）；
2. 把旧信息收敛、去重、修正，形成长期记忆；
3. 只写对话中明确出现的事实，不要编造；
4. 若用户此前手动改过摘要，优先保留其修改意图；
5. 直接输出 markdown，不要输出任何额外说明文字。`;

// 压缩：把「现有摘要 + 旧消息」交给 GLM，合并成更新后的摘要 markdown
export const compressChat = async (
  existingMd: string,
  oldMessages: ChatMessage[],
): Promise<string> => {
  const apiKey = await getApiKey();
  const model = await getModel();
  if (!apiKey) throw new Error('未设置 API Key，请先到「我的」页面填写');

  const conversationText = oldMessages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    .join('\n');

  const userPrompt = `现有摘要：\n${existingMd || '(无)'}\n\n待压缩对话：\n${conversationText}\n\n请输出更新后的摘要 markdown。`;

  const res = await fetch(GLM_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: COMPRESS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1200,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[Chat] GLM compress failed', res.status, errText);
    throw new Error(`压缩失败（${res.status}）`);
  }
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('压缩结果为空');
  return content;
};
