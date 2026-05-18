"use client";

import { useRef, useState, useCallback } from "react";

/**
 * Lightweight face capture for attendance.
 * Produces a 128-dim descriptor from image pixel sampling (compatible with backend compare).
 * For production, replace with @vladmandic/face-api or similar loaded models.
 */
export function useFaceCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async (video: HTMLVideoElement) => {
    videoRef.current = video;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 320, height: 240 },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setReady(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Kamera ochilmadi");
      setReady(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  const capture = useCallback((): { descriptor: number[]; snapshot: string } | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 128, 128);
    const imageData = ctx.getImageData(0, 0, 128, 128);
    const descriptor = imageToDescriptor(imageData.data);
    const snapshot = canvas.toDataURL("image/jpeg", 0.8);
    return { descriptor, snapshot };
  }, []);

  return { startCamera, stopCamera, capture, ready, error };
}

/** Deterministic 128-float descriptor from image pixels (same algorithm client+server enroll). */
function imageToDescriptor(pixels: Uint8ClampedArray): number[] {
  const desc = new Array(128).fill(0);
  const step = Math.floor(pixels.length / (128 * 4));
  for (let i = 0; i < 128; i++) {
    const idx = i * step * 4;
    const r = (pixels[idx] || 0) / 255;
    const g = (pixels[idx + 1] || 0) / 255;
    const b = (pixels[idx + 2] || 0) / 255;
    desc[i] = (r + g + b) / 3;
  }
  const norm = Math.sqrt(desc.reduce((s, v) => s + v * v, 0)) || 1;
  return desc.map(v => v / norm);
}
