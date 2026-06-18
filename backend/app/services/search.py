import html
import re
import logging
from urllib.parse import unquote
import httpx

logger = logging.getLogger(__name__)

async def search_duckduckgo(query: str, max_results: int = 5) -> list:
    """
    Performs a zero-dependency async search on DuckDuckGo HTML Lite/standard page
    and returns a list of results containing title, url, and snippet.
    """
    url = "https://html.duckduckgo.com/html/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params={"q": query}, headers=headers)
            if response.status_code == 200:
                html_text = response.text
                # DuckDuckGo HTML returns search result blocks inside blocks containing the class 'result__body'
                blocks = html_text.split('result__body')[1:]
                for block in blocks[:max_results]:
                    # Extract URL and Title robustly regardless of attribute order
                    a_match = re.search(r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*>(.*?)</a>', block, re.DOTALL)
                    # Extract Snippet robustly
                    snippet_match = re.search(r'<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>', block, re.DOTALL)
                    
                    if a_match:
                        a_tag_html = a_match.group(0)
                        raw_url = ""
                        href_match = re.search(r'href="([^"]+)"', a_tag_html)
                        if href_match:
                            raw_url = href_match.group(1)
                            
                        # Extract redirect URL if present
                        url = raw_url
                        if "/l/?uddg=" in raw_url:
                            uddg_match = re.search(r'uddg=([^&]+)', raw_url)
                            if uddg_match:
                                url = unquote(uddg_match.group(1))
                        
                        # Clean HTML tags and unescape entities
                        title = re.sub(r'<[^>]*>', '', a_match.group(1)).strip()
                        title = html.unescape(title)
                        
                        snippet = ""
                        if snippet_match:
                            snippet = re.sub(r'<[^>]*>', '', snippet_match.group(1)).strip()
                            snippet = html.unescape(snippet)
                        
                        results.append({
                            "title": title,
                            "url": url,
                            "snippet": snippet
                        })
                logger.info(f"DuckDuckGo search for '{query}' returned {len(results)} results.")
            else:
                logger.warning(f"DuckDuckGo search failed with status {response.status_code}: {response.text[:200]}")
    except Exception as e:
        logger.error(f"Error performing DuckDuckGo search: {e}")
    return results
