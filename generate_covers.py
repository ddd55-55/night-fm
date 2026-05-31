"""Generate simple but stylish cover art images for the music player."""
import os
from PIL import Image, ImageDraw

OUTPUT_DIR = "covers"
SIZE = 400  # square cover


def create_gradient(width, height, color1, color2, angle=45):
    """Create a gradient image from color1 to color2."""
    import math
    img = Image.new("RGB", (width, height))
    for y in range(height):
        for x in range(width):
            # Calculate position along gradient
            t = (x * math.cos(math.radians(angle)) + y * math.sin(math.radians(angle))) / (
                width * math.cos(math.radians(angle)) + height * math.sin(math.radians(angle))
            )
            t = max(0, min(1, t))
            r = int(color1[0] * (1 - t) + color2[0] * t)
            g = int(color1[1] * (1 - t) + color2[1] * t)
            b = int(color1[2] * (1 - t) + color2[2] * t)
            img.putpixel((x, y), (r, g, b))
    return img


def draw_centered_text(draw, text, y, font_size, color, width):
    """Draw centered text (approximate)."""
    # Simple approach: draw a circle or shape instead of text
    # Since font rendering varies, we'll use geometric shapes
    pass


def create_cover(filename, bg_color1, bg_color2, accent_color, shapes="circles"):
    """Create a cover image with gradient background and geometric shapes."""
    img = create_gradient(SIZE, SIZE, bg_color1, bg_color2)
    draw = ImageDraw.Draw(img)

    center = SIZE // 2

    if shapes == "circles":
        # Concentric circles
        for i, r in enumerate([160, 130, 90, 50]):
            alpha = 255 - i * 30
            color = tuple(int(c * (1 - i * 0.12)) for c in accent_color)
            draw.ellipse([center - r, center - r, center + r, center + r],
                         outline=color, width=3)

    elif shapes == "triangles":
        # Triangle pattern
        for offset in [0, 40, -40]:
            pts = [
                (center, 60 + offset),
                (center - 130, 320 + offset),
                (center + 130, 320 + offset),
            ]
            draw.polygon(pts, outline=accent_color, width=2)

    elif shapes == "rectangles":
        # Rotated square pattern
        for size in [250, 180, 110, 50]:
            half = size // 2
            draw.rectangle(
                [center - half, center - half, center + half, center + half],
                outline=accent_color, width=2
            )

    elif shapes == "waves":
        # Sine wave approximation
        for offset in [30, 80, 130]:
            points = []
            for x in range(0, SIZE, 3):
                import math
                y = center + offset * math.sin(x / 40 + offset / 20)
                points.append((x, int(y)))
            for i in range(len(points) - 1):
                draw.line([points[i], points[i + 1]], fill=accent_color, width=2)

    elif shapes == "dots":
        # Scattered dots pattern
        import random
        random.seed(42)
        for _ in range(60):
            x = random.randint(30, SIZE - 30)
            y = random.randint(30, SIZE - 30)
            r = random.randint(3, 8)
            alpha = random.randint(80, 200)
            color = tuple(min(255, int(c * alpha / 255)) for c in accent_color)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)

    filepath = os.path.join(OUTPUT_DIR, filename)
    img.save(filepath, "PNG")
    print(f"  Saved: {filepath}")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("Generating cover art...")

    covers = [
        # (filename, gradient_start, gradient_end, accent_color, shape_style)
        ("chill-ambient.png", (15, 30, 60), (40, 80, 120), (100, 180, 255), "waves"),
        ("upbeat-energetic.png", (180, 40, 20), (200, 90, 30), (255, 160, 60), "triangles"),
        ("lofi-beat.png", (40, 20, 50), (80, 50, 90), (180, 130, 255), "dots"),
        ("cinematic.png", (10, 10, 40), (25, 25, 60), (150, 150, 200), "rectangles"),
        ("synthwave.png", (80, 10, 80), (20, 10, 60), (255, 60, 200), "circles"),
    ]

    for args in covers:
        create_cover(*args)

    print(f"All covers saved to: {os.path.abspath(OUTPUT_DIR)}/")


if __name__ == "__main__":
    main()
