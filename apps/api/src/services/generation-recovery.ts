import { prisma } from "@eskander/database";

const INTERRUPTED_STATUSES = [
  "PENDING",
  "PROMPTING",
  "PROMPT_READY",
  "GENERATING",
  "DOWNLOADING",
] as const;

export async function recoverInterruptedGenerations() {
  const interrupted = await prisma.generationRun.findMany({
    where: {
      status: {
        in: [...INTERRUPTED_STATUSES],
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (interrupted.length === 0) {
    return 0;
  }

  const message =
    "Generation was interrupted because Eskander Plus Studio restarted. Retry to continue.";

  const result = await prisma.generationRun.updateMany({
    where: {
      id: {
        in: interrupted.map((generation) => generation.id),
      },
      status: {
        in: [...INTERRUPTED_STATUSES],
      },
    },
    data: {
      status: "FAILED",
      progressStage: "INTERRUPTED",
      progressMessage: message,
      errorMessage: message,
    },
  });

  console.warn(
    `[GenerationRecovery] Recovered ${result.count} interrupted generation${result.count === 1 ? "" : "s"}.`,
  );

  return result.count;
}
