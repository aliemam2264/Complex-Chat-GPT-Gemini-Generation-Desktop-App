"use client";

import { useEffect, useState } from "react";

type ImageActionStatus = "idle" | "saving" | "copying";

export function useImageActions() {
  const [status, setStatus] = useState<ImageActionStatus>("idle");

  const [message, setMessage] = useState<string | null>(null);

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

  return {
    status,
    message,
    saveImage,
    copyImage,
  };
}
