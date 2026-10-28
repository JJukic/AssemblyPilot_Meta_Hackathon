"""Generate a physical-size PDF/PNG plus board metadata; never invokes a printer."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models.calibration import BoardSpec  # noqa: E402
from app.services.charuco_vision import board_image  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New .png or .pdf file")
    parser.add_argument("--squares-x", type=int, default=7)
    parser.add_argument("--squares-y", type=int, default=5)
    parser.add_argument("--square-mm", type=float, default=20)
    parser.add_argument("--marker-mm", type=float, default=15)
    parser.add_argument("--dictionary", default="DICT_4X4_50")
    parser.add_argument("--dpi", type=int, default=300)
    args = parser.parse_args()
    try:
        spec = BoardSpec(
            squares_x=args.squares_x,
            squares_y=args.squares_y,
            square_mm=args.square_mm,
            marker_mm=args.marker_mm,
            dictionary=args.dictionary,
        )
        picture = board_image(spec, args.dpi).convert("RGB")
        if args.output.suffix.lower() not in {".png", ".pdf"}:
            raise ValueError("Output must be PNG or PDF")
        metadata = args.output.with_suffix(".json")
        if args.output.exists() or metadata.exists():
            raise ValueError("Output exists; choose new filenames")
        # PDF uses exact point dimensions via independent DPI, avoiding integer-pixel rounding.
        dpi = (
            picture.width * 25.4 / (spec.squares_x * spec.square_mm),
            picture.height * 25.4 / (spec.squares_y * spec.square_mm),
        )
        with args.output.open("xb") as output:
            picture.save(output, format=args.output.suffix[1:].upper(), dpi=dpi)
        with metadata.open("x") as output:
            json.dump(
                {
                    "schema_version": 1,
                    "board_id": spec.board_id,
                    "board": spec.model_dump(),
                    "pattern_width_mm": spec.squares_x * spec.square_mm,
                    "pattern_height_mm": spec.squares_y * spec.square_mm,
                    "printing": "Print at 100% / actual size. Disable fit-to-page. Keep white "
                    "paper margin outside pattern. Measure both pattern edges before use. "
                    "Mount flat; office-printer scaling is not certified.",
                },
                output,
                indent=2,
            )
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(
        f"Board {spec.board_id}: {spec.squares_x * spec.square_mm:g} × "
        f"{spec.squares_y * spec.square_mm:g} mm. Print actual size and measure both edges."
    )


if __name__ == "__main__":
    main()
