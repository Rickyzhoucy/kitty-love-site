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
export function parseLocalDate(raw: string): Date {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (dateOnly) {
        const [, year, month, day] = dateOnly;
        return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return new Date(raw);
}

/** 从 `anchor` 到现在过了多少个整天。anchor 在未来时返回 null。 */
export function daysSince(raw: string, now: Date = new Date()): number | null {
    const anchor = parseLocalDate(raw);
    if (Number.isNaN(anchor.getTime())) return null;
    const diff = now.getTime() - anchor.getTime();
    return diff > 0 ? Math.floor(diff / 86_400_000) : null;
}
