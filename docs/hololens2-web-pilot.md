# HoloLens 2 pilot path

This repository is currently a browser-based assembly workspace, not a Unity/MRTK/OpenXR project. The smallest HoloLens 2 milestone is therefore a LAN-hosted Edge pilot:

- the PC runs the existing Next.js frontend and FastAPI backend;
- HoloLens 2 opens the frontend in Edge;
- camera capture and manual step navigation are tested on-device;
- Meta inspection remains an explicit backend request;
- spatial anchors, world-locked 3D LEGO parts and hand-ray interactions are not provided by this pilot.

## PC setup

From the repository root:

```sh
make install
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
```

Find the PC's LAN IPv4 address. Use that address in both files, for example:

```env
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://192.168.1.20:8000
```

```env
# backend/.env
FRONTEND_ORIGIN=http://192.168.1.20:3000
```

Do not put `MODEL_API_KEY` in the frontend file. Keep it only in `backend/.env`.

Start the services in two terminals:

```sh
cd backend
uv run --frozen uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```sh
cd frontend
npm run dev
```

The default Makefile backend command intentionally binds to `127.0.0.1`; the LAN command above is an explicit pilot-only override. Keep the computer on a trusted private network and allow inbound TCP 3000/8000 only on that private network in the host firewall.

Before using the headset, verify from the PC:

```sh
curl --fail http://127.0.0.1:8000/health
```

## HoloLens 2 connection

1. Connect the HoloLens 2 and the PC to the same trusted Wi-Fi network. Avoid guest Wi-Fi, client isolation and public networks.
2. On HoloLens, enable Developer Mode and Device Portal under Settings > Update & Security > For developers. Enable Device discovery if it is shown.
3. For the first Visual Studio deployment later, use Pair and keep the PIN dialog open until Visual Studio accepts it.
4. Find the HoloLens Wi-Fi IPv4 address under Settings > Network & Internet > Wi-Fi > Advanced options.
5. On the PC, open `https://<HOLOLENS-IP>` for Device Portal. The certificate warning is expected for the device's self-signed certificate; only continue on a network you trust. Prefer downloading/trusting the device certificate instead of weakening browser security globally.
6. On HoloLens Edge, open `http://<PC-IP>:3000`.

If the page loads but reports the backend as disconnected, check the exact PC IP in `NEXT_PUBLIC_API_URL`, the exact frontend origin in `FRONTEND_ORIGIN`, the firewall rules and whether both services were restarted after editing environment files.

## Pilot acceptance test

On HoloLens Edge:

1. Open the dashboard and confirm the frontend loads.
2. Confirm the backend status becomes connected.
3. Open Block library and Projects; create a small LEGO project with one or two steps.
4. Start the camera, grant permission and confirm live video.
5. Capture a frame and confirm the snapshot is visible.
6. Navigate steps manually.
7. If Meta inspection is configured, select a project and step, capture a fresh frame and explicitly choose Inspect with Meta AI.
8. Confirm that a failed backend request does not remove the local camera preview.
9. Stop the camera and confirm the device camera indicator stops.

This validates browser transport and the existing manual assembly workflow. It does not validate spatial registration, world locking, depth-aware placement, 3D model rendering or reliable HoloLens hand tracking.

## What is already implemented

- Next.js App Router frontend in `frontend/`.
- FastAPI application entry point in `backend/app/main.py`.
- Camera capture in `frontend/src/hooks/useCamera.ts`.
- Manual assembly guide in `frontend/src/components/assembly/`.
- Registry/project/step persistence through SQLite and the FastAPI API.
- Explicit Meta inspection with validated, snapshot-bound results.
- ChArUco calibration and narrow geometric verification paths.

## What a real spatial HoloLens port must add

Keep the existing backend and registry as the data/service layer, but create a separate Unity client:

1. Unity 2022.3.62f1 and Unity OpenXR 1.14.3 are the last HoloLens 2-supported versions called out by Microsoft's current guidance; pin them rather than upgrading blindly.
2. Add MRTK3 or the Microsoft Mixed Reality OpenXR plugin, configure UWP and OpenXR, and target ARM64.
3. Define a stable spatial coordinate system for a work surface using a QR/AprilTag/ArUco/ChArUco marker or a user-guided placement step.
4. Add low-poly LEGO part prefabs and a step state machine that consumes the existing project/step/block data.
5. Add hand-ray/tap controls for next step, reset alignment and recapture.
6. Add a native camera/frame bridge only if the Unity client needs on-device perception; otherwise keep inspection on the backend and make network failure explicit.
7. Run a real-device test for alignment drift, occlusion, lighting, camera permission, offline behavior and thermal/performance limits.

The browser pilot and Unity client should remain separate clients of the same backend until the spatial client is stable.

## Useful references

- Microsoft: [Choosing a Unity version and XR plugin](https://learn.microsoft.com/en-us/windows/mixed-reality/develop/unity/choosing-unity-version)
- Microsoft: [Build and deploy to the HoloLens](https://learn.microsoft.com/en-us/windows/mixed-reality/develop/unity/build-and-deploy-to-hololens)
- Microsoft: [Using the Windows Device Portal](https://learn.microsoft.com/en-us/windows/mixed-reality/using-the-windows-device-portal)
