"""Cognition Agent 的输出校验与认知队列的闸门（架构文档 §4.2 / §5）。"""

import pytest

from app.agents.cognition import CognitionAgent, CognitionInput, parse_proposal
from app.cognition_queue import (
    DAILY_PROACTIVE_BUDGET,
    BudgetState,
    CognitionQueue,
    CognitionRequest,
    CognitionType,
    RejectReason,
    allow_proactive,
    is_forbidden_trigger,
    proactive_gap_seconds,
)

VALID = (
    '{"goal":"seekAttention","emotion":"curious","reason":"用户很久没互动了",'
    '"utterance":"忙完了吗？","capabilityRequest":null,'
    '"memoryProposal":null,"expiresIn":120}'
)


def test_valid_proposal_parses():
    proposal = parse_proposal(VALID)
    assert proposal is not None
    assert proposal.goal == "seekAttention"
    assert proposal.expires_in == 120


def test_code_fence_is_tolerated():
    assert parse_proposal(f"```json\n{VALID}\n```") is not None


@pytest.mark.parametrize(
    "raw",
    [
        "这不是 JSON",
        "[]",
        '{"goal":"seekAttention","expiresIn":99999}',   # 超出 10..600
        '{"goal":"comfort"}',                            # 系统里不存在的目标
        "",
    ],
)
def test_bad_output_is_dropped_not_raised(raw):
    """校验失败一律静默丢弃，绝不抛给调用方（架构文档 §2 原则 2）。"""
    assert parse_proposal(raw) is None


def test_out_of_range_emotion_falls_back_instead_of_dropping():
    """情绪越界不值得丢掉整条提案，回落到中性即可。"""
    proposal = parse_proposal('{"goal":"play","emotion":"ecstatic"}')
    assert proposal is not None
    assert proposal.emotion == "normal"


def test_write_capability_request_is_stripped():
    """宠物只能建议、不得擅自执行写操作（架构文档 §6.4）。"""
    proposal = parse_proposal(
        '{"goal":"observe","capabilityRequest":"site.memo.delete"}'
    )
    assert proposal is not None
    assert proposal.capability_request is None


def test_read_capability_request_survives():
    proposal = parse_proposal(
        '{"goal":"observe","capabilityRequest":"site.reminder.list"}'
    )
    assert proposal is not None
    assert proposal.capability_request == "site.reminder.list"


class TimingOutModel:
    async def ainvoke(self, messages):
        del messages
        raise TimeoutError


class ExplodingModel:
    async def ainvoke(self, messages):
        del messages
        raise RuntimeError("provider down")


def _input() -> CognitionInput:
    return CognitionInput(
        needs={"hunger": 0.3},
        mood={},
        relationship={},
        page="/",
        local_time="12:00",
        recent_interactions=[],
        memories=[],
        active_task=None,
        proactive_budget_left=5,
    )


@pytest.mark.parametrize("model", [TimingOutModel(), ExplodingModel()])
async def test_agent_failure_never_propagates(model):
    """模型挂了、超时了，用户应该完全察觉不到。"""
    assert await CognitionAgent(model).think(_input()) is None


# ---- 认知队列 ----


@pytest.mark.parametrize(
    "trigger",
    ["pointer.move", "gaze.follow", "pet.blink", "needs.decay", "pet.tapHead"],
)
def test_high_frequency_triggers_can_never_reach_the_model(trigger):
    """连续移动鼠标五分钟，模型调用次数必须是 0（架构文档 §16）。"""
    assert is_forbidden_trigger(trigger)
    queue = CognitionQueue()
    rejection = queue.submit(
        CognitionRequest(type=CognitionType.PROACTIVE_THOUGHT), 0.0, trigger=trigger
    )
    assert rejection is RejectReason.FORBIDDEN
    assert len(queue) == 0


def test_user_message_outranks_the_pets_own_thoughts():
    queue = CognitionQueue()
    queue.submit(
        CognitionRequest(type=CognitionType.PROACTIVE_THOUGHT, dedupe_key="a"), 0.0
    )
    queue.submit(
        CognitionRequest(type=CognitionType.USER_MESSAGE, dedupe_key="b"), 0.0
    )
    assert queue.pop(0.0).type is CognitionType.USER_MESSAGE


def test_debounce_collapses_a_burst():
    queue = CognitionQueue()
    first = queue.submit(
        CognitionRequest(type=CognitionType.IMPORTANT_EVENT, dedupe_key="k"), 0.0
    )
    second = queue.submit(
        CognitionRequest(type=CognitionType.IMPORTANT_EVENT, dedupe_key="k"), 1.0
    )
    assert first is None
    assert second is RejectReason.DEBOUNCED


def test_expired_requests_are_dropped_on_pop():
    """五分钟前的「想主动说话」现在跑出来只会答非所问。"""
    queue = CognitionQueue()
    queue.submit(
        CognitionRequest(
            type=CognitionType.PROACTIVE_THOUGHT, dedupe_key="k", expires_at=100.0
        ),
        0.0,
    )
    assert queue.pop(101.0) is None


def test_cancel_removes_without_popping():
    queue = CognitionQueue()
    queue.submit(
        CognitionRequest(type=CognitionType.TASK_PLANNING, dedupe_key="k"), 0.0
    )
    assert queue.cancel("k") is True
    assert queue.pop(0.0) is None


def test_daily_proactive_budget_is_enforced():
    budget = BudgetState(daily_proactive_count=DAILY_PROACTIVE_BUDGET)
    queue = CognitionQueue(budget)
    rejection = queue.submit(
        CognitionRequest(type=CognitionType.PROACTIVE_THOUGHT), 1e9
    )
    assert rejection is RejectReason.PROACTIVE_BUDGET


@pytest.mark.parametrize("field", ["quiet_mode", "initiative_off"])
def test_user_can_turn_proactivity_off(field):
    """设置面板必须能关掉主动交流（架构文档 §10）。"""
    assert allow_proactive(BudgetState(**{field: True}), 1e9) is False


def test_dismissal_rate_stretches_the_gap():
    """用户连着推开，间隔就该拉长，而不是继续按原节奏敲门。"""
    calm = proactive_gap_seconds(BudgetState(user_dismissal_rate=0.0))
    annoyed = proactive_gap_seconds(BudgetState(user_dismissal_rate=1.0))
    assert annoyed > calm * 3


def test_budget_is_only_spent_on_a_real_call():
    """被拒绝的请求不该扣额度。"""
    queue = CognitionQueue()
    request = CognitionRequest(type=CognitionType.PROACTIVE_THOUGHT, dedupe_key="k")
    queue.submit(request, 1e9)
    assert queue.budget.daily_proactive_count == 0
    queue.record_call(queue.pop(1e9), 1e9)
    assert queue.budget.daily_proactive_count == 1
