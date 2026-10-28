"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraStatus, Snapshot } from "@/types/assembly";

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError": return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
    case "NotFoundError": return "No camera found. Connect a webcam and try again.";
    case "NotReadableError": return "The camera is unavailable or in use by another app. Close that app and try again.";
    case "OverconstrainedError": return "This camera is no longer available. Choose another camera or use the default.";
    case "SecurityError": return "Camera access requires localhost or a secure HTTPS connection.";
    default: return "Could not start the camera. Check its connection and browser permissions, then try again.";
  }
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Ignore late permission responses after stop, source changes or component unmount.
  const requestRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>("stopped");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    releaseStream();
    setStatus("stopped");
    setError(null);
  }, [releaseStream]);

  const start = useCallback(async (selectedDevice = "") => {
    const request = ++requestRef.current;
    releaseStream();
    setError(null);
    setStatus("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Camera access is unavailable. Use a supported browser on localhost or HTTPS.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(selectedDevice ? { deviceId: { exact: selectedDevice } } : {}),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("No video track");
      track.addEventListener("ended", () => {
        if (streamRef.current !== stream) return;
        requestRef.current += 1;
        releaseStream();
        setStatus("error");
        setError("Camera disconnected. Reconnect it or choose another source, then start again.");
      }, { once: true });
      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      await video.play();
      if (request !== requestRef.current) return;
      setDeviceId(track.getSettings().deviceId ?? selectedDevice);
      setStatus("connected");
      // Enumeration failure must not tear down an otherwise working preview.
      try {
        const available = await navigator.mediaDevices.enumerateDevices();
        if (request === requestRef.current) {
          setDevices(available.filter((device) => device.kind === "videoinput"));
        }
      } catch { /* Preview remains usable with the default source. */ }
    } catch (cause) {
      if (request !== requestRef.current) return;
      releaseStream();
      setStatus("error");
      setError(cameraError(cause));
    }
  }, [releaseStream]);

  const selectDevice = useCallback((id: string) => {
    setDeviceId(id);
    if (status === "connected" || status === "starting") void start(id);
  }, [start, status]);

  const capture = useCallback((publish = true): Snapshot | null => {
    const video = videoRef.current;
    if (!video || status !== "connected" || video.readyState < 2 || !video.videoWidth) {
      setError("Wait for the live camera image before capturing.");
      return null;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(video, 0, 0);
      const captured: Snapshot = {
        dataUrl: canvas.toDataURL("image/jpeg", 0.9),
        width: canvas.width,
        height: canvas.height,
        capturedAt: new Date().toISOString(),
      };
      if (publish) setSnapshot(captured);
      setError(null);
      return captured;
    } catch {
      setError("Could not capture this frame. Try again once the preview is visible.");
      return null;
    }
  }, [status]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    const updateDevices = async () => {
      try {
        const available = await media.enumerateDevices();
        if (!active) return;
        setDevices(available.filter((device) => device.kind === "videoinput"));
      } catch { /* Device enumeration is optional until permission is granted. */ }
    };
    let active = true;
    media?.addEventListener("devicechange", updateDevices);
    return () => {
      active = false;
      requestRef.current += 1;
      media?.removeEventListener("devicechange", updateDevices);
      releaseStream();
    };
  }, [releaseStream]);

  const getConfiguration = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return null;
    // Read on every explicit capture; browser-exposed changes invalidate saved profiles.
    return { label: track.label || "Unlabelled camera", settings: track.getSettings() };
  }, []);
  return { getConfiguration, publishSnapshot: setSnapshot, videoRef, status, error, devices, deviceId, snapshot, start, stop, selectDevice, capture };
}
