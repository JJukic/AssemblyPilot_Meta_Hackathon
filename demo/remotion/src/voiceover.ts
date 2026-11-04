/**
 * Final voice-over text. `spoken` goes to ElevenLabs; `subtitle` is the same text with
 * product names as written. `file` is relative to public/. Generated with ElevenLabs; change
 * the text here only together with the audio file.
 */
export type VoiceScene = { id: string; file: string; spoken: string; subtitle?: string };

export const voiceScenes: VoiceScene[] = [
  {
    id: "01-hook", file: "audio/01-hook.mp3",
    spoken: "How do you build something you have never built before? What if mixed reality could teach you a physical skill through direct guidance and feedback?",
  },
  {
    id: "02-problem", file: "audio/02-problem.mp3",
    spoken: "A manual can show the next step, but it cannot see what happened on the table. It cannot tell whether a part is misplaced, explain what went wrong, or guide the correction.",
  },
  {
    id: "03-hololens", file: "audio/03-hololens.mp3",
    spoken: "AssemblyPilot connects a physical workspace with mixed reality. On HoloLens, you confirm an assembly field on the table and see the next step as a hologram. You place the real brick and select Check Step. The camera captures that moment, and the feedback appears directly in your workspace.",
  },
  {
    id: "04-local-demo", file: "audio/04-local-demo.mp3",
    spoken: "The same web application also runs in a regular browser. This makes the system easy to test with your own parts, even when immersive hardware is not available.",
  },
  {
    id: "05-problem-solving", file: "audio/05-problem-solving.mp3",
    spoken: "Here, the blue brick is in the right place, but the wrong printed side faces forward. AssemblyPilot explains the issue and proposes a fix: rotate the block. The user corrects the real build and selects Check Again. Only then is a new image taken, and the next decision is based on that fresh evidence. This time, the step is verified. When the visual evidence is unclear, AssemblyPilot does not pretend to know. An uncertain result is not a pass. The workflow pauses. The user changes the view or corrects the assembly, and selects Check Again.",
  },
  {
    id: "06-architecture", file: "audio/06-architecture.mp3",
    spoken: "The browser or HoloLens camera sends a frame to the backend. The Assembly Orchestrator validates the request and sends the image, with its reference photos, to Muse Spark, which evaluates the assembly state. When enabled, SAM three point one adds object localization and segmentation. It never decides whether an assembly is correct. The backend validates the result and keeps the workflow state, and the web and WebXR layers display it.",
    subtitle: "The browser or HoloLens camera sends a frame to the backend. The Assembly Orchestrator validates the request and sends the image, with its reference photos, to Muse Spark, which evaluates the assembly state. When enabled, SAM 3.1 adds object localization and segmentation. It never decides whether an assembly is correct. The backend validates the result and keeps the workflow state, and the web and WebXR layers display it.",
  },
  {
    id: "07-future-vision", file: "audio/07-future-vision.mp3",
    spoken: "Today, AssemblyPilot guides a LEGO assembly. Tomorrow, the same interaction could support cooking, repairs, education, and industrial training. Imagine putting on mixed reality and learning to cook without prior experience, with guidance adapted to what is happening in front of you.",
  },
  {
    id: "08-closing", file: "audio/08-closing.mp3",
    spoken: "AssemblyPilot turns instructions into an interactive learning loop: from guidance, to action, to visual verification. AI-guided mixed reality for the real world.",
  },
];
