const RAW_DEVELOPMENT_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

function normalizeApiUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");

  // The API listens explicitly on IPv4 loopback. On some Windows machines
  // localhost resolves to ::1 first, which makes browser fetch fail even while
  // 127.0.0.1:4000 is healthy.
  if (trimmed === "http://localhost" || trimmed.startsWith("http://localhost:")) {
    return trimmed.replace("http://localhost", "http://127.0.0.1");
  }

  return trimmed;
}

const DEVELOPMENT_API_URL = normalizeApiUrl(RAW_DEVELOPMENT_API_URL);

function getApiUrl() {
  if (typeof window !== "undefined" && window.eskanderStudio?.apiUrl) {
    return normalizeApiUrl(window.eskanderStudio.apiUrl);
  }

  return DEVELOPMENT_API_URL;
}

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

let readyApiUrl: string | null = null;
let readinessPromise: Promise<void> | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function ensureApiReady() {
  const apiUrl = getApiUrl();

  if (readyApiUrl === apiUrl) {
    return;
  }

  if (!readinessPromise) {
    readinessPromise = (async () => {
      let lastError: unknown = null;

      // Protect browser-only dev usage too. Electron now waits for /health before
      // opening, but this keeps direct Next.js browsing from racing API startup.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const response = await fetch(`${apiUrl}/health`, {
            cache: "no-store",
          });

          if (response.ok) {
            readyApiUrl = apiUrl;
            return;
          }

          lastError = new Error(`Health check returned ${response.status}.`);
        } catch (error) {
          lastError = error;
        }

        await sleep(250);
      }

      const suffix =
        lastError instanceof Error && lastError.message
          ? ` ${lastError.message}`
          : "";

      throw new Error(
        `Eskander local API is not available at ${apiUrl}.${suffix}`,
      );
    })().finally(() => {
      readinessPromise = null;
    });
  }

  return readinessPromise;
}

async function fetchApi(path: string, init?: RequestInit) {
  const apiUrl = getApiUrl();
  await ensureApiReady();

  try {
    return await fetch(`${apiUrl}${path}`, init);
  } catch (error) {
    // If the API was restarted while the renderer stayed open, allow the next
    // request to perform a fresh health wait instead of staying permanently ready.
    readyApiUrl = null;

    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach Eskander local API at ${apiUrl}.`,
      );
    }

    throw error;
  }
}

async function parseJsonResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const contentType = response.headers.get("content-type");

  if (!contentType?.includes("application/json")) {
    const text = await response.text();
    console.error("Non JSON response:", text);
    throw new Error(`Request failed (${response.status}).`);
  }

  return (await response.json()) as ApiResponse<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetchApi(path);
  const body = await parseJsonResponse<T>(response);

  if (!response.ok) {
    throw new Error(body?.message ?? `Request failed with status ${response.status}`);
  }

  return body.data;
}

export async function apiPost<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const response = await fetchApi(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await parseJsonResponse<TResponse>(response);

  if (!response.ok) {
    throw new Error(result?.message ?? "Request failed.");
  }

  return result.data;
}

export async function apiUpload<TResponse>(
  path: string,
  formData: FormData,
): Promise<TResponse> {
  const response = await fetchApi(path, {
    method: "POST",
    body: formData,
  });

  const result = await parseJsonResponse<TResponse>(response);

  if (!response.ok) {
    throw new Error(result?.message ?? "Upload failed.");
  }

  return result.data;
}

export function getAssetUrl(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  return `${getApiUrl()}/storage/${normalizedPath}`;
}

export async function apiDelete<TResponse, TBody = unknown>(
  path: string,
  body?: TBody,
): Promise<TResponse> {
  const response = await fetchApi(path, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const result = await parseJsonResponse<TResponse>(response);

  if (!response.ok) {
    throw new Error(result?.message ?? "Delete failed.");
  }

  return result.data;
}

export async function apiPut<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const response = await fetchApi(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await parseJsonResponse<TResponse>(response);

  if (!response.ok) {
    throw new Error(result?.message ?? "Request failed.");
  }

  return result.data;
}

export async function apiPatch<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const response = await fetchApi(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await parseJsonResponse<TResponse>(response);

  if (!response.ok) {
    throw new Error(result?.message ?? "Request failed.");
  }

  return result.data;
}
