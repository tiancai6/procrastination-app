// 手环/健康数据导入解析。
// 背景：免费自签的 App 拿不到 HealthKit 权限，也没有华为开放平台授权，
// 所以只能让用户在「华为运动健康 → 我的 → 隐私中心 → 申请导出个人数据」拿到文件后手动导入。
// 导出文件格式在不同版本差别很大，这里做「宽容解析」：认表头关键词，认不出的列直接忽略。
import { HealthDaily } from './storage';

// —— 表头关键词映射（小写匹配，命中即认）——
const FIELD_HINTS: { key: keyof HealthDaily; words: string[] }[] = [
  { key: 'date', words: ['date', '日期', 'day', 'recordtime', '统计日期'] },
  { key: 'steps', words: ['step', '步数', '步行数', 'totalsteps'] },
  { key: 'distanceKm', words: ['distance', '距离', '里程'] },
  { key: 'activeKcal', words: ['calorie', 'kcal', '卡路里', '热量', '消耗', 'energy'] },
  { key: 'sleepMin', words: ['sleep', '睡眠', '睡眠时长'] },
  { key: 'restingHr', words: ['heart', '心率', 'hr', 'bpm'] },
];

const matchField = (header: string): keyof HealthDaily | null => {
  const h = header.trim().toLowerCase().replace(/[\s_()（）]/g, '');
  for (const f of FIELD_HINTS) {
    if (f.words.some((w) => h.includes(w))) return f.key;
  }
  return null;
};

// —— 日期归一化成 YYYY-MM-DD ——
export const normalizeDate = (raw: unknown): string | null => {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // 13 位毫秒 / 10 位秒时间戳
  if (/^\d{13}$/.test(s)) return fromDate(new Date(Number(s)));
  if (/^\d{10}$/.test(s)) return fromDate(new Date(Number(s) * 1000));
  // 20260805
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  // 2026-08-05 / 2026/8/5 / 2026.08.05（可带时间）
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return fromDate(d);
  return null;
};

const fromDate = (d: Date): string | null => {
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
};

const toNum = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = parseFloat(String(raw).replace(/[^\d.\-]/g, ''));
  return Number.isNaN(n) ? undefined : n;
};

// 睡眠时长：支持 "7h30m" / "7小时30分" / "450"(分钟) / "7.5"(小时)
export const parseSleepMin = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw).trim();
  const hm = s.match(/(\d+(?:\.\d+)?)\s*(?:h|小时|时)\s*(\d+)?\s*(?:m|分)?/i);
  if (hm) return Math.round(parseFloat(hm[1]) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0));
  const n = toNum(s);
  if (n === undefined) return undefined;
  // 小于 24 视为小时，否则视为分钟
  return n < 24 ? Math.round(n * 60) : Math.round(n);
};

// 距离：华为常导出为米，>200 认为是米
const parseDistanceKm = (raw: unknown): number | undefined => {
  const n = toNum(raw);
  if (n === undefined) return undefined;
  return n > 200 ? Math.round((n / 1000) * 100) / 100 : Math.round(n * 100) / 100;
};

const assign = (target: HealthDaily, key: keyof HealthDaily, raw: unknown) => {
  if (key === 'date') {
    const d = normalizeDate(raw);
    if (d) target.date = d;
    return;
  }
  if (key === 'sleepMin') {
    const v = parseSleepMin(raw);
    if (v !== undefined) target.sleepMin = v;
    return;
  }
  if (key === 'distanceKm') {
    const v = parseDistanceKm(raw);
    if (v !== undefined) target.distanceKm = v;
    return;
  }
  const v = toNum(raw);
  if (v === undefined) return;
  if (key === 'steps') target.steps = Math.round(v);
  if (key === 'activeKcal') target.activeKcal = Math.round(v);
  if (key === 'restingHr') target.restingHr = Math.round(v);
};

// —— CSV ——
const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQuote = !inQuote;
    } else if ((c === ',' || c === '\t') && !inQuote) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
};

export const parseHealthCsv = (text: string): HealthDaily[] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => matchField(h));
  if (!headers.includes('date')) return [];
  const rows: HealthDaily[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const item: HealthDaily = { date: '', source: 'huawei' };
    headers.forEach((key, idx) => {
      if (key) assign(item, key, cells[idx]);
    });
    if (item.date) rows.push(item);
  }
  return mergeSameDay(rows);
};

// —— JSON（递归找出所有「含日期字段」的对象）——
export const parseHealthJson = (text: string): HealthDaily[] => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const rows: HealthDaily[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    const obj = node as Record<string, unknown>;
    const item: HealthDaily = { date: '', source: 'huawei' };
    let hit = 0;
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (v !== null && typeof v === 'object') return; // 嵌套稍后递归
      const key = matchField(k);
      if (key) {
        assign(item, key, v);
        if (key !== 'date') hit += 1;
      }
    });
    if (item.date && hit > 0) rows.push(item);
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (v !== null && typeof v === 'object') visit(v, depth + 1);
    });
  };
  visit(data, 0);
  return mergeSameDay(rows);
};

// 同一天多条（华为常按运动记录逐条导出）：步数/距离/消耗累加，心率取均值，睡眠取最大
const mergeSameDay = (rows: HealthDaily[]): HealthDaily[] => {
  const map = new Map<string, { item: HealthDaily; hrSum: number; hrCount: number }>();
  rows.forEach((r) => {
    const prev = map.get(r.date);
    if (!prev) {
      map.set(r.date, {
        item: { ...r },
        hrSum: r.restingHr || 0,
        hrCount: r.restingHr ? 1 : 0,
      });
      return;
    }
    const it = prev.item;
    if (r.steps !== undefined) it.steps = (it.steps || 0) + r.steps;
    if (r.distanceKm !== undefined) it.distanceKm = Math.round(((it.distanceKm || 0) + r.distanceKm) * 100) / 100;
    if (r.activeKcal !== undefined) it.activeKcal = (it.activeKcal || 0) + r.activeKcal;
    if (r.sleepMin !== undefined) it.sleepMin = Math.max(it.sleepMin || 0, r.sleepMin);
    if (r.restingHr !== undefined) {
      prev.hrSum += r.restingHr;
      prev.hrCount += 1;
      it.restingHr = Math.round(prev.hrSum / prev.hrCount);
    }
  });
  return Array.from(map.values())
    .map((v) => v.item)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
};

// 入口：按文件名/内容自动判断格式
export const parseHealthFile = (text: string, fileName: string): HealthDaily[] => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return parseHealthJson(text);
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseHealthCsv(text);
  // 猜：以 { 或 [ 开头当 JSON
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[') ? parseHealthJson(text) : parseHealthCsv(text);
};

export const summarizeImport = (rows: HealthDaily[]): string => {
  if (rows.length === 0) return '没有识别到数据';
  const first = rows[rows.length - 1].date;
  const last = rows[0].date;
  return `识别到 ${rows.length} 天数据（${first} ~ ${last}）`;
};
