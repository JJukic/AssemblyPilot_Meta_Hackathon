# Dramaturgy report

**Central question:** what if you could put on mixed reality and have AI guide you through a
physical task you have never done, and check the result?

AssemblyPilot is the real example. The toy-brick build runs from a target step to a verified
result. A wrong step is the turning point, because the story is about solving a problem, not
following instructions.

| # | Scene | Seconds | Purpose | Material |
| --- | --- | --- | --- | --- |
| 1 | `Intro` | 9.6 | The two questions over fast real shots | Spatial mesh, panel, field, hands, hologram, capture |
| 2 | `Problem` | 12 | What a printed manual cannot answer | Hands with real bricks, slowed down |
| 3 | `ProductIntro` | 10 | Logo and four-part promise | App home, tabletop setup, assembly field |
| 4 | `AssemblyWorkflow` | 17 | Target, real brick, capture, comparison, next step | Real panel, stills, cropped reference, capture and result |
| 5 | `BrowserDemo` | 11.5 | The same workflow in a regular browser | Real browser capture, with cut waits |
| 6 | `ProblemSolving` | 25.5 | Incorrect, plan, correction, Check Again, new frame, verified | The real Step 2 sequence |
| 7 | `StatusLegend` | 15.2 | `correct`, `incorrect`, `uncertain` | Labelled diagram |
| 8 | `ArchitectureScene` | 22.6 | The data flow, Muse Spark as evaluation, SAM 3.1 as optional path | Architecture image |
| 9 | `Completion` | 12 | Finish, mascot, Restart Assembly, without speech | Real capture |
| 10 | `FutureVision` | 19 | Today, tomorrow, cooking | Abstract text, marked as vision |
| 11 | `EndCard` | 12.5 | Name and promise | Logo |

**Emotional arc:** curiosity, uncertainty, confidence, a setback, relief at "Step Verified",
joy at the mascot, then a wider horizon. The music follows it: tension builds until the
verified result, and the chords turn to a major-key order at that moment.

## Honesty decisions

- **`uncertain`:** the state does not occur in any clip. It appears only in a diagram labelled
  "not in this recording". No UI was rebuilt.
- **SAM 3.1:** no mask or outline is visible in the footage. The red block is the AR
  hologram, and it is not described as SAM. The diagram says masks are not shown.
- **"Only one verifies a step":** `Confirm Position` exists for `uncertain`, so the video does
  not say that a step can never continue. It says only one result verifies a step.
- **Shortened waits:** the Meta wait is cut, and the footage says so. The panel itself shows
  18.2 s for the verification.
- **Steps 3 and 4:** their full inspection is not recorded, so the video shows Step 4's
  verified state only and does not imply more.
- **Cooking:** shown under a permanent "FUTURE VISION · NOT IMPLEMENTED" label, with no product shots.
- **Real capture:** all footage carries a "Real HoloLens 2 capture" or "Real browser capture"
  label. Diagrams are labelled as diagrams.
- **Voice-over wording:** SAM 3.1 is described as optional localization that never decides
  correctness. The diagram says this too, since the final spoken line does not. The video makes no
  autonomous multi-agent claim.
  It does not say Check Again is the only way out of `uncertain`, because `Confirm Position` exists.
