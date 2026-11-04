# AssemblyPilot hackathon demo

Remotion project for the AssemblyPilot demo video: 1920×1080, 30 fps. Nothing here is
published or uploaded.

## Setup

Needs Node.js 22 or newer and FFmpeg (`ffprobe` for the footage check). The recordings are
not in Git. Put them in `public/footage/hololens/` and `public/footage/browser/`.

```sh
cd demo/remotion
npm ci
```

## Commands

| Task | Command |
| --- | --- |
| Interactive preview | `npm run preview` |
| Half-size preview render | `npm run render:preview`, writes `out/preview.mp4` |
| Final render | `npm run render`, writes `out/assemblypilot-hackathon-demo.mp4` |
| Check footage only | `npm run check` |
| Regenerate music and UI sounds | `npm run audio` |
| Rebuild voice timing and subtitles | `npm run voice` |
| Re-measure word times after an audio change | `npm run align` (needs local Whisper) |
| Re-render the architecture image | `npm run diagram` |
| Regenerate the clip mapping | `npm run mapping` |
| Type check | `npm run typecheck` |

The render commands run the footage check, audio generation, voice timing and mapping first.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/manifest.ts` | Central timeline: clip order, source start, duration, zoom, captions, voice placement |
| `src/voiceover.ts` | Final voice-over text, the only source for the subtitles |
| `src/voice-words.json` | Generated start and end time of every spoken word |
| `src/voice-timing.json` | Generated placement and subtitle cues |
| `src/ArchitectureDiagram.tsx` | Source of `public/architecture/assemblypilot-architecture.png`, 3840×2160 |
| `subtitles/voiceover.en.srt` | Generated English subtitles |
| `src/scenes/` | `Intro`, `Problem`, `ProductIntro`, `AssemblyWorkflow`, `BrowserDemo`, `ProblemSolving`, `ArchitectureScene`, `Completion`, `FutureVision`, `EndCard` |
| `src/components/` | Clip player, overlays, logo |
| `scripts/` | Footage check, audio synthesis, voice timing, clip mapping |
| `CLIP_MAPPING.md` | Used shots and unused material, generated from the manifest |
| `DRAMATURGY.md` | Story structure and honesty decisions |

To change the edit, adjust `src/manifest.ts`. Scene lengths, the music, the subtitles and the
mapping follow from it. `npm run voice` fails if a line overruns its scene, two lines overlap,
or the video passes 180 seconds.

## Missing clips

`npm run check` tests every clip with `ffprobe`. A missing or unreadable clip is listed in
`src/clip-status.json` and renders as a labelled "Clip unavailable" card instead of failing
the render. A shot that runs past the end of its clip fails the check.

## Audio and fonts

The recordings have no audio track. Music and UI sounds are synthesized by
`scripts/generate-audio.ts`, so no third-party music is included. Inter and JetBrains Mono are
under the SIL Open Font License.

### Voice-over

| Item | Value |
| --- | --- |
| Voice | Kayleigh - Poised Tech Tutorial Narrator (ElevenLabs) |
| Model | `eleven_v4`, default voice settings, no audio tags, same for all scenes |
| Files | `public/audio/01-hook.mp3` to `08-closing.mp3` |
| Format | MP3, 44.1 kHz, mono, 128 kbps. ElevenLabs delivered MP3, so the files are not converted |
| Length | 135.92 s of speech, 341 words |

| File | Seconds |
| --- | --- |
| `01-hook.mp3` | 8.88 |
| `02-problem.mp3` | 11.04 |
| `03-hololens.mp3` | 17.84 |
| `04-local-demo.mp3` | 10.00 |
| `05-problem-solving.mp3` | 37.12 |
| `06-architecture.mp3` | 21.76 |
| `07-future-vision.mp3` | 18.08 |
| `08-closing.mp3` | 11.20 |

The files are generated through the ElevenLabs connection, not by a script in this project, and
`public/audio/` is not in Git. Keep a copy: new audio costs credits and sounds slightly
different. If you change a line, regenerate that file, update `src/voiceover.ts` and run `npm run align`.

Music drops under speech and rises between lines. Levels are in
`src/components/VoiceOver.tsx`. Subtitles follow the word times, are burned in by
`src/components/PremiumSubtitle.tsx`, and are also written as an SRT file.

Remotion has its own license. It is free for individuals and small teams; check
[its terms](https://www.remotion.dev/license) for your case.
