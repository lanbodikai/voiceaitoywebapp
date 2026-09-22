"""In-memory Edge-TTS worker. Text arrives on stdin, never in process arguments."""
import asyncio
import json
import sys
import edge_tts
from speech_text import spoken_text

async def main():
    request = json.loads(sys.stdin.buffer.read(16384))
    english = request.get("language") == "english"
    voice = "en-US-AvaNeural" if english else "zh-CN-XiaoxiaoNeural"
    text = request["text"]
    if not isinstance(text, str) or not 0 < len(text) <= 1600:
        raise ValueError("invalid input")
    async for chunk in edge_tts.Communicate(spoken_text(text, english), voice, rate="-5%", pitch="+0Hz" if english else "+1Hz").stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
            sys.stdout.buffer.flush()

try:
    asyncio.run(main())
except Exception:
    # Provider errors can contain text; do not print exceptions or tracebacks.
    sys.exit(1)
