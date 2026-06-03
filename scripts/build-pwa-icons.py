"""Regenerate the flat CUBELAB app mark at install icon sizes."""
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]


def render(size: int) -> None:
    scale = size * 4 / 64
    canvas = Image.new("RGB", (size * 4, size * 4), "#0c0c0d")
    draw = ImageDraw.Draw(canvas)

    def points(values: list[tuple[float, float]]) -> list[tuple[int, int]]:
        return [(round(x * scale), round(y * scale)) for x, y in values]

    draw.polygon(points([(32, 9), (52, 20.5), (32, 32), (12, 20.5)]), fill="#e9e5dc")
    draw.polygon(points([(12, 20.5), (32, 32), (32, 55), (12, 43.5)]), fill="#8f8b83")
    draw.polygon(points([(52, 20.5), (32, 32), (32, 55), (52, 43.5)]), fill="#4c4a46")
    draw.polygon(points([(25.3, 28.2), (32, 24.3), (38.7, 28.2), (32, 32)]), fill="#ffffff")
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / "public" / f"icon-{size}.png")


for dimension in (192, 512):
    render(dimension)
