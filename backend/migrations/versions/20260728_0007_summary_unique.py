"""Keep one rolling summary per conversation."""

import sqlalchemy as sa
from alembic import op

revision = "20260728_0007"
down_revision = "20260728_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM "ConversationSummary"
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY "conversationId"
                           ORDER BY "createdAt" DESC, id DESC
                       ) AS row_number
                FROM "ConversationSummary"
            ) ranked
            WHERE row_number > 1
        )
        """
    )
    constraints = {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_unique_constraints(
            "ConversationSummary"
        )
    }
    if "ConversationSummary_conversationId_key" not in constraints:
        op.create_unique_constraint(
            "ConversationSummary_conversationId_key",
            "ConversationSummary",
            ["conversationId"],
        )


def downgrade() -> None:
    op.drop_constraint(
        "ConversationSummary_conversationId_key",
        "ConversationSummary",
        type_="unique",
    )
