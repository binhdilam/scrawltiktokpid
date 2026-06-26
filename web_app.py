import asyncio, json, re, os
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from playwright.async_api import async_playwright

def parse_cookies_json(cookies_json: str) -> list:
    """Convert browser-exported cookie JSON array to Playwright cookie format."""
    raw = json.loads(cookies_json)
    cookies = []
    for c in raw:
        domain = c.get("domain", "")
        # clean markdown-rendered domains like ".[www.tiktok.com](https://...)"
        domain = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', domain)
        cookie = {
            "name": c["name"],
            "value": c["value"],
            "domain": domain,
            "path": c.get("path", "/"),
        }
        if c.get("expirationDate"):
            cookie["expires"] = int(c["expirationDate"])
        if c.get("httpOnly") is not None:
            cookie["httpOnly"] = bool(c["httpOnly"])
        if c.get("secure") is not None:
            cookie["secure"] = bool(c["secure"])
        same_site = c.get("sameSite")
        if same_site and str(same_site).lower() in ("strict", "lax", "none"):
            cookie["sameSite"] = str(same_site).capitalize()
        cookies.append(cookie)
    return cookies

def parse_input(raw):
    raw = raw.strip()
    m = re.search(r"/video/(\d+)", raw)
    if m:
        return m.group(1)
    if re.match(r"^\d{15,20}$", raw):
        return raw
    return None

def extract_pids_from_item(item):
    pids = []
    for p in (item.get("commerce") or {}).get("commerceInfo", {}).get("productItems", []) or []:
        pid = str(p.get("productId") or p.get("id") or "")
        if pid and pid not in pids:
            pids.append(pid)
    for anchor in item.get("anchors") or []:
        raw_extra = anchor.get("extra") or anchor.get("anchorExtra") or {}
        if isinstance(raw_extra, str):
            try:
                raw_extra = json.loads(raw_extra)
            except Exception:
                raw_extra = {}
        items_to_check = raw_extra if isinstance(raw_extra, list) else [raw_extra]
        for ex in items_to_check:
            if not isinstance(ex, dict):
                continue
            pid = str(ex.get("productId") or ex.get("product_id") or ex.get("id") or "")
            if pid and re.match(r"^\d{10,20}$", pid) and pid not in pids:
                pids.append(pid)
    for sticker in item.get("stickersOnItem") or []:
        if sticker.get("stickerType") == 2:
            for text in sticker.get("stickerText") or []:
                if re.match(r"^\d{10,20}$", str(text)) and str(text) not in pids:
                    pids.append(str(text))
    return pids

def parse_html_for_item(html):
    m = re.search(
        r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>',
        html, re.DOTALL
    )
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
        video_detail = data.get("__DEFAULT_SCOPE__", {}).get("webapp.video-detail", {})
        return video_detail.get("itemInfo", {}).get("itemStruct")
    except Exception:
        return None

async def fetch_video(video_id, context):
    page = await context.new_page()
    try:
        await page.goto(
            f"https://www.tiktok.com/@x/video/{video_id}",
            wait_until="domcontentloaded",
            timeout=25000,
        )
        await asyncio.sleep(1)
    except Exception:
        pass
    html = await page.content()
    await page.close()

    item = parse_html_for_item(html)
    if item is None:
        return {"video_id": video_id, "status": "error", "pids": [], "error": "Không lấy được data"}

    pids = extract_pids_from_item(item)
    return {
        "video_id": video_id,
        "status": "ok",
        "pids": pids,
        "author": item.get("author", {}).get("uniqueId", ""),
        "desc": (item.get("desc") or "")[:100],
    }


app = FastAPI()

class ExtractRequest(BaseModel):
    inputs: list[str]
    cookies_json: str = ""

@app.get("/")
async def index():
    return FileResponse("index.html")

@app.post("/api/extract")
async def extract(req: ExtractRequest):
    if not req.cookies_json.strip():
        async def err():
            yield 'data: {"status":"fatal","error":"Chưa nhập Cookie"}\n\n'
        return StreamingResponse(err(), media_type="text/event-stream")

    try:
        cookies = parse_cookies_json(req.cookies_json)
    except Exception as e:
        async def err():
            yield f'data: {json.dumps({"status":"fatal","error":f"Cookie JSON không hợp lệ: {e}"})}\n\n'
        return StreamingResponse(err(), media_type="text/event-stream")

    async def generate():
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                    locale="vi-VN",
                    viewport={"width": 1280, "height": 800},
                )
                await context.add_cookies(cookies)

                for raw in req.inputs:
                    video_id = parse_input(raw)
                    if not video_id:
                        result = {"input": raw, "video_id": "—", "status": "error", "pids": [], "error": "Không parse được ID"}
                    else:
                        result = await fetch_video(video_id, context)
                        result["input"] = raw
                    yield f"data: {json.dumps(result, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0.3)

                await browser.close()
        except Exception as e:
            yield f"data: {json.dumps({'status': 'fatal', 'error': str(e)})}\n\n"
        yield "data: __done__\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 3004))
    uvicorn.run(app, host="0.0.0.0", port=port)
