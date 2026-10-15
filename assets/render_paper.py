#!/usr/bin/env python3
"""Render the rebuilt paper to viewable HTML and PDF.

Reads `assets/Meta_Society_IEEE_Format_Completed.docx` (the deliverable), parses
its OOXML into a small block model, and emits:

  assets/Meta_Society_IEEE_Format_Completed.html   (self-contained; figure inlined)
  assets/Meta_Society_IEEE_Format_Completed.pdf    (via reportlab, if importable)

The DOCX remains the canonical artefact; these are derived views so the paper can
be read without a Word processor.

Run from the project root:
    python3 assets/render_paper.py
"""

import base64
import html
import os
import re
import zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
DOCX = os.path.join(HERE, "Meta_Society_IEEE_Format_Completed.docx")
HTML_OUT = os.path.join(HERE, "Meta_Society_IEEE_Format_Completed.html")
PDF_OUT = os.path.join(HERE, "Meta_Society_IEEE_Format_Completed.pdf")

W = "http://purl.oclc.org/ooxml/wordprocessingml/main"
NS = {"w": W}


def qn(tag):
    return "{%s}%s" % (W, tag)


# --------------------------------------------------------------------------
# Parse the DOCX into blocks
# --------------------------------------------------------------------------
def parse_paragraph(el):
    style = ""
    ppr = el.find(qn("pPr"))
    if ppr is not None:
        ps = ppr.find(qn("pStyle"))
        if ps is not None:
            style = ps.get(qn("val")) or ""
    runs = []
    for r in el.findall(qn("r")):
        txt = "".join(t.text or "" for t in r.findall(qn("t")))
        if txt == "":
            continue
        bold = r.find(qn("rPr") + "/" + qn("b")) is not None
        italic = r.find(qn("rPr") + "/" + qn("i")) is not None
        runs.append({"text": txt, "bold": bold, "italic": italic})
    return {"type": "p", "style": style, "runs": runs}


def parse_table(el):
    rows = []
    for tr in el.findall(qn("tr")):
        cells = []
        for tc in tr.findall(qn("tc")):
            text = ""
            style = ""
            for p in tc.findall(qn("p")):
                pb = parse_paragraph(p)
                if not style and pb["style"]:
                    style = pb["style"]
                text += "".join(r["text"] for r in pb["runs"])
            cells.append({"text": text, "style": style})
        rows.append(cells)
    return {"type": "table", "rows": rows}


def parse_blocks():
    z = zipfile.ZipFile(DOCX)
    xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    body = root.find(qn("body"))
    blocks = []
    for child in list(body):
        if child.tag == qn("p"):
            blocks.append(parse_paragraph(child))
        elif child.tag == qn("tbl"):
            blocks.append(parse_table(child))
    media = None
    if "word/media/image1.png" in z.namelist():
        media = z.read("word/media/image1.png")
    return blocks, media


# --------------------------------------------------------------------------
# HTML
# --------------------------------------------------------------------------
def runs_html(runs):
    out = []
    for r in runs:
        t = html.escape(r["text"])
        if r["bold"]:
            t = "<b>%s</b>" % t
        if r["italic"]:
            t = "<i>%s</i>" % t
        out.append(t)
    return "".join(out)


def to_html(blocks, media):
    fig = ""
    if media:
        b64 = base64.b64encode(media).decode("ascii")
        fig = (
            '<figure><img alt="Meta Society system architecture" '
            'style="max-width:100%%" src="data:image/png;base64,%s"/>'
            "<figcaption>Fig. 1. Meta Society system architecture. The upper path is the AI Policy "
            "Advisor; the lower paths are the Simulation Lab (census-anchored citizen population, "
            "Bayesian network, Differential Evolution search) and the shared storage layer."
            "</figcaption></figure>" % b64
        )
    out = [
        "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>",
        "<title>Meta Society — rebuilt completed paper</title>",
        "<style>",
        "body{max-width:820px;margin:2rem auto;padding:0 1.2rem;font-family:Georgia,'Times New Roman',serif;line-height:1.45;color:#111}",
        ".papertitle{font-size:1.6rem;font-weight:700;text-align:center;margin:.2rem 0}",
        ".Author{text-align:center;font-size:1.02rem;margin:.35rem 0 0}",
        ".Affiliation{text-align:center;font-style:italic;font-size:.85rem;color:#333;margin:.1rem 0 .7rem}",
        ".Abstract{font-size:.95rem;margin:.8rem 0}",
        ".Keywords{font-size:.95rem;margin:.4rem 0 1.2rem}",
        "h2{font-size:1.05rem;margin:1.4rem 0 .4rem}",
        "h3{font-size:.98rem;font-style:italic;margin:1rem 0 .3rem}",
        "p{font-size:.95rem;text-align:justify;margin:.45rem 0}",
        "table{border-collapse:collapse;width:100%;margin:.6rem 0;font-size:.82rem}",
        "th,td{border:1px solid #666;padding:.32rem .45rem;text-align:left;vertical-align:top}",
        "th{background:#f2f2f2}",
        ".figurecaption{font-size:.8rem;text-align:center;color:#333}",
        "figure{margin:1rem 0;text-align:center}",
        "figcaption{font-size:.8rem;color:#333;text-align:center}",
        "hr{border:0;border-top:1px solid #bbb;margin:1.4rem 0}",
        ".footnote{font-size:.8rem;color:#444;border-top:1px solid #ccc;padding-top:.4rem;margin-top:1.6rem}",
        "</style></head><body>",
        "<p class='footnote'>Derived view of <code>Meta_Society_IEEE_Format_Completed.docx</code> "
        "(newly rebuilt paper; not the recovered artefact). The DOCX is the canonical file.</p>",
    ]

    first_title_done = False
    for b in blocks:
        if b["type"] == "table":
            rows = b["rows"]
            out.append("<table>")
            for i, row in enumerate(rows):
                tag = "th" if i == 0 else "td"
                out.append("<tr>" + "".join(
                    "<%s>%s</%s>" % (tag, html.escape(c["text"]), tag) for c in row) + "</tr>")
            out.append("</table>")
            continue
        st = b["style"]
        inner = runs_html(b["runs"])
        if not inner.strip():
            continue
        if st == "papertitle":
            out.append("<h1 class='papertitle'>%s</h1>" % inner)
            first_title_done = True
        elif st == "Author":
            out.append("<div class='Author'>%s</div>" % inner)
        elif st == "Affiliation":
            out.append("<div class='Affiliation'>%s</div>" % inner)
        elif st == "Abstract":
            out.append("<p class='Abstract'>%s</p>" % inner)
        elif st == "Keywords":
            out.append("<p class='Keywords'>%s</p>" % inner)
        elif st == "Heading1":
            label = re.sub(r"<[^>]+>", "", inner)
            if label.strip().upper().startswith("REFERENCES"):
                out.append("<hr/><h2>%s</h2>" % inner)
            elif "INTRODUCTION" in label.upper() and first_title_done:
                out.append("<hr/><h2>%s</h2>" % inner)
            else:
                out.append("<h2>%s</h2>" % inner)
        elif st == "Heading2":
            out.append("<h3>%s</h3>" % inner)
        elif st == "figurecaption":
            out.append("<p class='figurecaption'>%s</p>" % inner)
        elif st == "references":
            out.append("<p style='font-size:.8rem'>%s</p>" % inner)
        else:
            if inner.strip().startswith("\u2022"):
                out.append("<p style='margin-left:1.2rem'>%s</p>" % inner)
            else:
                out.append("<p>%s</p>" % inner)
        # insert the figure right after the first figure caption block
        if st == "figurecaption" and fig and "Fig. 1" in inner:
            out.append(fig)
    out.append("</body></html>")
    return "\n".join(out)


# --------------------------------------------------------------------------
# PDF (reportlab)
# --------------------------------------------------------------------------
def to_pdf(blocks, media, path):
    try:
        from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (Image, Paragraph, SimpleDocTemplate,
                                        Spacer, Table, TableStyle)
        from reportlab.lib import colors
    except Exception as exc:  # pragma: no cover
        print("reportlab unavailable:", exc)
        return False

    # Register a Unicode TTF if present so the rupee sign and dashes render.
    base_font, bold_font, italic_font = "Times-Roman", "Times-Bold", "Times-Italic"
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        _mpl = "/opt/freestyle/python/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf"
        for reg, bold, italic, name in [
            (os.path.join(_mpl, "DejaVuSans.ttf"),
             os.path.join(_mpl, "DejaVuSans-Bold.ttf"),
             os.path.join(_mpl, "DejaVuSans-Oblique.ttf"), "DejaVu"),
            ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", "DejaVu"),
        ]:
            if os.path.exists(reg):
                pdfmetrics.registerFont(TTFont(name, reg))
                pdfmetrics.registerFont(TTFont(name + "-B", bold))
                pdfmetrics.registerFont(TTFont(name + "-I", italic))
                pdfmetrics.registerFontFamily(name, normal=name, bold=name + "-B", italic=name + "-I")
                base_font, bold_font, italic_font = name, name + "-B", name + "-I"
                break
    except Exception:
        pass

    def esc(s):
        return html.escape(s).replace("\u2022", "\u2022")

    styles = {
        "papertitle": ParagraphStyle("papertitle", fontName=bold_font, fontSize=15,
                                     leading=18, alignment=TA_CENTER, spaceAfter=8),
        "Author": ParagraphStyle("Author", fontName=base_font, fontSize=10.5,
                                 leading=13, alignment=TA_CENTER),
        "Affiliation": ParagraphStyle("Affiliation", fontName=italic_font, fontSize=8.6,
                                      leading=11, alignment=TA_CENTER, textColor=colors.HexColor("#333333"),
                                      spaceAfter=8),
        "Abstract": ParagraphStyle("Abstract", fontName=base_font, fontSize=9, leading=11.6,
                                   alignment=TA_JUSTIFY, spaceAfter=6),
        "Keywords": ParagraphStyle("Keywords", fontName=base_font, fontSize=9, leading=11.6,
                                   alignment=TA_JUSTIFY, spaceAfter=10),
        "Heading1": ParagraphStyle("Heading1", fontName=bold_font, fontSize=10.5, leading=13,
                                   spaceBefore=12, spaceAfter=4),
        "Heading2": ParagraphStyle("Heading2", fontName=bold_font, fontSize=9.6, leading=12,
                                   spaceBefore=8, spaceAfter=3),
        "BodyText": ParagraphStyle("BodyText", fontName=base_font, fontSize=9, leading=11.8,
                                   alignment=TA_JUSTIFY, spaceAfter=5),
        "figurecaption": ParagraphStyle("figurecaption", fontName=italic_font, fontSize=7.8,
                                        leading=10, alignment=TA_CENTER, textColor=colors.HexColor("#333333"),
                                        spaceAfter=8, spaceBefore=3),
        "references": ParagraphStyle("references", fontName=base_font, fontSize=7.8, leading=10,
                                     alignment=TA_JUSTIFY, leftIndent=10, firstLineIndent=-10, spaceAfter=3),
        "tablehead": ParagraphStyle("tablehead", fontName=bold_font, fontSize=7.8, leading=10),
        "tablecopy": ParagraphStyle("tablecopy", fontName=base_font, fontSize=7.6, leading=9.6),
    }

    def inline(runs):
        parts = []
        for r in runs:
            t = esc(r["text"])
            if r["bold"]:
                t = "<b>%s</b>" % t
            if r["italic"]:
                t = "<i>%s</i>" % t
            parts.append(t)
        return "".join(parts)

    story = []
    fig_embed = None
    if media:
        tmp = "/tmp/ms_fig1.png"
        with open(tmp, "wb") as fh:
            fh.write(media)
        fig_embed = tmp

    for b in blocks:
        if b["type"] == "table":
            data = []
            for i, row in enumerate(b["rows"]):
                style = styles["tablehead"] if i == 0 else styles["tablecopy"]
                data.append([Paragraph(esc(c["text"]), style) for c in row])
            if data:
                t = Table(data, repeatRows=1)
                t.setStyle(TableStyle([
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#666666")),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f2f2f2")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 2),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ]))
                story.append(Spacer(1, 4))
                story.append(t)
                story.append(Spacer(1, 6))
            continue
        st = b["style"] if b["style"] in styles else "BodyText"
        inner = inline(b["runs"])
        if not inner.strip():
            continue
        story.append(Paragraph(inner, styles[st]))
        if st == "figurecaption" and fig_embed and "Fig. 1" in b["runs"][0]["text"]:
            try:
                img = Image(fig_embed)
                maxw = 6.0 * inch
                ratio = img.imageHeight / float(img.imageWidth)
                img.drawWidth = maxw
                img.drawHeight = maxw * ratio
                story.insert(len(story) - 1, img)
                story.insert(len(story) - 1, Spacer(1, 6))
            except Exception:
                pass

    doc = SimpleDocTemplate(path, pagesize=LETTER,
                            leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                            topMargin=0.9 * inch, bottomMargin=0.9 * inch,
                            title="Meta Society — rebuilt completed paper",
                            author="Chaugule, Kulkarni, Jadhav, Dongre")
    doc.build(story)
    return True


def main():
    blocks, media = parse_blocks()
    with open(HTML_OUT, "w", encoding="utf-8") as fh:
        fh.write(to_html(blocks, media))
    print("Wrote", HTML_OUT, os.path.getsize(HTML_OUT), "bytes")
    ok = to_pdf(blocks, media, PDF_OUT)
    if ok:
        print("Wrote", PDF_OUT, os.path.getsize(PDF_OUT), "bytes")
    else:
        print("PDF not produced (reportlab unavailable)")


if __name__ == "__main__":
    main()
