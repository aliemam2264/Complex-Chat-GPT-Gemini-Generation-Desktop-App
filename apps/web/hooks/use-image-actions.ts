"use client";

import { useEffect, useRef, useState } from "react";

type ImageActionStatus = "idle" | "saving" | "copying";

type PreparedImageDrag = {
  filePath: string;
  iconPath?: string | null;
};

export function useImageActions() {
  const [status, setStatus] = useState<ImageActionStatus>("idle");

  const [message, setMessage] = useState<string | null>(null);
  const preparedDragFiles = useRef(new Map<string, PreparedImageDrag>());
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
    const existing = preparedDragFiles.current.get(key);

    if (existing || preparingDragKeys.current.has(key)) {
      return existing ?? null;
    }

    if (!window.eskanderStudio?.desktop) {
      return null;
    }

    preparingDragKeys.current.add(key);

    try {
      const result = await window.eskanderStudio.prepareImageDrag(imageUrl, fileName);

      if (result.success && result.filePath) {
        const prepared: PreparedImageDrag = {
          filePath: result.filePath,
          iconPath: result.iconPath ?? null,
        };

        preparedDragFiles.current.set(key, prepared);
        return prepared;
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
    const prepared = preparedDragFiles.current.get(key);

    if (!prepared || !window.eskanderStudio?.desktop) {
      void prepareImageDrag(imageUrl, fileName);
      setMessage("Preparing image for drag. Try again in a moment.");
      return false;
    }

    window.eskanderStudio.startImageDrag(prepared.filePath, prepared.iconPath ?? null);
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
