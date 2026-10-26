from app.models.inspection import Verification
from app.services.image_processor import ProcessedImage


class VerificationAgent:
    async def verify(self, new_image: ProcessedImage, instruction: str) -> Verification:
        raise NotImplementedError("Meta repair verification is not implemented in Phase 1")
