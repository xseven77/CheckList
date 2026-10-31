import { type AIAction, type Checklist } from './types';

function parseChineseNumber(str: string): number | null {
  const match = str.match(/\d+/);
  if (match) return parseInt(match[0], 10);

  const numMap: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17, 十八: 18, 十九: 19, 二十: 20,
    二十一: 21, 二十二: 22, 二十三: 23, 二十四: 24, 二十五: 25, 二十六: 26, 二十七: 27, 二十八: 28, 二十九: 29, 三十: 30, 三十一: 31,
  };
  return numMap[str] || null;
}

/** 智能启发式中文解析器（无 API Key 或网络离线时的无缝备用解析引擎） */
export function parseWithSmartRules(rawPrompt: string, doc: Checklist): { summary: string; actions: AIAction[] } {
  const text = rawPrompt.trim();
  const actions: AIAction[] = [];

  // 1. 尝试识别日期（例如 "8号"、"8 日"、"八号"）
  let targetDay: number | null = null;
  const dayMatch = text.match(/(?:(\d{1,2})|[一二两三四五六七八九十]+)\s*[号日]/);
  if (dayMatch) {
    targetDay = parseChineseNumber(dayMatch[0].replace(/[号日]/, ''));
  }

  // 2. 尝试识别时间段（例如 "上午"、"下午"、"10:00"、"18点半"）
  let timeStr = '全天';
  const timeMatch = text.match(/(上午|下午|晚上|中午|全天|清晨|傍晚|\d{1,2}:\d{2}|\d{1,2}点(?:\d{1,2}分|半)?)/);
  if (timeMatch) {
    timeStr = timeMatch[1];
  }

  // 3. 检查是否为完成/勾选意图
  // 例如：“把开场视频标记为已完成”、“搞定货拉拉”、“完成3号的婚礼素材”
  const doneMatch =
    text.match(/(?:标记|把|将)?\s*(.+?)\s*(?:标记为|设为)?(完成|已完成|搞定|做好|办好了|勾选|划掉)$/) ||
    text.match(/^(?:完成|搞定|已完成|勾选|划掉)(?:了)?(?:下)?\s*(.+)$/);

  if (doneMatch) {
    const rawTarget = doneMatch[1].replace(/^(?:在)?(?:\d{1,2}|[一二两三四五六七八九十]+)[号日](?:的)?/, '').trim();
    if (rawTarget) {
      actions.push({
        type: 'set_done',
        target: rawTarget,
        done: true,
        day: targetDay ?? undefined,
      });
      return {
        summary: `已将「${rawTarget}」标记为已完成`,
        actions,
      };
    }
  }

  // 4. 检查是否为取消勾选意图
  const undoneMatch =
    text.match(/(?:取消|未完成|撤销勾选)(?:了)?(?:下)?\s*(.+)$/) ||
    text.match(/(?:把|将)?\s*(.+?)\s*(?:取消勾选|标记为未完成)$/);

  if (undoneMatch) {
    const rawTarget = undoneMatch[1].replace(/^(?:在)?(?:\d{1,2}|[一二两三四五六七八九十]+)[号日](?:的)?/, '').trim();
    if (rawTarget) {
      actions.push({
        type: 'set_done',
        target: rawTarget,
        done: false,
        day: targetDay ?? undefined,
      });
      return {
        summary: `已将「${rawTarget}」取消勾选`,
        actions,
      };
    }
  }

  // 5. 检查是否为向已有日程追加明细
  // 例如：“在3号增加明细：通知伴郎提早到”、“在货拉拉下面增加一项：提前确认司机电话”
  const addItemsMatch = text.match(
    /(?:在|给)?(?:(\d{1,2}|[一二两三四五六七八九十]+)[号日])?(?:的)?([^增添加下里中]+?)?(?:下|里|中)?(?:增加|添加|加上|加一项|加明细)(?:明细|待办|事项)?(?:包括|包含|：|:|，|,|\s)+(.*)/
  );
  if (addItemsMatch && addItemsMatch[3]) {
    const itemDay = addItemsMatch[1] ? parseChineseNumber(addItemsMatch[1]) : targetDay;
    const evTitle = addItemsMatch[2]?.trim() || '';
    const itemsPart = addItemsMatch[3].trim();
    const items = itemsPart
      .split(/[、,，;\n\t]|(?:还有)|(?:以及)|(?:和)/)
      .map((s) => s.trim().replace(/^[-*•1-9.、\s]+/, ''))
      .filter((s) => s.length > 0);

    if (items.length > 0) {
      actions.push({
        type: 'add_items',
        day: itemDay ?? undefined,
        eventTitle: evTitle || undefined,
        items,
      });
      return {
        summary: `已在${itemDay ? `${itemDay}号` : ''}${evTitle ? `「${evTitle}」` : '日程'}下新增 ${items.length} 条待办明细`,
        actions,
      };
    }
  }

  // 6. 默认意图：新增日程（包含标题和明细列表）
  // 例如：“8号下午加一个答谢宴，准备伴手礼30份、提前订包厢、结清酒水”
  // 或者：“8号 答谢宴，包含准备伴手礼、预订酒水”
  let dayToUse = targetDay;
  if (!dayToUse) {
    // 默认推断为最后一天或新增一天
    const maxDay = doc.days.length ? Math.max(...doc.days.map((d) => d.day)) : 7;
    dayToUse = maxDay + 1;
  }

  // 剥离日期和时间修饰词
  let cleanText = text
    .replace(/(?:在|帮我在|帮我加一个|加一个|新增)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)[号日]/g, '')
    .replace(/(上午|下午|晚上|中午|全天|清晨|傍晚|\d{1,2}:\d{2}|\d{1,2}点(?:\d{1,2}分|半)?)/g, '')
    .replace(/^(?:日程|待办|事项|安排)[：:\s]*/, '')
    .trim();

  // 分离标题与明细列表
  let eventTitle = cleanText;
  let itemsList: string[] = [];

  const splitDetailMatch = cleanText.match(/^(.+?)(?:[，,：:\s]+(?:需要|准备|包括|包含|明细|待办)[：:\s]*|[：:])(.*)$/);
  if (splitDetailMatch) {
    eventTitle = splitDetailMatch[1].trim();
    const rawItems = splitDetailMatch[2].trim();
    itemsList = rawItems
      .split(/[、,，;\n\t]|(?:还有)|(?:以及)|(?:和)/)
      .map((s) => s.trim().replace(/^[-*•1-9.、\s]+/, ''))
      .filter((s) => s.length > 0);
  } else {
    // 尝试按顿号拆分
    const parts = cleanText.split(/[、，,]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      eventTitle = parts[0];
      itemsList = parts.slice(1);
    }
  }

  if (!eventTitle) {
    eventTitle = '新安排';
  }

  actions.push({
    type: 'add_event',
    day: dayToUse,
    time: timeStr,
    title: eventTitle,
    items: itemsList,
    groupLabel: '待办明细',
  });

  return {
    summary: `已在 ${dayToUse} 号添加日程「${eventTitle}」${itemsList.length ? `及 ${itemsList.length} 项明细` : ''}`,
    actions,
  };
}

/** 主解析入口：优先尝试 Gemini API，如无 Key 或失败则平滑降级至规则解析引擎 */
export async function parseVoicePrompt(prompt: string, currentDoc: Checklist): Promise<{ summary: string; actions: AIAction[] }> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const docSummary = currentDoc.days
        .map((d) => `Day ${d.day}: ` + d.events.map((e) => `${e.title}(${e.time})`).join(', '))
        .join('; ');

      const systemPrompt = `你是一个专业的婚礼日程清单结构化转换 AI。
用户会输入一段讲话或打字的自然语言指令（例如“8号下午加一个答谢宴，包含准备伴手礼30份、提前订包厢、结清酒水”）。
当前清单已有日程：${docSummary}

你需要返回纯 JSON 格式（无任何 markdown 标签）：
{
  "summary": "简短中文说明，如：已在 8 号添加日程「答谢宴」及 3 项明细",
  "actions": [
    // 动作类型1: 新增日程和明细
    { "type": "add_event", "day": 8, "time": "下午", "title": "答谢宴", "items": ["准备伴手礼30份", "提前订包厢", "结清酒水"], "groupLabel": "待办明细" },
    // 动作类型2: 向已有日程追加明细
    { "type": "add_items", "day": 3, "eventTitle": "宾客名单", "items": ["通知伴娘提早半小时"] },
    // 动作类型3: 标记完成或未完成
    { "type": "set_done", "target": "开场视频", "done": true, "day": 3 }
  ]
}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\n用户口述内容：${prompt}` }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
            return {
              summary: parsed.summary || 'AI 智能解析成功',
              actions: parsed.actions,
            };
          }
        }
      }
    } catch {
      // API 请求异常时自动平滑回退至智能规则解析
    }
  }

  return parseWithSmartRules(prompt, currentDoc);
}
