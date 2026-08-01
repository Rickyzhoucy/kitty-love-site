/**
 * 纪念日时间串的解析。
 *
 * ## 为什么不能直接 `new Date(raw)`
 *
 * JS 对这两种写法的时区处理**是相反的**：
 *
 * - `'2025-11-30T09:00'`（带时间）→ 按**本地时间**解析
 * - `'2025-11-30'`（只有日期）→ 按 **UTC 零点**解析
 *
 * 站里两种串都有：`EventTimer.date` 是用户从 datetime-local 填的，带时间；
 * `main_timer_date` 是站点配置，只有日期。于是同一个「2025-11-30」，一处
 * 按本地零点算、另一处按 UTC 零点算，东八区差 8 小时——**每天 0 点到 8 点
 * 之间，两处显示的天数会差一天**，其余时间只差时分秒。首页「在一起的第 N 天」
 * 和纪念日卡片对不上就是这么来的。
 *
 * 后端那边（`app/anniversaries.py` 的 `parse_date`、`chat_assist.py`）拿到
 * 纯日期时当的是**当地日期**，不带时区。前端这里保持一致：只有日期时补成
 * **当地零点**，也符合人对「那天开始算」的理解。
 */
export function parseLocalDate(raw: string, now: Date = new Date()): Date {
    const text = (raw || '').trim().replace(/\//g, '-');

    // `2025-11-30` / `2025/11/30` / `2025-1-5`，以及 `2025年11月30日`。
    // 后两种后端也收（见 anniversaries.parse_date 的 `%Y年%m月%d日` 分支），
    // 而 `new Date('2025年11月30日')` 是 Invalid Date——卡片会一直显示 0 天。
    const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
        ?? /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
    if (dateOnly) {
        const [, year, month, day] = dateOnly;
        return new Date(Number(year), Number(month) - 1, Number(day));
    }

    // **只有月日的，按今年算**——和后端 `anniversaries.parse_date` 同一个规矩。
    // 不能交给 `new Date('11-30')`：那会被当成 2001 年 11 月 30 日（把 11 当
    // 成两位数年份），于是同一条纪念日，宠物说「还有 3 天」而卡片说「过了
    // 9000 多天」。**错得很安静**，看不出是解析问题。
    const monthDay = /^(\d{1,2})-(\d{1,2})$/.exec(text);
    if (monthDay) {
        const [, month, day] = monthDay;
        return new Date(now.getFullYear(), Number(month) - 1, Number(day));
    }

    // 带时间的（`2025-11-30T09:00`）走原生解析，它对这种形式按本地时区处理，
    // 正是我们要的。纯时间（宠物建的「21:00」这种）解析不出来，
    // 返回 Invalid Date 交给调用方显示成「日期没填对」，而不是假装是 0 天。
    return new Date(text);
}

/** 这个时间串能不能算出一个真实日期。 */
export function isValidDate(raw: string): boolean {
    return !Number.isNaN(parseLocalDate(raw).getTime());
}

/** 从 `anchor` 到现在过了多少个整天。anchor 在未来或日期无效时返回 null。 */
export function daysSince(raw: string, now: Date = new Date()): number | null {
    const anchor = parseLocalDate(raw, now);
    if (Number.isNaN(anchor.getTime())) return null;
    const diff = now.getTime() - anchor.getTime();
    return diff > 0 ? Math.floor(diff / 86_400_000) : null;
}

/**
 * 转成 `datetime-local` 输入框认的 `YYYY-MM-DDTHH:mm`。
 *
 * 库里 `EventTimer.date` 是自由文本，什么都可能有（宠物建的「21:00」、
 * 旧数据的「11-30」）。直接塞进输入框的话，格式不合的值会让输入框显示成
 * **空白**——用户以为日期丢了，一保存就真丢了。这里统一转换，转不出来的
 * 返回空串，由调用方要求重填。
 */
export function toDateTimeLocalValue(raw: string): string {
    const parsed = parseLocalDate(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
        + `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}
