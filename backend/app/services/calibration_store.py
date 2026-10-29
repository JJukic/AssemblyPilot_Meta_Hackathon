"""Server-owned, versioned JSON profiles. No photos or arbitrary API paths."""

from pathlib import Path
from uuid import UUID

import cv2

from app.models.calibration import CalibrationProfile


class CalibrationStore:
    def __init__(self, root: Path):
        self.root = root

    def save(self, profile: CalibrationProfile):
        self.root.mkdir(parents=True, exist_ok=True)
        if len(list(self.root.glob("*.json"))) >= 100:
            raise ValueError(
                "Calibration profile limit reached (100); archive old profiles locally"
            )
        # Exclusive creation and rename; incomplete files are never listed as profiles.
        temporary = self.root / f"{profile.id}.tmp"
        try:
            with temporary.open("x") as output:
                output.write(profile.model_dump_json(indent=2))
            temporary.replace(self.root / f"{profile.id}.json")
        finally:
            temporary.unlink(missing_ok=True)

    def load(self, profile_id: UUID) -> CalibrationProfile:
        path = self.root / f"{profile_id}.json"
        if path.stat().st_size > 64 * 1024:
            raise ValueError("Calibration profile is invalid")
        profile = CalibrationProfile.model_validate_json(path.read_bytes())
        if profile.opencv_version.split(".")[:2] != cv2.__version__.split(".")[:2]:
            raise ValueError("OpenCV version changed; recalibrate")
        if profile.id != profile_id:
            raise ValueError("Calibration profile identity mismatch")
        return profile

    def list(self):
        profiles, invalid = [], 0
        for path in sorted(self.root.glob("*.json"))[:100]:
            try:
                profiles.append(self.load(UUID(path.stem)))
            except (ValueError, OSError):
                invalid += 1
        return profiles, invalid
