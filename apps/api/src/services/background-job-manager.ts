type BackgroundJobRunner = (signal: AbortSignal) => Promise<void>;

type JobState = "queued" | "active";

type ManagedJob = {
  controller: AbortController;
  done: Promise<void>;
  resolveDone: () => void;
  run: BackgroundJobRunner;
  state: JobState;
};

function normalizeLimit(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(1, Math.floor(value));
}

export class BackgroundJobManager {
  private readonly jobs = new Map<string, ManagedJob>();
  private readonly queue: string[] = [];
  private activeCount = 0;
  private maxConcurrency = Number.POSITIVE_INFINITY;

  constructor(private readonly label: string) {}

  setMaxConcurrency(limit: number | null) {
    this.maxConcurrency = normalizeLimit(limit);

    console.log(
      `[BackgroundJob:${this.label}] concurrency set to ${
        Number.isFinite(this.maxConcurrency) ? this.maxConcurrency : "unlimited"
      }.`
    );

    this.drain();
  }

  getMaxConcurrency() {
    return Number.isFinite(this.maxConcurrency) ? this.maxConcurrency : null;
  }

  enqueue(id: string, run: BackgroundJobRunner) {
    if (this.jobs.has(id)) {
      console.warn(`[BackgroundJob:${this.label}] ${id} is already scheduled.`);
      return false;
    }

    const controller = new AbortController();
    let resolveDone!: () => void;

    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const job: ManagedJob = {
      controller,
      done,
      resolveDone,
      run,
      state: "queued",
    };

    this.jobs.set(id, job);

    if (this.activeCount < this.maxConcurrency) {
      this.start(id, job);
    } else {
      this.queue.push(id);
      console.log(`[BackgroundJob:${this.label}] ${id} is waiting for a free slot.`);
    }

    return true;
  }

  cancel(id: string) {
    const job = this.jobs.get(id);

    if (!job) {
      return false;
    }

    if (job.state === "queued") {
      job.controller.abort();
      this.removeFromQueue(id);
      this.jobs.delete(id);
      job.resolveDone();

      console.log(`[BackgroundJob:${this.label}] ${id} canceled before starting.`);
      return true;
    }

    if (!job.controller.signal.aborted) {
      job.controller.abort();
    }

    return true;
  }

  async waitForIdle(id: string, timeoutMs = 10_000) {
    const job = this.jobs.get(id);

    if (!job) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;

    await Promise.race([
      job.done,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);

    if (timeout) {
      clearTimeout(timeout);
    }
  }

  isRunning(id: string) {
    // Kept for compatibility with the existing controller. A queued job is
    // considered "running" from the controller's point of view so the same
    // GenerationRun cannot be scheduled twice.
    return this.jobs.has(id);
  }

  getActiveCount() {
    return this.activeCount;
  }

  getQueuedCount() {
    return this.queue.length;
  }

  private start(id: string, job: ManagedJob) {
    if (!this.jobs.has(id) || job.controller.signal.aborted) {
      return;
    }

    job.state = "active";
    this.activeCount += 1;

    console.log(`[BackgroundJob:${this.label}] ${id} started.`);

    void job
      .run(job.controller.signal)
      .catch((error) => {
        if (job.controller.signal.aborted) {
          console.log(`[BackgroundJob:${this.label}] ${id} canceled.`);
          return;
        }

        console.error(`[BackgroundJob:${this.label}] ${id} failed:`, error);
      })
      .finally(() => {
        const current = this.jobs.get(id);

        if (current === job) {
          this.jobs.delete(id);
          this.activeCount = Math.max(0, this.activeCount - 1);
        }

        job.resolveDone();

        console.log(`[BackgroundJob:${this.label}] ${id} finished.`);
        this.drain();
      });
  }

  private drain() {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const id = this.queue.shift();

      if (!id) {
        continue;
      }

      const job = this.jobs.get(id);

      if (!job || job.controller.signal.aborted) {
        continue;
      }

      this.start(id, job);
    }
  }

  private removeFromQueue(id: string) {
    const index = this.queue.indexOf(id);

    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }
}

export const promptJobManager = new BackgroundJobManager("chatgpt");
export const imageJobManager = new BackgroundJobManager("gemini");
