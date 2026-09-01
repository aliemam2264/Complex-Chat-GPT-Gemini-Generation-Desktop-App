"use client";

import { useEffect, useRef, useState } from "react";

type ImageActionStatus = "idle" | "saving" | "copying";

export function useImageActions() {
  const [status, setStatus] = useState<ImageActionStatus>("idle");

  const [message, setMessage] = useState<string | null>(null);
  const preparedDragIds = useRef(new Map<string, string>());
  const preparingDragKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setMessage(null);
    }, 1800);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [message]);

  async function saveImage(imageUrl: string, fileName: string) {
    setStatus("saving");
    setMessage(null);

    try {
      if (!window.eskanderStudio?.desktop) {
        throw new Error("Eskander Studio desktop bridge is not available.");
      }

      const result = await window.eskanderStudio.saveImage(imageUrl, fileName);

      if (result.canceled) {
        return;
      }

      if (result.success) {
        setMessage("Image saved");
      }
    } catch (error) {
      console.error("Save image failed:", error);

      setMessage(error instanceof Error ? error.message : "Could not save image.");
    } finally {
      setStatus("idle");
    }
  }

  async function copyImage(imageUrl: string) {
    setStatus("copying");
    setMessage(null);

    try {
      if (!window.eskanderStudio?.desktop) {
        throw new Error("Eskander Studio desktop bridge is not available.");
      }

      await window.eskanderStudio.copyImage(imageUrl);

      setMessage("Copied to clipboard");
    } catch (error) {
      console.error("Copy image failed:", error);

      setMessage(error instanceof Error ? error.message : "Could not copy image.");
    } finally {
      setStatus("idle");
    }
  }


  async function prepareImageDrag(imageUrl: string, fileName: string) {
    const key = `${imageUrl}::${fileName}`;

    if (preparedDragIds.current.has(key) || preparingDragKeys.current.has(key)) {
      return preparedDragIds.current.get(key) ?? null;
    }

    if (!window.eskanderStudio?.desktop) {
      return null;
    }

    preparingDragKeys.current.add(key);

    try {
      const result = await window.eskanderStudio.prepareImageDrag(imageUrl, fileName);

      if (result.success && result.dragId) {
        preparedDragIds.current.set(key, result.dragId);
        return result.dragId;
      }
    } catch (error) {
      console.error("Prepare image drag failed:", error);
    } finally {
      preparingDragKeys.current.delete(key);
    }

    return null;
  }

  function startImageDrag(imageUrl: string, fileName: string) {
    const key = `${imageUrl}::${fileName}`;
    const dragId = preparedDragIds.current.get(key);

    if (!dragId || !window.eskanderStudio?.desktop) {
      void prepareImageDrag(imageUrl, fileName);
      setMessage("Preparing image for drag. Try again in a moment.");
      return false;
    }

    window.eskanderStudio.startImageDrag(dragId);
    return true;
  }

  return {
    status,
    message,
    saveImage,
    copyImage,
    prepareImageDrag,
    startImageDrag,
  };
}
