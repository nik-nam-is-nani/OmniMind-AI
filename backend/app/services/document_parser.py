import io
import logging
import zipfile
import re
import xml.etree.ElementTree as ET
import httpx

logger = logging.getLogger(__name__)

def parse_pdf(file_bytes: bytes) -> str:
    """
    Extracts text from a PDF file using the pypdf library.
    """
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        text = []
        for idx, page in enumerate(reader.pages):
            page_text = page.extract_text()
            if page_text:
                text.append(page_text)
        return "\n\n".join(text).strip()
    except ImportError:
        logger.error("pypdf is not installed. Unable to parse PDF.")
        raise ValueError("PDF parsing library (pypdf) is not installed on the server.")
    except Exception as e:
        logger.error(f"Error parsing PDF: {e}")
        raise ValueError(f"Failed to parse PDF document: {str(e)}")

def parse_docx(file_bytes: bytes) -> str:
    """
    Extracts text from a Word (.docx) file by reading word/document.xml inside the zip.
    Resilient and requires zero external python-docx dependencies.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
            if "word/document.xml" not in z.namelist():
                raise ValueError("Not a valid Word Document structure (missing document.xml)")
            
            xml_content = z.read("word/document.xml")
            root = ET.fromstring(xml_content)
            
            paragraphs = []
            for child in root.iter():
                # w:t represents text blocks in OpenXML
                if child.tag.endswith("}t"):
                    if child.text:
                        paragraphs.append(child.text)
                # w:p represents paragraphs, append newline
                elif child.tag.endswith("}p"):
                    paragraphs.append("\n")
                    
            return "".join(paragraphs).strip()
    except Exception as e:
        logger.error(f"Error parsing DOCX Word document: {e}")
        raise ValueError(f"Failed to parse Word Document (.docx): {str(e)}")

def parse_pptx(file_bytes: bytes) -> str:
    """
    Extracts text from a PowerPoint (.pptx) file by reading slide XMLs inside the zip.
    Resilient and requires zero external python-pptx dependencies.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
            # Find and sort all slide files numerically
            slide_files = [f for f in z.namelist() if f.startswith("ppt/slides/slide") and f.endswith(".xml")]
            
            def get_slide_num(filename):
                nums = re.findall(r"\d+", filename)
                return int(nums[0]) if nums else 9999
            
            slide_files.sort(key=get_slide_num)
            
            slides_text = []
            for slide_file in slide_files:
                xml_content = z.read(slide_file)
                root = ET.fromstring(xml_content)
                slide_content = []
                
                for child in root.iter():
                    # a:t contains slide text blocks
                    if child.tag.endswith("}t"):
                        if child.text:
                            slide_content.append(child.text)
                    # sp represents shape separators
                    elif child.tag.endswith("}sp"):
                        slide_content.append(" ")
                
                slides_text.append(f"--- Slide {get_slide_num(slide_file)} ---\n" + "".join(slide_content).strip())
                
            return "\n\n".join(slides_text).strip()
    except Exception as e:
        logger.error(f"Error parsing PPTX PowerPoint presentation: {e}")
        raise ValueError(f"Failed to parse PowerPoint Presentation (.pptx): {str(e)}")

def parse_xlsx(file_bytes: bytes) -> str:
    """
    Extracts text from an Excel (.xlsx) file using openpyxl, falling back to direct XML parse.
    Limits row count per sheet to prevent model context blowups.
    """
    max_excel_rows = 50
    # 1. Attempt standard openpyxl parsing
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheets_data = []
        for sheet in wb.worksheets:
            sheet_rows = []
            sheet_rows.append(f"--- Sheet: {sheet.title} ---")
            row_count = 0
            for row in sheet.iter_rows(values_only=True):
                # Only log row if it contains values
                if any(cell is not None for cell in row):
                    row_count += 1
                    if row_count > max_excel_rows:
                        continue
                    row_str = " | ".join(str(cell) if cell is not None else "" for cell in row)
                    sheet_rows.append(row_str)
            if row_count > max_excel_rows:
                sheet_rows.append(f"\n--- [TRUNCATED: Showing first {max_excel_rows} of {row_count} rows for sheet '{sheet.title}'] ---")
            sheets_data.append("\n".join(sheet_rows))
        return "\n\n".join(sheets_data).strip()
    except Exception as openpyxl_err:
        logger.warning(f"openpyxl parsing failed: {openpyxl_err}. Running XML sharedString zip fallback...")
        
        # 2. Resilient OpenXML zip fallback
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
                # Resolve shared strings lookup table
                shared_strings = []
                if "xl/sharedStrings.xml" in z.namelist():
                    xml_str = z.read("xl/sharedStrings.xml")
                    root_str = ET.fromstring(xml_str)
                    for child in root_str.iter():
                        if child.tag.endswith("}t") and child.text:
                            shared_strings.append(child.text)
                
                # Fetch text from worksheets
                sheet_files = [f for f in z.namelist() if f.startswith("xl/worksheets/sheet") and f.endswith(".xml")]
                def get_sheet_num(filename):
                    nums = re.findall(r"\d+", filename)
                    return int(nums[0]) if nums else 9999
                sheet_files.sort(key=get_sheet_num)
                
                sheets_data = []
                for s_file in sheet_files:
                    xml_sheet = z.read(s_file)
                    root_sheet = ET.fromstring(xml_sheet)
                    rows_text = []
                    current_row = []
                    row_count = 0
                    
                    for child in root_sheet.iter():
                        if child.tag.endswith("}v"): # Cell value node
                          val = child.text or ""
                          # If shared string type 's'
                          if child.attrib.get("t") == "s":
                              try:
                                  idx = int(val)
                                  if 0 <= idx < len(shared_strings):
                                      val = shared_strings[idx]
                              except ValueError:
                                  pass
                          current_row.append(val)
                        elif child.tag.endswith("}row"):
                          if current_row:
                              row_count += 1
                              if row_count <= max_excel_rows:
                                  rows_text.append(" | ".join(current_row))
                              current_row = []
                    
                    if current_row:
                        row_count += 1
                        if row_count <= max_excel_rows:
                            rows_text.append(" | ".join(current_row))
                    
                    sheet_str = f"--- Sheet {get_sheet_num(s_file)} ---\n" + "\n".join(rows_text).strip()
                    if row_count > max_excel_rows:
                        sheet_str += f"\n--- [TRUNCATED: Showing first {max_excel_rows} of {row_count} rows for Sheet {get_sheet_num(s_file)}] ---"
                    sheets_data.append(sheet_str)
                
                return "\n\n".join(sheets_data).strip()
        except Exception as e:
            logger.error(f"Excel zip fallback parsing also failed: {e}")
            raise ValueError(f"Failed to parse Excel Spreadsheet (.xlsx): {str(e)}")

def parse_csv(file_bytes: bytes, max_rows: int = 50) -> str:
    """
    Parses a CSV file, returning a clean structured textual summary.
    If the file is extremely large, it automatically extracts column headers,
    total row count, and a clean preview of the first `max_rows` rows.
    """
    try:
        content = file_bytes.decode("utf-8", errors="replace")
        lines = content.splitlines()
        if not lines:
            return "Empty CSV file."
        
        import csv
        reader = csv.reader(lines)
        rows = list(reader)
        if not rows:
            return "Empty CSV structure."
            
        headers = rows[0]
        total_rows = len(rows) - 1
        num_cols = len(headers)
        
        summary = [
            f"--- CSV DOCUMENT OVERVIEW ---",
            f"Total Rows: {total_rows:,}",
            f"Total Columns: {num_cols}",
            f"Headers: {', '.join(headers)}",
            f"\n--- DATA PREVIEW (Showing first {min(max_rows, total_rows)} of {total_rows:,} rows) ---"
        ]
        
        header_str = " | ".join(headers)
        summary.append(header_str)
        summary.append("-" * len(header_str))
        
        for row in rows[1:max_rows + 1]:
            summary.append(" | ".join(row))
            
        if total_rows > max_rows:
            summary.append(f"\n--- [TRUNCATED: Showing first {max_rows} rows to fit model's context window. Total rows: {total_rows:,}] ---")
            
        return "\n".join(summary).strip()
    except Exception as e:
        logger.error(f"Error parsing CSV: {e}")
        raise ValueError(f"Failed to parse CSV file: {str(e)}")

import base64
from app.core.database import get_user_keys

def describe_image_with_gemini(file_bytes: bytes, mime_type: str, api_key: str) -> str:
    """
    Sends the image bytes to Gemini Flash via REST API (sync call) and returns a detailed description.
    """
    if not api_key:
        return "[Error: Gemini API key is missing. Please save a Gemini API key in Settings to analyze images.]"
        
    encoded_image = base64.b64encode(file_bytes).decode("utf-8")
    candidate_models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash"]
    last_err = ""
    
    for model in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": (
                                "Describe this image in detail. If it is a product, describe its appearance, "
                                "branding, model, features, and key specifications. If it contains text or charts, "
                                "transcribe and analyze them. Keep the description structured, comprehensive, "
                                "and highly informative so it can be used for search, recommendations, and shopping."
                            )
                        },
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": encoded_image
                            }
                        }
                    ]
                }
            ]
        }
        
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(url, headers=headers, json=payload)
                if response.status_code == 200:
                    res_json = response.json()
                    text = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
                    logger.info(f"Successfully described image using Gemini {model}")
                    return text
                else:
                    last_err = f"Gemini {model} returned status {response.status_code}: {response.text[:200]}"
                    logger.warning(last_err)
        except Exception as e:
            last_err = f"Connection to Gemini {model} failed: {e}"
            logger.warning(last_err)
            
    return f"[Error: Failed to describe image using Gemini Flash. Details: {last_err}]"

def parse_document(filename: str, file_bytes: bytes, user_id: str = None) -> str:
    """
    Central dispatcher. Selects the appropriate parser based on file extension.
    """
    ext = filename.split(".")[-1].lower()
    
    image_exts = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif"
    }
    
    if ext in image_exts:
        api_key = None
        if user_id:
            try:
                keys = get_user_keys(user_id)
                api_key = keys.get("gemini")
            except Exception:
                pass
        return describe_image_with_gemini(file_bytes, image_exts[ext], api_key)
        
    if ext == "pdf":
        return parse_pdf(file_bytes)
    elif ext in ["docx", "doc"]:
        return parse_docx(file_bytes)
    elif ext in ["pptx", "ppt"]:
        return parse_pptx(file_bytes)
    elif ext in ["xlsx", "xls"]:
        return parse_xlsx(file_bytes)
    elif ext == "csv":
        return parse_csv(file_bytes)
    else:
        # Text or raw fallbacks
        try:
            text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = file_bytes.decode("latin-1")
            except Exception:
                raise ValueError(f"Unsupported file format '.{ext}' or binary content cannot be decoded.")
        
        # Apply smart truncation to extremely long plain text files
        max_chars = 60000
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n--- [TRUNCATED: Showing first {max_chars} characters of total content to fit model context] ---"
        return text

