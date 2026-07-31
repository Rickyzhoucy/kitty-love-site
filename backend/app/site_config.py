"""站点配置的默认值与读取（后台「基础设置」那一页改的东西）。

## 为什么默认值必须在服务端

`main_timer_date`（在一起的起始日）原本**只以字面量的形式存在于前端**，而且
存在两处：`app/page.tsx` 里 `data.main_timer_date || '2025-11-30'`，
`app/admin/config/page.tsx` 里再写一遍。`SiteConfig` 表是空的，所以首页天天
显示的「在一起第 243 天」其实来自一个硬编码。

后果不只是重复：**服务端根本看不到这个数字**。宠物被问「我们在一起多久了」
只能说不知道，而同一时刻首页正大大地写着 243。一个每天都在显示的事实，
宠物不知道，这很荒谬。

所以默认值挪到这里，`/config` 把它兜在存的值下面返回。前端拿到的永远是完整
的配置，不需要自己兜底；宠物读的是同一份。要改默认值，只改这一处。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SiteConfig

#: 没有在后台改过时的取值。**空字符串与「没配」是两回事**——用户可以刻意把
#: 情书正文清空，那时就该是空的，不该弹回默认文案。所以这里只兜「键不存在」。
DEFAULTS: dict[str, str] = {
    # 首页那个「在一起第 N 天」的起点。后台可改。
    "main_timer_date": "2025-11-30",
}

#: 后台允许改的键。默认值里的键必须是它的子集，否则会出现「有默认值但改不了」。
EDITABLE_KEYS = frozenset({"letter_title", "letter_content", "main_timer_date"})

assert set(DEFAULTS) <= EDITABLE_KEYS, "有默认值的配置项必须是可编辑的"


async def load(db: AsyncSession) -> dict[str, str]:
    """完整配置：存过的值盖在默认值上面。"""
    rows = await db.execute(select(SiteConfig.key, SiteConfig.value))
    return {**DEFAULTS, **dict(rows.all())}


async def get(db: AsyncSession, key: str) -> str:
    """单个配置项。没存过就返回默认值，没有默认值就是空串。"""
    stored = await db.scalar(select(SiteConfig.value).where(SiteConfig.key == key))
    if stored is not None:
        return stored
    return DEFAULTS.get(key, "")
