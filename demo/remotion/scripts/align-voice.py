"""Finds when each script word is spoken and writes src/voice-words.json.

Uses local Whisper for timing only: the words themselves always come from src/voiceover.ts.
Run with `npm run align` after a voice-over file changes.
"""
import difflib
import json
import re

import whisper

source = open("src/voiceover.ts", encoding="utf8").read()
scenes = re.findall(r'id: "([^"]+)", file: "([^"]+)",\s+spoken: "([^"]+)"', source)
model = whisper.load_model("base")


def key(word):
    return re.sub(r"[^a-z0-9]", "", word.lower())


output = {}
for scene, file, spoken in scenes:
    script = spoken.split()
    result = model.transcribe(f"public/{file}", language="en", fp16=False, word_timestamps=True, condition_on_previous_text=False, initial_prompt="AssemblyPilot, HoloLens, Muse Spark, WebXR, Assembly Orchestrator.")
    heard = [word for segment in result["segments"] for word in segment["words"]]
    match = difflib.SequenceMatcher(None, [key(w) for w in script], [key(w["word"]) for w in heard], autojunk=False)
    times = [None] * len(script)
    for block in match.get_matching_blocks():
        for offset in range(block.size):
            spot = heard[block.b + offset]
            times[block.a + offset] = (float(spot["start"]), float(spot["end"]))
    # Words Whisper missed take their time from the neighbours.
    for index, value in enumerate(times):
        if value is None:
            before = next((times[i][1] for i in range(index - 1, -1, -1) if times[i]), 0.0)
            after = next((times[i][0] for i in range(index + 1, len(times)) if times[i]), before + 0.3)
            times[index] = (before, max(after, before + 0.05))
    output[scene] = [{"word": w, "start": round(a, 3), "end": round(b, 3)} for w, (a, b) in zip(script, times)]
    print(scene, len(script), "words,", sum(1 for b in match.get_matching_blocks() for _ in range(b.size)), "matched")

with open("src/voice-words.json", "w", encoding="utf8") as out:
    json.dump(output, out, indent=1)
    out.write("\n")
