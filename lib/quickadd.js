/**
 * 待办中心 —— 自然语言快速添加解析器（纯函数，无依赖）。
 *
 * 目标：把一行文本拆成结构化任务字段，并**把识别到的片段从标题里摘掉**。
 * 设计原则：
 *  - 纯规则，不调用模型，离线可用、结果可预测；
 *  - 识别不了的片段原样留在标题里，绝不吞字符；
 *  - 中文模式不要求空格（「明天交报告」也要能解析），英文模式要求词边界。
 *
 * 支持的语法（中文）：
 *   日期  今天 今日 明天 明日 后天 大后天 昨天 前天
 *         周X 星期X 礼拜X / 本周X 这周X / 下周X 下星期X
 *         N月N日 N月N号 N/N 月底 下个月N号 N天后
 *   时间  上午/早上/早晨/中午/下午/傍晚/晚上/夜里 + N点[N分|半]  |  H:MM
 *   重复  每天 每日 每N天 / 每周[周X] 每N周 / 每月[N号] / 每年
 *   优先级 p1..p4  !p1..!p4  优先级1..4  ! !! !!!
 *   项目  #名称      标签  @名称
 *
 * 英文：today/tomorrow/next monday/in N days、at 3pm / 15:00、every day/week/month、
 *      p1..p4、#project、@label。
 *
 * @module dsh-todos/quickadd
 */

const CN_WEEKDAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 0 };
const EN_WEEKDAYS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

/**
 * `#项目`、`@标签`、优先级这些**带标记**的语法允许紧贴在中文之后
 * （「交报告#Q4汇报」是常见写法），但不允许贴在拉丁字母/数字之后
 * （避免把 `C#编程`、`p1abc` 误伤）。
 *
 * 用 lookbehind 而不是把前导字符吃进匹配里——否则摘掉匹配时会连带
 * 删掉标题的最后一个汉字。
 */
const SIGIL_BOUNDARY = '(?<=^|\\s|[\\u4e00-\\u9fff\\u3000-\\u303f])';

// ------------------------------------------------------------------ 日期工具

function localKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shift(key, days) {
  const date = parseKey(key);
  date.setDate(date.getDate() + days);
  return localKey(date);
}

function monthLength(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** 下一个（含今天）落在给定星期的日期；`forwardOnly` 为 false 时本周同一星期也接受。 */
function nextWeekday(todayKey, weekday, forwardOnly = true) {
  const base = parseKey(todayKey);
  const current = base.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && forwardOnly) delta = 7;
  return shift(todayKey, delta);
}

/** 「本周X」：本周内那个星期，已过则取过去的日期（Todoist 语义是本周内）。 */
function thisWeekday(todayKey, weekday) {
  const current = parseKey(todayKey).getDay();
  return shift(todayKey, weekday - current);
}

// -------------------------------------------------------------------- 主函数

/**
 * 解析一行快速添加文本。
 *
 * @param {string} input
 * @param {object} [options]
 * @param {string} [options.today] 参考日（本地 `YYYY-MM-DD`），缺省取系统当天。
 * @param {Array<{id:string,name:string}>} [options.projects] 用于把 `#名称` 解析成 id。
 * @param {Array<{id:string,name:string}>} [options.labels] 用于把 `@名称` 解析成 id。
 * @returns {{
 *   title: string, dueDate: string|null, dueTime: string|null, priority: 'p1'|'p2'|'p3'|'p4',
 *   repeat: object|null, projectId: string|null, projectName: string|null,
 *   labelIds: string[], labelNames: string[], matched: string[]
 * }}
 */
export function parseQuickAdd(input, options = {}) {
  const today = options.today ?? localKey(new Date());
  const projects = options.projects ?? [];
  const labels = options.labels ?? [];

  let text = ` ${String(input ?? '')} `;
  const matched = [];

  /** 取走第一处匹配，并从文本中摘掉；返回匹配数组或 null。 */
  function take(re) {
    const m = re.exec(text);
    if (m === null) return null;
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
    matched.push(m[0].trim());
    return m;
  }

  let dueDate = null;
  let dueTime = null;
  let priority = 'p4';
  let repeat = null;
  let projectName = null;
  let labelNames = [];

  // ---- 1. 重复规则（必须在日期之前，否则「每周一」会被当成日期吃掉）
  {
    // 「每月N号」比通用的「每(…)?月」更具体，必须先试，否则 monthDay 会丢。
    const monthDay = take(/(?:^|\s)每(?:个)?月(\d{1,2})[号日]/);
    if (monthDay !== null) {
      repeat = { freq: 'monthly', interval: 1, monthDay: Number(monthDay[1]) };
    } else {
      const cn = take(/(?:^|\s)每(\d{1,3})?(天|日|周|星期|礼拜|个?月|年)([一二三四五六日天])?/);
      if (cn !== null) {
        const step = cn[1] === undefined ? 1 : Math.max(1, Number(cn[1]));
        const unit = cn[2];
        const weekdayChar = cn[3];
        if (unit === '天' || unit === '日') repeat = { freq: 'daily', interval: step };
        else if (unit === '周' || unit === '星期' || unit === '礼拜') {
          repeat = { freq: 'weekly', interval: step };
          if (weekdayChar !== undefined) repeat.weekdays = [CN_WEEKDAYS[weekdayChar]];
        } else if (unit.endsWith('月')) repeat = { freq: 'monthly', interval: step };
        else repeat = { freq: 'yearly', interval: step };
      } else {
        const en = take(/(?:^|\s)every\s+(day|week|month|year|(?:mon|tues|wednes|thurs|fri|satur|sun)day)(?=\s)/i);
        if (en !== null) {
          const word = en[1].toLowerCase();
          if (word === 'day') repeat = { freq: 'daily', interval: 1 };
          else if (word === 'week') repeat = { freq: 'weekly', interval: 1 };
          else if (word === 'month') repeat = { freq: 'monthly', interval: 1 };
          else if (word === 'year') repeat = { freq: 'yearly', interval: 1 };
          else {
            const weekday = EN_WEEKDAYS[word];
            repeat = { freq: 'weekly', interval: 1, weekdays: [weekday] };
          }
        }
      }
    }
  }

  // ---- 2. 日期
  {
    const relative = take(/(?:^|\s)(今天|今日|明天|明日|后天|大后天|昨天|前天)/);
    if (relative !== null) {
      const word = relative[1];
      const delta = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3, 昨天: -1, 前天: -2 }[word];
      dueDate = shift(today, delta);
    } else {
      const inDays = take(/(?:^|\s)(\d{1,3})\s*天[后之]?后?/);
      const nextMonthDay = take(/(?:^|\s)下(?:个)?月(\d{1,2})[号日]/);
      const absolute = take(/(?:^|\s)(\d{1,2})\s*[月\/\-]\s*(\d{1,2})\s*[日号]?/);
      const monthEnd = take(/(?:^|\s)(本|下)?月(?:底|末)/);
      const nextWeekName = take(/(?:^|\s)下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])?/);
      const thisWeekName = take(/(?:^|\s)(?:本|这)(?:周|星期|礼拜)([一二三四五六日天])?/);
      const weekdayOnly = take(/(?:^|\s)(?:周|星期|礼拜)([一二三四五六日天])/);
      const enRelative = take(/(?:^|\s)(today|tomorrow|yesterday)(?=\s)/i);
      const enNextWeekday = take(/(?:^|\s)next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?=\s)/i);
      const enInDays = take(/(?:^|\s)in\s+(\d{1,3})\s+days?(?=\s)/i);

      if (inDays !== null) dueDate = shift(today, Number(inDays[1]));
      else if (enInDays !== null) dueDate = shift(today, Number(enInDays[1]));
      else if (nextMonthDay !== null) {
        const base = parseKey(today);
        const monthIndex = base.getMonth() + 1;
        const year = base.getFullYear() + Math.floor(monthIndex / 12);
        const month = monthIndex % 12;
        const day = Math.min(Number(nextMonthDay[1]), monthLength(year, month));
        dueDate = localKey(new Date(year, month, day));
      } else if (absolute !== null) {
        const month = Number(absolute[1]);
        const day = Number(absolute[2]);
        if (month >= 1 && month <= 12) {
          const year = parseKey(today).getFullYear();
          const safeDay = Math.min(Math.max(day, 1), monthLength(year, month - 1));
          let candidate = localKey(new Date(year, month - 1, safeDay));
          // 已过去超过半年的「M/D」更像是在说明年。
          if (candidate < shift(today, -180)) candidate = localKey(new Date(year + 1, month - 1, safeDay));
          dueDate = candidate;
        }
      } else if (monthEnd !== null) {
        const base = parseKey(today);
        const monthIndex = base.getMonth() + (monthEnd[1] === '下' ? 1 : 0);
        dueDate = localKey(new Date(base.getFullYear(), monthIndex + 1, 0));
      } else if (nextWeekName !== null) {
        const weekday = nextWeekName[1] === undefined ? 1 : CN_WEEKDAYS[nextWeekName[1]];
        // 「下周三」= 下周一所在那周的周三。
        const nextMonday = nextWeekday(today, 1);
        dueDate = shift(nextMonday, (weekday - 1 + 7) % 7);
      } else if (thisWeekName !== null) {
        dueDate = thisWeekday(today, thisWeekName[1] === undefined ? 1 : CN_WEEKDAYS[thisWeekName[1]]);
      } else if (weekdayOnly !== null) {
        dueDate = nextWeekday(today, CN_WEEKDAYS[weekdayOnly[1]]);
      } else if (enRelative !== null) {
        const word = enRelative[1].toLowerCase();
        dueDate = shift(today, word === 'today' ? 0 : word === 'tomorrow' ? 1 : -1);
      } else if (enNextWeekday !== null) {
        dueDate = nextWeekday(today, EN_WEEKDAYS[enNextWeekday[1].toLowerCase()]);
      }
    }
  }

  // ---- 3. 时间
  {
    const colon = take(/(?:^|\s)([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?=\s|$)/);
    if (colon !== null) {
      dueTime = `${String(Number(colon[1])).padStart(2, '0')}:${colon[2]}`;
    } else {
      const en = take(/(?:^|\s)(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)(?=\s)/i);
      if (en !== null) {
        let hour = Number(en[1]) % 12;
        if (en[3].toLowerCase() === 'pm') hour += 12;
        dueTime = `${String(hour).padStart(2, '0')}:${en[2] ?? '00'}`;
      } else if (take(/(?:^|\s)(?:正午|中午)(?=\s)/) !== null) {
        dueTime = '12:00';
      } else if (take(/(?:^|\s)(?:午夜|半夜)(?=\s)/) !== null) {
        dueTime = '00:00';
      } else if (take(/(?:^|\s)noon(?=\s)/i) !== null) {
        dueTime = '12:00';
      } else if (take(/(?:^|\s)midnight(?=\s)/i) !== null) {
        dueTime = '00:00';
      } else {
        const cn = take(/(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*[点時时](半|\d{1,2}\s*分?)?/);
        if (cn !== null) {
          const period = cn[1] ?? '';
          let hour = Number(cn[2]);
          const minuteRaw = cn[3];
          let minute = 0;
          if (minuteRaw === '半') minute = 30;
          else if (minuteRaw !== undefined) minute = Number(minuteRaw.replace(/\D/g, '')) || 0;
          if (['下午', '傍晚', '晚上', '夜里'].includes(period) && hour < 12) hour += 12;
          if (['上午', '早上', '早晨', '凌晨'].includes(period) && hour === 12) hour = 0;
          if (hour <= 23 && minute <= 59) dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        }
      }
    }
    // 只给了时间没给日期：按今天算。
    if (dueTime !== null && dueDate === null) dueDate = today;
  }

  // ---- 4. 优先级
  {
    const explicit = take(new RegExp(`${SIGIL_BOUNDARY}[!！]?\\s*[pP]\\s*([1-4])(?=\\s)`));
    const cnPriority = take(new RegExp(`${SIGIL_BOUNDARY}优先级\\s*([1-4])(?=\\s)`));
    const bang = take(new RegExp(`${SIGIL_BOUNDARY}([!！]{1,3})(?=\\s)`));
    if (explicit !== null) priority = `p${explicit[1]}`;
    else if (cnPriority !== null) priority = `p${cnPriority[1]}`;
    // 感叹号越多越紧急：!!! → p1，!! → p2，! → p3。
    else if (bang !== null) priority = `p${4 - Math.min(3, bang[1].length)}`;
  }

  // ---- 5. 项目 / 标签（`#` 与 `@` 后取到下一个空白或下一个 sigil）
  {
    const project = take(new RegExp(`${SIGIL_BOUNDARY}#([^\\s#@]+)`));
    if (project !== null) projectName = project[1];
    const found = [];
    let label = take(new RegExp(`${SIGIL_BOUNDARY}@([^\\s#@]+)`));
    while (label !== null) {
      found.push(label[1]);
      label = take(new RegExp(`${SIGIL_BOUNDARY}@([^\\s#@]+)`));
    }
    labelNames = found;
  }

  const title = text.replace(/\s+/g, ' ').trim();

  const matchByName = (list, name) => {
    if (name === null) return null;
    const needle = name.trim().toLowerCase();
    return list.find((entry) => String(entry.name).trim().toLowerCase() === needle) ?? null;
  };

  const resolvedProject = matchByName(projects, projectName);
  const labelIds = [];
  const unresolvedLabels = [];
  for (const name of labelNames) {
    const hit = matchByName(labels, name);
    if (hit === null) unresolvedLabels.push(name);
    else labelIds.push(hit.id);
  }

  return {
    // 整行都是语法时，至少把原文当标题，避免产生空标题任务。
    title: title === '' ? String(input ?? '').trim() : title,
    dueDate,
    dueTime,
    priority,
    repeat,
    projectId: resolvedProject === null ? null : resolvedProject.id,
    projectName,
    labelIds,
    labelNames: unresolvedLabels,
    matched,
  };
}
