from PIL import Image, ImageDraw

from app.rag.pages import ink_regions, merge_boxes


def page_with(draw_fn, size=(300, 420)):
    image = Image.new("L", size, 255)
    draw_fn(ImageDraw.Draw(image))
    return image


def test_drawing_is_found_and_text_is_ignored():
    def draw(d):
        d.ellipse([60, 60, 240, 240], outline=0, width=3)  # a "part"
        d.rectangle([20, 380, 280, 390], fill=0)  # a "text line" that is covered by glyph boxes below
    # glyphs covering the "text line": PDF points, page height 840, rendered at scale 0.5 (y is flipped)
    glyph_boxes = [(x, 56, x + 14, 84) for x in range(36, 566, 12)]
    regions = ink_regions(page_with(draw), glyph_boxes, height=840)
    assert len(regions) == 1
    (left, _, right, _), grid = regions[0]
    assert not grid and 100 < left < 140 and 440 < right < 500


def test_table_grid_is_flagged():
    def draw(d):
        for y in (40, 100, 160, 220):
            d.line([20, y, 280, y], fill=0, width=2)
        for x in (20, 120, 200, 280):
            d.line([x, 40, x, 220], fill=0, width=2)
    (_, grid), = ink_regions(page_with(draw), [], height=840)
    assert grid


def test_merge_boxes_joins_tiles():
    assert merge_boxes([(0, 0, 10, 10), (10, 0, 20, 10), (100, 100, 110, 110)]) == [(0, 0, 20, 10), (100, 100, 110, 110)]
