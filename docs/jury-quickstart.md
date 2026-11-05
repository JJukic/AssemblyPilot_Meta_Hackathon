# Jury quickstart

Goal: go from a fresh clone to a real, checked assembly in a browser, without a HoloLens.
Plan on about 20 minutes once the tools are installed. Everything runs on your machine, and
there is no hosted version.

This path uses your own parts and real Meta inference. There is no sample result and no
mock mode to fall back on: without a key, checks show "Check unavailable".

## What you need

- macOS or Linux with Git, Python 3.12, Node.js 24 and [uv](https://docs.astral.sh/uv/getting-started/installation/)
  (pip works too; see [Install with pip](local-deployment.md#install-with-pip)).
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
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Open `backend/.env` in an editor and set `MODEL_API_KEY=` to your key.

```sh
make dev-backend    # terminal 1, port 8000
make dev-frontend   # terminal 2, port 3000
```

The app is at <http://localhost:3000>. Check the backend in a third terminal:

```sh
curl --fail http://localhost:8000/health
```

If a port is busy, see [Troubleshooting](local-deployment.md#troubleshooting).

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

1. **Choose a camera:** select it under **Camera source**, then **Start camera** and allow
   access.
2. **A correct step:** build it, then select **Capture** and **Inspect with Meta AI**. A
   correct first result asks for a separate fresh image, so the step is not verified yet.
3. **A wrong step:** swap a colour or move a part and inspect again. Follow the correction,
   choose **I've corrected it**, then **Capture & Verify** with a new image.

## 4. Run the guided flow

Open `/ar?project=<id>` with the project's ID. Without XR hardware the page shows a guided
card that uses your browser camera.

1. **Check Step:** after a correct result, a separate fresh frame verifies the step
   automatically. Then select **Next Step**.
2. **`uncertain`:** show a deliberately poor view, for example with a part hidden. The result
   stays on screen with the requested view, and nothing is sent. Change the view and select
   **Check Again**, which takes exactly one new image.
3. **Finish:** appears only on the last step after the backend has verified it.
4. **Restart Assembly:** appears after Finish. It starts a new run at Step 1 and deletes
   nothing.

**Confirm Position** is a local fallback labelled "not AI verified". It cannot enable Finish.

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
AR page. See [Without and with an API key](local-deployment.md#without-and-with-an-api-key). The
automated tests use mocks and need no key:

```sh
make lint && make test
```

## HoloLens variant

This is optional and needs a HoloLens 2 and Caddy. WebXR and the camera require trusted HTTPS,
so the headset connects to Caddy on your private network.

1. Follow [HoloLens 2 over HTTPS](local-deployment.md#hololens-2-over-https): build the frontend with
   an empty API URL, start both servers on loopback, then start Caddy on your private IP.
2. Install only Caddy's public root certificate on the headset.
3. Open `https://<your-private-ip>/ar?project=<project-id>` in HoloLens Edge and select
   **Enter immersive AR**.

Stay on a trusted shared network. Do not forward router ports, use a public tunnel or expose
port 8000. The Device Portal is separate from the app, and it must never have a public address.

## Optional two-step project

With the backend running, this creates a new project through the API and prints its AR path.
It makes no Meta request, and it adds no reference photo, so add one before inspecting:

```sh
cd backend
uv run --frozen python scripts/create_ar_demo.py
```

The five-step practice assembly on the dashboard has no registered project and therefore
offers no AI inspection.
