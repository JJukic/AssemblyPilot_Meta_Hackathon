from app.core.config import Settings
from app.models.inspection import Diagnosis
from app.services.image_processor import ProcessedImage


class MetaClient:
    """Meta-only integration boundary. No SDK or API capabilities are assumed."""

    def __init__(self, settings: Settings):
        self.settings = settings

    async def diagnose(self, image: ProcessedImage, instruction: str) -> Diagnosis:
        raise NotImplementedError(
            "Meta inference is not implemented. Verify the official endpoint, "
            "vision payload, authentication and Muse Spark model ID before integration."
        )
