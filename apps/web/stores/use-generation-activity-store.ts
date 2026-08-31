"use client";

import { create } from "zustand";

type GenerationActivityState = {
  /*
   * Generations that the user explicitly moved
   * to the background while ChatGPT was still working.
   */
  backgroundGenerationIds: string[];

  /*
   * Generation currently opened inside
   * GenerationInspectorModal.
   */
  selectedGenerationId: string | null;

  addBackgroundGeneration: (id: string) => void;

  removeBackgroundGeneration: (id: string) => void;

  openGeneration: (id: string) => void;

  closeGeneration: () => void;
};

export const useGenerationActivityStore = create<GenerationActivityState>((set) => ({
  backgroundGenerationIds: [],

  selectedGenerationId: null,

  addBackgroundGeneration: (id) => {
    set((state) => {
      /*
       * Prevent duplicate ids.
       */
      if (state.backgroundGenerationIds.includes(id)) {
        return state;
      }

      return {
        backgroundGenerationIds: [...state.backgroundGenerationIds, id],
      };
    });
  },

  removeBackgroundGeneration: (id) => {
    set((state) => ({
      backgroundGenerationIds: state.backgroundGenerationIds.filter((generationId) => generationId !== id),
    }));
  },

  openGeneration: (id) => {
    set({
      selectedGenerationId: id,
    });
  },

  closeGeneration: () => {
    set({
      selectedGenerationId: null,
    });
  },
}));
