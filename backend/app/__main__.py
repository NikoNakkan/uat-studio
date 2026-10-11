"""python -m app  ->  UAT Studio on http://127.0.0.1:8765 (local only: it holds your API key)."""
import asyncio
import os
import sys

import uvicorn

if __name__ == "__main__":
    if sys.platform == "win32":
        # Subprocesses (Playwright, the MCP server) need the Proactor loop on Windows.
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("UAT_STUDIO_PORT", "8765")),
                loop="asyncio", reload=False)
