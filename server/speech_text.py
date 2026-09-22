"""Plain spoken text shared by fixed cue generation and live Edge speech."""
import re

def spoken_text(text, english=False):
    if not english:
        return text
    text = re.sub(r'\blo{3,}ng\b', 'long', text, flags=re.I)
    text = re.sub(r'\bwhoo+\b', 'a gentle breath', text, flags=re.I)
    return re.sub(r'\s*[—–…]+\s*', '. ', text).strip()
