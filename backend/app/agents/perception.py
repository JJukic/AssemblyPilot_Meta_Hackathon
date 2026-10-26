from app.models.inspection import Diagnosis
from app.services.image_processor import ProcessedImage
from app.services.meta_client import MetaClient


class PerceptionAgent:
    def __init__(self, client: MetaClient):
        self.client = client

    async def diagnose(self, image: ProcessedImage, instruction: str) -> Diagnosis:
        return await self.client.diagnose(image, instruction)
