import * as ImagePicker from 'expo-image-picker';
import { callModel, parseJsonContent, ChatPayload } from './model';
import { getApiKey } from './storage';

// 视觉模型从体脂秤 / 体成分报告截图中识别出的结构化数据
export interface BodyCompositionExtracted {
  weight?: number;       // 体重 kg
  bmi?: number;          // BMI
  bodyFatPct?: number;   // 体脂率 %
  muscleMass?: number;   // 肌肉量 kg
  boneMass?: number;     // 骨量 kg
  waterPct?: number;     // 水分 %
  visceralFat?: number;  // 内脏脂肪等级
  bmr?: number;          // 基础代谢 kcal
  bodyAge?: number;      // 身体年龄 岁
}

const OCR_SYSTEM = `你是一位体成分报告识别助手。用户会发来一张「体脂秤 / 体成分分析仪」的报告截图（如小米 / 华为 / 薄荷健康 App 的体成分分析页）。请识别图中以下字段，只返回 JSON（不要输出任何 JSON 以外的文字）：
{
  "weight": 数字,        // 体重 kg
  "bmi": 数字,           // BMI
  "bodyFatPct": 数字,    // 体脂率 %
  "muscleMass": 数字,    // 肌肉量 kg
  "boneMass": 数字,      // 骨量 kg
  "waterPct": 数字,      // 水分 %
  "visceralFat": 数字,   // 内脏脂肪等级
  "bmr": 数字,           // 基础代谢 kcal
  "bodyAge": 数字        // 身体年龄 岁
}
识别规则：
1. 只填图中能明确读到的字段；读不到就省略（不要填 0，也不要填 null）。
2. 体重 / 肌肉量 / 骨量单位是 kg，请按 kg 返回；体脂率 / 水分是百分比（如 39.3），直接返回数字不带 % 号。
3. 如果图里同时有「变化值」（如 39.3% -> 28.4%），取当前值（箭头右侧 / 最新值）。
4. 只输出 JSON。`;

// 选图 / 拍照，返回 base64（用于发给视觉模型）；用户取消返回 null。
export const pickBodyImage = async (useCamera: boolean): Promise<string | null> => {
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    base64: true,
    allowsEditing: false,
  };
  const res = useCamera
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  return res.assets[0].base64 ?? null;
};

// 把 base64 图片发给视觉模型，提取结构化体成分数据。
export const ocrBodyComposition = async (base64: string): Promise<BodyCompositionExtracted> => {
  const hasKey = await getApiKey();
  if (!hasKey) throw new Error('未设置 API Key，请先到「我的」页面填模型');
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  const payload: ChatPayload = [
    { role: 'system', content: OCR_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: '请识别这张体成分报告，按系统要求返回 JSON：' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
  const raw = await callModel(payload, true, { temperature: 0.2, maxTokens: 800 });
  const parsed = parseJsonContent(raw);
  // 0 视为「未读到」（体重/体脂率等不可能为 0），避免误填脏数据
  const num = (v: any): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : undefined;
  };
  const out: BodyCompositionExtracted = {};
  if (parsed.weight != null) out.weight = num(parsed.weight);
  if (parsed.bmi != null) out.bmi = num(parsed.bmi);
  if (parsed.bodyFatPct != null) out.bodyFatPct = num(parsed.bodyFatPct);
  if (parsed.muscleMass != null) out.muscleMass = num(parsed.muscleMass);
  if (parsed.boneMass != null) out.boneMass = num(parsed.boneMass);
  if (parsed.waterPct != null) out.waterPct = num(parsed.waterPct);
  if (parsed.visceralFat != null) out.visceralFat = num(parsed.visceralFat);
  if (parsed.bmr != null) out.bmr = num(parsed.bmr);
  if (parsed.bodyAge != null) out.bodyAge = num(parsed.bodyAge);
  return out;
};
