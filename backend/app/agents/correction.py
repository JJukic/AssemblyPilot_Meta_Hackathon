from app.models.inspection import CorrectionPlan, Diagnosis


class CorrectionAgent:
    async def plan(self, diagnosis: Diagnosis, instruction: str) -> CorrectionPlan:
        raise NotImplementedError("Meta correction planning is not implemented in Phase 1")
