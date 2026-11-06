"""Independent PDF acceptance via pypdf/pdfplumber (not the PDF writer).

Run after verify-drawing-pdf.mjs. Coordinates here are physical PDF points.
"""
import json
import math
import sys
from pathlib import Path
import pdfplumber
from pypdf import PdfReader

folder = Path(sys.argv[1] if len(sys.argv) > 1 else ".verification/drawing-pdf")
point = 72 / 25.4
sizes = {"active": [(297, 210)], "detail": [(210, 297)], "all": [(297, 210), (210, 297)]}
results = {}
for name, dimensions in sizes.items():
    reader = PdfReader(folder / f"{name}.pdf")
    assert len(reader.pages) == len(dimensions)
    assert reader.trailer["/Root"]["/ViewerPreferences"]["/PrintScaling"] == "/None"
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "Ω" in text
    if name != "detail":
        for expected in ("24.00", "Ø6.00", "Угол 90° ±0.1 mm", "Section A-A"):
            assert expected in text, (name, expected, text)
    for page, (width, height) in zip(reader.pages, dimensions):
        assert math.isclose(float(page.mediabox.width), width * point, abs_tol=1e-8)
        assert math.isclose(float(page.mediabox.height), height * point, abs_tol=1e-8)
        for font_ref in page["/Resources"]["/Font"].values():
            font = font_ref.get_object()
            assert "/ToUnicode" in font
            descriptor = font["/DescendantFonts"][0].get_object()["/FontDescriptor"]
            assert len(descriptor["/FontFile2"].get_data()) > 1000
    with pdfplumber.open(folder / f"{name}.pdf") as pdf:
        for page in pdf.pages:
            assert not page.images, "Drawing export must remain vector"
            assert page.curves or page.lines
            for char in page.chars:
                assert char["x0"] >= 0 and char["x1"] <= page.width
                assert char["top"] >= 0 and char["bottom"] <= page.height
        if name != "detail":
            page = pdf.pages[0]
            dimension = next(word for word in page.extract_words() if word["text"] == "24.00")
            # Shared dimension graphics centre the label in a gap in the line.
            # Check actual ink separation, not the obsolete right-offset layout.
            dimension_lines = [line for line in page.lines
                               if math.isclose(line["x0"], 90 * point, abs_tol=1e-6)
                               and math.isclose(line["x1"], 90 * point, abs_tol=1e-6)]
            assert len(dimension_lines) == 2
            assert all(line["bottom"] <= dimension["top"] or line["top"] >= dimension["bottom"]
                       for line in dimension_lines), "Dimension line crosses its label"
            strokes = [*page.curves, *page.lines, *page.rects]
            # The independent reader reports transformed physical points.
            widths = {round(stroke["linewidth"] / point, 2) for stroke in strokes}
            assert {0.15, 0.18, 0.2, 0.3, 0.35} <= widths, widths
            hatches = [stroke for stroke in strokes if math.isclose(stroke["linewidth"], 0.15 * point)]
            assert len(hatches) > 5
            for stroke in hatches:
                left, right = stroke["x0"] / point, stroke["x1"] / point
                # Section origin x=195; bore radius 3 at paper scale 2.
                assert right <= 189.0001 or left >= 200.9999, (left, right)
            dashed = [stroke for stroke in strokes if math.isclose(stroke["linewidth"], 0.18 * point)]
            assert dashed and all(stroke["dash"] == ([3, 2], 0) for stroke in dashed)
    results[name] = {"pages": len(dimensions), "embedded_unicode": True, "vector": True}
print(json.dumps({"status": "passed", "files": results, "bore_hatch_clipping": True}))
