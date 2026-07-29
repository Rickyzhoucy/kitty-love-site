from typing import Protocol

from langchain_openai import OpenAIEmbeddings

from app.config import Settings, get_settings


class EmbeddingProvider(Protocol):
    dimensions: int
    provider_name: str
    model_name: str

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...


class UnavailableEmbeddingProvider:
    provider_name = "unavailable"
    model_name = "unavailable"

    def __init__(self, dimensions: int = 1024):
        self.dimensions = dimensions

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        del texts
        raise RuntimeError("Embedding API 未配置")

    async def embed_query(self, text: str) -> list[float]:
        del text
        raise RuntimeError("Embedding API 未配置")


class OpenAICompatibleEmbeddingProvider:
    provider_name = "openai-compatible"

    def __init__(self, settings: Settings | None = None):
        config = settings or get_settings()
        self.dimensions = config.embedding_dimensions
        self.model_name = config.embedding_model
        self._client = OpenAIEmbeddings(
            model=config.embedding_model,
            base_url=config.embedding_base_url,
            api_key=config.embedding_api_key,
            dimensions=config.embedding_dimensions,
            check_embedding_ctx_length=False,
        )

    def _validate(self, vectors: list[list[float]]) -> list[list[float]]:
        if any(len(vector) != self.dimensions for vector in vectors):
            raise ValueError(f"Embedding API 必须返回 {self.dimensions} 维向量")
        return vectors

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._validate(await self._client.aembed_documents(texts))

    async def embed_query(self, text: str) -> list[float]:
        vectors = self._validate([await self._client.aembed_query(text)])
        return vectors[0]
