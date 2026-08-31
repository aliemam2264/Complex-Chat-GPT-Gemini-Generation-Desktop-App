const DEVELOPMENT_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

function getApiUrl() {
  if (typeof window !== "undefined" && window.eskanderStudio?.apiUrl) {
    return window.eskanderStudio.apiUrl;
  }

  return DEVELOPMENT_API_URL;
}

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

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
  const response = await fetch(`${getApiUrl()}${path}`);
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
  const response = await fetch(`${getApiUrl()}${path}`, {
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
  const response = await fetch(`${getApiUrl()}${path}`, {
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
  const response = await fetch(`${getApiUrl()}${path}`, {
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

export async function apiPatch<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const response = await fetch(`${getApiUrl()}${path}`, {
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
