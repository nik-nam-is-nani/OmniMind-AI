import re
import logging
from fpdf import FPDF

logger = logging.getLogger(__name__)

def clean_text_for_pdf(text: str) -> str:
    """
    Cleans text by replacing common non-latin-1 Unicode characters (like smart quotes,
    dashes, bullet points) with ASCII equivalents, and encodes/decodes to ignore remaining.
    """
    if not text:
        return ""
    # Replace common Unicode symbols
    replacements = {
        "\u201c": '"',  # Left double quote
        "\u201d": '"',  # Right double quote
        "\u2018": "'",  # Left single quote
        "\u2019": "'",  # Right single quote
        "\u2013": "-",  # En dash
        "\u2014": "--", # Em dash
        "\u2022": "*",  # Bullet point
        "\u2026": "...",# Ellipsis
        "\xa0": " ",    # Non-breaking space
        "\xad": "",     # Soft hyphen
        "\ufffd": "?",  # Replacement character
    }
    for orig, rep in replacements.items():
        text = text.replace(orig, rep)
        
    # Encode as latin-1, replacing any unmappable characters with '?'
    text_bytes = text.encode("latin-1", errors="replace")
    return text_bytes.decode("latin-1")

class PDFReport(FPDF):
    report_date = "2026-06-08"

    def header(self):
        # Header layout
        self.set_font("helvetica", "B", 8)
        self.set_text_color(100, 116, 139) # Slate 500
        self.cell(0, 10, "OmniMind AI - Research & Analytics Report", border=0, align="L")
        self.set_x(self.l_margin)
        self.cell(0, 10, f"Generated: {self.report_date}", border=0, align="R")
        self.ln(8)
        # Horizontal thin separator line
        self.set_draw_color(226, 232, 240) # Slate 200
        self.set_line_width(0.5)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(6)

    def footer(self):
        # Footer layout
        self.set_y(-15)
        self.set_font("helvetica", "I", 8)
        self.set_text_color(148, 163, 184) # Slate 400
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

def generate_pdf_report(session_title: str, query: str, answer: str, model_name: str, date_str: str) -> bytes:
    """
    Renders chat query and markdown answer response into a beautiful, styled PDF document.
    """
    session_title = clean_text_for_pdf(session_title)
    query = clean_text_for_pdf(query)
    answer = clean_text_for_pdf(answer)
    
    pdf = PDFReport()
    pdf.report_date = date_str
    pdf.alias_nb_pages()
    pdf.add_page()
    
    # 1. Main Title
    pdf.set_font("helvetica", "B", 18)
    pdf.set_text_color(15, 23, 42) # Slate 900
    pdf.multi_cell(0, 8, "OmniMind AI - Response Export")
    pdf.ln(2)
    
    # Subheader details
    pdf.set_font("helvetica", "B", 9)
    pdf.set_text_color(79, 70, 229) # Indigo 600
    pdf.cell(0, 6, f"Session Topic: {session_title} | Agent Model: {model_name or 'Auto-router'}")
    pdf.ln(10)
    
    # 2. Section: User Query
    pdf.set_font("helvetica", "B", 11)
    pdf.set_text_color(71, 85, 105) # Slate 600
    pdf.cell(0, 6, "Initial Inquiry:")
    pdf.ln(6)
    
    # Query block styling (light grey fill)
    pdf.set_font("helvetica", "", 9.5)
    pdf.set_text_color(51, 65, 85) # Slate 700
    pdf.set_fill_color(248, 250, 252) # Slate 50
    pdf.set_draw_color(241, 245, 249) # Slate 100
    pdf.multi_cell(0, 5.5, query, border=1, fill=True)
    pdf.ln(8)
    
    # 3. Section: AI Analysis Response
    pdf.set_font("helvetica", "B", 11)
    pdf.set_text_color(71, 85, 105)
    pdf.cell(0, 6, "AI Response Content:")
    pdf.ln(6)
    
    # Body markdown content parser
    pdf.set_font("helvetica", "", 10)
    pdf.set_text_color(15, 23, 42) # Slate 900
    
    lines = answer.split("\n")
    in_code_block = False
    
    for line in lines:
        cleaned_line = line.strip()
        
        # Detect code block delimiters
        if cleaned_line.startswith("```"):
            in_code_block = not in_code_block
            continue
            
        if in_code_block:
            # Code style inside shaded block
            pdf.set_font("courier", "", 8.5)
            pdf.set_text_color(100, 116, 139)
            pdf.set_fill_color(241, 245, 249)
            pdf.multi_cell(0, 4.5, line, border=0, fill=True)
            pdf.set_x(pdf.l_margin)
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(15, 23, 42)
            continue

        if not cleaned_line:
            pdf.ln(3)
            continue
            
        # Headings
        if cleaned_line.startswith("###"):
            pdf.set_font("helvetica", "B", 11)
            pdf.set_text_color(79, 70, 229) # Indigo 600
            pdf.multi_cell(0, 6, cleaned_line.replace("###", "").strip())
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(15, 23, 42)
            pdf.ln(1)
        elif cleaned_line.startswith("##"):
            pdf.set_font("helvetica", "B", 12)
            pdf.set_text_color(15, 23, 42)
            pdf.multi_cell(0, 7, cleaned_line.replace("##", "").strip())
            pdf.set_font("helvetica", "", 10)
            pdf.ln(1)
        elif cleaned_line.startswith("#"):
            pdf.set_font("helvetica", "B", 14)
            pdf.set_text_color(15, 23, 42)
            pdf.multi_cell(0, 8, cleaned_line.replace("#", "").strip())
            pdf.set_font("helvetica", "", 10)
            pdf.ln(2)
        # Bullet list items
        elif cleaned_line.startswith("-") or cleaned_line.startswith("*"):
            bullet_text = cleaned_line[1:].strip()
            pdf.multi_cell(0, 5, f"-  {bullet_text}")
            pdf.ln(0.5)
        # Numbered list items
        elif re.match(r"^\d+\.", cleaned_line):
            pdf.multi_cell(0, 5, cleaned_line)
            pdf.ln(0.5)
        # Normal paragraph
        else:
            pdf.multi_cell(0, 5.5, cleaned_line)
            pdf.ln(1.5)
            
        pdf.set_x(pdf.l_margin)
            
    return bytes(pdf.output())
