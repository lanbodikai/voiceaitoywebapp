#!/usr/bin/env python3
"""Generate fixed web story cues with the same Edge-TTS voices as the iOS app."""

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from speech_text import spoken_text
STORIES = ROOT / "src" / "data" / "stories.json"
PLAY_INTRO = ROOT / "src" / "data" / "play-intro.json"
OUTPUT = ROOT / "public" / "audio"
PROVENANCE = ROOT / "src" / "data" / "edge-cues.json"
RUNTIME_MANIFEST = ROOT / "src" / "data" / "edge-cue-ids.json"
FEEDBACK_MANIFEST = ROOT / "src" / "data" / "fixed-feedback.json"

ZH_VOICE = "zh-CN-XiaoxiaoNeural"
EN_VOICE = "en-US-AvaNeural"


def feedback_cues(stories: dict) -> dict[str, tuple[str, str, str, str]]:
    cues = {"en_feedback_success_v1": ("Lovely!", EN_VOICE, "-5%", "+0Hz")}
    boundaries = json.loads((ROOT / "src/data/conversation-boundaries.json").read_text(encoding="utf-8"))
    for language, voice, pitch in [("english", EN_VOICE, "+0Hz"), ("chinese", ZH_VOICE, "+1Hz")]:
        cues[f"{language}_feedback_retry_v1"] = (boundaries[language]["retry"], voice, "-5%", pitch)
    for filename, prefix in [("story-continue-lines.json", "story_continue"), ("voice-picker-lines.json", "voice_picker")]:
        lines = json.loads((ROOT / "src/data" / filename).read_text(encoding="utf-8"))
        for name, line in lines.items():
            cues[f"{prefix}_{name}_zh"] = (line["zh"], ZH_VOICE, "-5%", "+1Hz")
            cues[f"{prefix}_{name}_en"] = (line["en"], EN_VOICE, "-5%", "+0Hz")
    for story in stories["stories"]:
        for beat in story["beats"]:
            checkpoint = beat["checkpoint"]
            model = " and ".join(concept["en"][0] for concept in checkpoint["concepts"] if concept["en"] and concept["en"][0])
            hints = [checkpoint["englishHint"], f"Try saying one important word: {model}.", f"Here is a sentence starter: “I think {model}…”", f"Let’s say the complete answer together: {model}."]
            for level, text in enumerate(hints, 1):
                cues[cue_id(story["id"], checkpoint["id"], f"hint_{level}", "english")] = (text, EN_VOICE, "-5%", "+0Hz")
    return cues


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


async def generate(cues: dict[str, tuple[str, str, str, str]], force: bool, preserve_existing: bool = False) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    try:
        previous = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    certified: dict[str, dict[str, str]] = dict(previous) if preserve_existing else {}
    generated = 0
    for index, (identifier, (text, voice, rate, pitch)) in enumerate(cues.items(), start=1):
        text = spoken_text(text, voice.startswith('en-'))
        destination = OUTPUT / f"{identifier}.mp3"
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        prior = previous.get(identifier, {})
        if destination.exists() and not force and prior.get("textHash") == text_hash and prior.get("voice") == voice and prior.get("rate") == rate and prior.get("pitch") == pitch:
            audio_hash = hashlib.sha256(destination.read_bytes()).hexdigest()
            if prior.get("audioHash") == audio_hash:
                certified[identifier] = prior
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
                        certified[identifier] = {"voice": voice, "rate": rate, "pitch": pitch, "textHash": text_hash, "audioHash": hashlib.sha256(destination.read_bytes()).hexdigest()}
                        generated += 1
                        break
                    raise RuntimeError("Edge-TTS returned no audio")
                except Exception as error:
                    if attempt == 2:
                        raise RuntimeError(f"Could not generate {identifier}: {error}") from error
                    await asyncio.sleep(1.0 * (attempt + 1))
        finally:
            temporary.unlink(missing_ok=True)
    PROVENANCE.write_text(json.dumps(certified, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    RUNTIME_MANIFEST.write_text(json.dumps(sorted(certified), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated {generated} cue files in {OUTPUT}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--play-intro-only", action="store_true", help="Generate the bilingual play greeting and three destination openings.")
    parser.add_argument("--handsfree-only", action="store_true", help="Generate the short bilingual hands-free prompts.")
    parser.add_argument("--feedback-only", action="store_true", help="Generate English checkpoint feedback and bilingual retry cues.")
    args = parser.parse_args()
    stories = json.loads(STORIES.read_text(encoding="utf-8"))
    feedback = feedback_cues(stories)
    cues = {} if args.play_intro_only or args.handsfree_only or args.feedback_only else story_cues(stories)
    intro = json.loads(PLAY_INTRO.read_text(encoding="utf-8"))
    lines = [] if args.handsfree_only or args.feedback_only else [intro["greeting"], *intro["openings"].values()]
    if not args.play_intro_only and not args.feedback_only:
        lines += list(json.loads((ROOT / "src/data/handsfree-lines.json").read_text(encoding="utf-8")).values())
    for line in lines:
        cues[line["cue"]] = (line["zh"], ZH_VOICE, "-5%", "+1Hz")
        cues[f"en_{line['cue']}"] = (line["en"], EN_VOICE, "-5%", "+0Hz")
    if not args.play_intro_only and not args.handsfree_only:
        cues.update(feedback)
    asyncio.run(generate(cues, args.force, args.play_intro_only or args.handsfree_only or args.feedback_only))
    if not args.play_intro_only and not args.handsfree_only:
        # Runtime lookup requires an exact original-text match; audio provenance
        # separately certifies the provider-normalized spoken text and MP3 hash.
        FEEDBACK_MANIFEST.write_text(json.dumps({identifier: {"text": values[0], "language": "english" if values[1] == EN_VOICE else "chinese"} for identifier, values in feedback.items()}, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
