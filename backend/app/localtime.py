"""站点本地时间。

## 为什么需要这个模块

这个站是给**一对住在同一个地方的人**用的。「今天的心情」「今天这一问」
「深夜别说话」——这些词里的时间全都是他们墙上那只钟的时间，不是服务器的。

而容器跑在 UTC（compose 里只有 postgres 设了 TZ）。于是原先散在各处的
`date.today()` 和 `datetime.now(UTC).date()` 拿到的都是 UTC 日期，在东八区
会出两类错，而且都不像 bug、像玄学：

1. **凌晨 0 点到 8 点，后端的「今天」还是昨天。** 用户十二点半打卡心情，
   前端按浏览器本地日期显示「今天还没记」，后端把它存进了昨天那一格——
   打完卡界面上那个小红点还在。
2. **深夜静默整个反过来了。** `QUIET_HOURS = (23:00, 08:00)` 的注释写着
   「本地小时」，但比较的是 UTC 时刻，等价于本地的 07:00–16:00：宠物白天
   一整天不吭声，后半夜精神抖擞。

所以「本地时间」必须有一个显式的、可配置的来源，而不是依赖进程的 TZ
环境变量——后者在 Docker、CI、开发机上各不相同，是最不该拿来当语义的东西。

## 用法

需要「墙上时钟」语义的地方用 `local_now()` / `local_today()`；
需要**时刻**（落库、比较先后、算时长）的地方仍然用 `utcnow()`——
那些场景与用户在哪个时区无关，转成本地反而会在夏令时上出错。
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import get_settings

logger = logging.getLogger(__name__)

#: 配的时区名认不出来时的兜底。宁可用一个确定的错时区，也不要在每次
#: 取「今天」的时候抛异常——那会让打卡、每日一问这些功能整个挂掉。
FALLBACK_TIMEZONE = "UTC"


@lru_cache
def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("认不出时区 %s，退回 %s", name, FALLBACK_TIMEZONE)
        return ZoneInfo(FALLBACK_TIMEZONE)


def site_zone() -> ZoneInfo:
    return _zone(get_settings().site_timezone)


def local_now() -> datetime:
    """当地此刻，**带时区**。

    带时区而不是 naive：naive 的本地时间一旦和库里的 aware 时间相减就抛
    TypeError，而且只在特定代码路径上抛。
    """
    return datetime.now(site_zone())


def local_today() -> date:
    """当地的今天。所有按日归档的功能（心情、每日一问）都该用它。"""
    return local_now().date()


def to_local(moment: datetime) -> datetime:
    """把任意时刻换算到当地。

    naive 的输入按 UTC 解释——库里有历史遗留的 naive 时间戳（SQLite 路径），
    当成本地时间会凭空差八小时。
    """
    if moment.tzinfo is None:
        from datetime import UTC

        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(site_zone())
