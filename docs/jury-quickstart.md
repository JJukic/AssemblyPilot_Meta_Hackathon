# Jury quickstart

Goal: go from a fresh clone to one real, checked assembly step in a browser, without a
HoloLens. Plan on about 20 minutes once the tools are installed.

This path uses your own parts and real Meta inference. There is no sample result and no
mock mode to fall back on: without a key, checks show "Check unavailable".

## What you need

- macOS or Linux with Git, Python 3.12, Node.js 24 and [uv](https://docs.astral.sh/uv/getting-started/installation/)
  (pip works too; see [the README](../README.md#backend-option-b-venv-and-pip)).
- Chrome, Edge, Firefox or Safari, and a webcam or phone-style camera.
- Your own Meta Model API key with access to `muse-spark-1.3`, plus internet access. Use
  `sam-3.1` access too if you want highlighted regions. Requests may be billed to you.
- Two to five simple parts, such as toy bricks in different colours.

The repository contains no sample photos. Taking them yourself is part of the setup.

## 1. Install and start

```sh
git clone https://github.com/JJukic/AssemblyPilot_Meta_Hackathon.git
cd AssemblyPilot_Meta_Hackathon
make install
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
```

Open `backend/.env` in an editor and set `MODEL_API_KEY=` to your key.

```sh
make dev-backend    # terminal 1, port 8000
make dev-frontend   # terminal 2, port 3000
```

Check the backend in a third terminal, then open <http://localhost:3000>:

```sh
curl --fail http://localhost:8000/health
```

If a port is busy, see [Troubleshooting](../README.md#troubleshooting).

## 2. Create a small project

Take these photos first, on a plain table:

1. One photo of each block on its own (optional, but it helps).
2. One photo of the correctly finished step. Without an assembled-step photo, spatial
   judgements stay deliberately conservative.

Then in the app:

1. Select **Try AssemblyPilot with Your Own Blocks**, then **Quick custom project**.
2. **Describe:** name the project and describe the visible arrangement. Add one instruction
   per line, for example `Place the red brick on the blue brick`. Upload the finished photo.
3. **Your blocks:** add names, colours and quantities. Dimensions are not required.
4. **Assembly steps:** select **Generate Assembly Plan with Meta AI**, or continue manually.
   Review every step, because generated instructions can be wrong.
5. **Inspection mode:** keep **Simple**.
6. **Review & launch:** confirm, create the project and select **Start Inspection**.

Details and limits are in [Jury setup](jury-setup.md).

## 3. Check a real step

1. Build the step on the table, then select **Start camera** and allow camera access.
2. Select **Capture**, then **Inspect with Meta AI**.
3. Try a wrong build as well: swap a colour or move a part. Follow the correction, choose
   **I've corrected it**, then **Capture & Verify** with a new image.

For the guided flow, open `/ar?project=<id>` with the project's ID. Without XR hardware the
page shows a guided card with **Check Step**, **Check Again**, **Next Step**, **Finish** and
**Restart Assembly**. **Finish** needs real backend verification of the last step.

## Camera, light and perspective

These are practical recommendations, not measured limits:

- Use even, bright light and avoid strong shadows, glare and backlight.
- Use a plain surface that contrasts with the parts.
- Keep all relevant parts in frame and sharp, with nothing covering them.
- Match the angle of the reference photo where possible, from about 30 to 50 cm.
- Keep hands out of the frame and hold the camera still during capture.
- If the result is `uncertain`, follow the requested view, then select **Check Again**.
  Nothing is sent until you do.

Do not show people, faces or private documents. The captured image and reference photos go
to the Meta API; see [the list](technical-report.md#images-sent-to-the-meta-api).

## Without a key

Everything except inference still works: projects, manual setup, camera capture, and the
AR page. See [Without and with an API key](../README.md#without-and-with-an-api-key). The
automated tests use mocks and need no key:

```sh
make lint && make test
```

## Optional two-step project

With the backend running, this creates a new project through the API and prints its AR path.
It makes no Meta request, and it adds no reference photo, so add one before inspecting:

```sh
cd backend
uv run --frozen python scripts/create_ar_demo.py
```

The five-step practice assembly on the dashboard has no registered project and therefore
offers no AI inspection.
