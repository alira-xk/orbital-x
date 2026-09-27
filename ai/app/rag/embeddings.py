from functools import lru_cache


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str):
        self.model_name = model_name

    @property
    @lru_cache(maxsize=1)
    def model(self):
        from sentence_transformers import SentenceTransformer
        return SentenceTransformer(self.model_name)

    def encode(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts, normalize_embeddings=True).tolist()
