from app.agents.correction import CorrectionAgent
from app.agents.perception import PerceptionAgent
from app.agents.verification import VerificationAgent
from app.models.inspection import CorrectionPlan, Diagnosis, Verification
from app.services.image_processor import ProcessedImage


class AssemblyOrchestrator:
    """Explicit operations: verification requires a NEW image after the human repair."""

    def __init__(
        self,
        perception: PerceptionAgent,
        correction: CorrectionAgent,
        verification: VerificationAgent,
    ):
        self.perception = perception
        self.correction = correction
        self.verification = verification

    async def inspect(
        self, image: ProcessedImage, instruction: str
    ) -> tuple[Diagnosis, CorrectionPlan]:
        diagnosis = await self.perception.diagnose(image, instruction)
        return diagnosis, await self.correction.plan(diagnosis, instruction)

    async def verify_repair(self, new_image: ProcessedImage, instruction: str) -> Verification:
        return await self.verification.verify(new_image, instruction)
