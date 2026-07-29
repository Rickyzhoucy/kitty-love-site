from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import hash_password
from app.db import get_session
from app.main import create_app
from app.models import Base, User


@pytest_asyncio.fixture
async def session_maker(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with maker() as db:
        db.add(
            User(
                username="daniela",
                display_name="Daniela",
                password_hash=hash_password("secret-password"),
            )
        )
        await db.commit()
    yield maker
    await engine.dispose()


@pytest_asyncio.fixture
async def client(session_maker) -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def test_session():
        async with session_maker() as db:
            yield db

    app.dependency_overrides[get_session] = test_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http


@pytest_asyncio.fixture
async def authenticated_client(client: AsyncClient) -> AsyncClient:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    assert response.status_code == 200
    return client
