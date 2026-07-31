"""对话上下文的自动压缩。

用的是 LangChain 自带的 `SummarizationMiddleware`，所以这里**不测它的摘要质量**
——那是上游的事。测的是我们这一侧的接线：阈值是不是按配置算的、换模型时改一个
值够不够、以及它确实挂进了 Agent。
"""

import pytest

from app.agents.conversation import build_agent, build_chat_model, build_compaction_middleware
from app.config import Settings


def _settings(**overrides) -> Settings:
    return Settings(chat_api_key="test-key", **overrides)


def test_threshold_follows_the_configured_context_size():
    """换模型时只改 chat_context_tokens，触发点自动跟着走。"""
    small = _settings(chat_context_tokens=100_000, chat_compact_at=0.5)
    middleware = build_compaction_middleware(build_chat_model(small), small)
    assert middleware.trigger == ("tokens", 50_000)


def test_default_budget_is_256k():
    """默认按 256k 上下文配（用户指定），留 25% 余量给压缩那一次调用本身。"""
    config = _settings()
    assert config.chat_context_tokens == 256_000
    middleware = build_compaction_middleware(build_chat_model(config), config)
    assert middleware.trigger == ("tokens", 192_000)


def test_keeps_recent_messages_verbatim():
    """全摘掉的话，用户会感觉宠物「刚说完就忘」。"""
    config = _settings(chat_compact_keep_messages=12)
    middleware = build_compaction_middleware(build_chat_model(config), config)
    assert middleware.keep == ("messages", 12)


@pytest.mark.parametrize("ratio", [0.0, 1.0, 1.5, -0.2])
def test_rejects_a_nonsensical_trigger_ratio(ratio):
    """比例必须留余量：卡到 100% 再压缩，那次压缩调用自己就超长了。"""
    with pytest.raises(ValueError):
        _settings(chat_compact_at=ratio)


@pytest.mark.parametrize("size", [1_000, 8_000_000])
def test_rejects_an_absurd_context_size(size):
    with pytest.raises(ValueError):
        _settings(chat_context_tokens=size)


def test_agent_actually_gets_the_middleware(session_maker):
    """接上了才算数——构造得出来但没挂进去是这类改动最常见的失败方式。"""
    config = _settings()
    agent = build_agent(build_chat_model(config), None, session_maker)
    # create_agent 把 middleware 编译进图里，检查节点名里有摘要那一步
    node_names = set(agent.get_graph().nodes)
    assert any("summar" in name.lower() for name in node_names), node_names
