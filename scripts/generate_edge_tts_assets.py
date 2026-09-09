#!/usr/bin/env python3
"""Generate fixed web story cues with the same Edge-TTS voices as the iOS app."""

import argparse
import asyncio
import json
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
STORIES = ROOT / "src" / "data" / "stories.json"
PLAY_INTRO = ROOT / "src" / "data" / "play-intro.json"
OUTPUT = ROOT / "public" / "audio"

ZH_VOICE = "zh-CN-XiaoxiaoNeural"
EN_VOICE = "en-US-AnaNeural"


def cue_id(story_id: str, checkpoint_id: str, kind: str, language: str) -> str:
    prefix = "en_" if language == "english" else ""
    return f"{prefix}{kind}_{story_id}_{checkpoint_id}"


def story_cues(stories: dict) -> dict[str, tuple[str, str, str, str]]:
    cues: dict[str, tuple[str, str, str, str]] = {}

    def add(identifier: str, text: str, language: str, rate: str = "-5%") -> None:
        if text.strip():
            cues.setdefault(identifier, (text, ZH_VOICE if language == "chinese" else EN_VOICE, rate, "+1Hz" if language == "chinese" else "+0Hz"))

    for story in stories["stories"]:
        for beat in story["beats"]:
            checkpoint = beat["checkpoint"]
            add(beat["audioCue"], beat["narration"], "chinese", "-8%")
            add(f"en_{beat['audioCue']}", beat["englishNarration"], "english", "-8%")
            add(checkpoint["audioCue"], checkpoint["question"], "chinese")
            add(f"en_{checkpoint['audioCue']}", checkpoint["englishQuestion"], "english")
            for hint in checkpoint["hints"]:
                add(cue_id(story["id"], checkpoint["id"], f"hint_{hint['level']}", "chinese"), hint["text"], "chinese")
            add(cue_id(story["id"], checkpoint["id"], "recast", "chinese"), checkpoint["recast"], "chinese")
            add(cue_id(story["id"], checkpoint["id"], "success", "chinese"), checkpoint["successLine"], "chinese")

    return cues


async def generate(cues: dict[str, tuple[str, str, str, str]], force: bool) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    generated = 0
    for index, (identifier, (text, voice, rate, pitch)) in enumerate(cues.items(), start=1):
        destination = OUTPUT / f"{identifier}.mp3"
        if destination.exists() and not force:
            continue
        print(f"[{index}/{len(cues)}] {destination.name}")
        temporary = destination.with_suffix(".tmp.mp3")
        try:
            for attempt in range(3):
                temporary.unlink(missing_ok=True)
                try:
                    await edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch).save(str(temporary))
                    if temporary.is_file() and temporary.stat().st_size > 0:
                        temporary.replace(destination)
                        generated += 1
                        break
                    raise RuntimeError("Edge-TTS returned no audio")
                except Exception as error:
                    if attempt == 2:
                        raise RuntimeError(f"Could not generate {identifier}: {error}") from error
                    await asyncio.sleep(1.0 * (attempt + 1))
        finally:
            temporary.unlink(missing_ok=True)
    print(f"Generated {generated} cue files in {OUTPUT}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--play-intro-only", action="store_true", help="Generate the bilingual play greeting and three destination openings.")
    args = parser.parse_args()
    cues = {} if args.play_intro_only else story_cues(json.loads(STORIES.read_text(encoding="utf-8")))
    intro = json.loads(PLAY_INTRO.read_text(encoding="utf-8"))
    for line in [intro["greeting"], *intro["openings"].values()]:
        cues[line["cue"]] = (line["zh"], ZH_VOICE, "-5%", "+1Hz")
        cues[f"en_{line['cue']}"] = (line["en"], EN_VOICE, "-5%", "+0Hz")
    asyncio.run(generate(cues, args.force))


if __name__ == "__main__":
    main()
