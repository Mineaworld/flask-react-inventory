const DEFAULT_API_BASE_URL = "/api/v1";

type ApiErrorEnvelope = {
  error: {
    code?: unknown;
    message?: unknown;
    fields?: unknown;
  };
};

type ApiSuccessEnvelope<T> = {
  data: T;
  meta?: unknown;
};

type ApiRequestOptions = {
  body?: unknown;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
};

export type PaginationMeta = {
  page: number;
  pages: number;
  per_page: number;
  total: number;
};

export type PaginatedResult<T> = {
  data: T[];
  meta: PaginationMeta;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor({ code, message, status, fields }: { code: string; message: string; status: number; fields?: Record<string, string> }) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

let csrfToken: string | null = null;

// get api base url
function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return (configured || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function endpoint(path: string): string {
  return `${apiBaseUrl()}/${path.replace(/^\//, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readFields(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function errorFromResponse(status: number, payload: unknown): ApiError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const { error } = payload as ApiErrorEnvelope;
    return new ApiError({
      code: typeof error.code === "string" ? error.code : "request_failed",
      message: typeof error.message === "string" ? error.message : "The request could not be completed.",
      status,
      fields: readFields(error.fields),
    });
  }

  return new ApiError({ code: "request_failed", message: "The request could not be completed.", status });
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json().catch(() => null);
}

async function csrf(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }

  const response = await fetch(endpoint("/auth/csrf"), { credentials: "same-origin" });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw errorFromResponse(response.status, payload);
  }
  if (!isRecord(payload) || !isRecord(payload.data) || typeof payload.data.csrf_token !== "string") {
    throw new ApiError({ code: "invalid_response", message: "The server returned an invalid CSRF response.", status: response.status });
  }
  csrfToken = payload.data.csrf_token;
  return csrfToken;
}

// do request env
async function requestEnvelope<T>(
  path: string,
  options: ApiRequestOptions = {},
  canRetryCsrf = true,
): Promise<ApiSuccessEnvelope<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  const isMutation = method !== "GET";

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (isMutation) {
    headers["X-CSRFToken"] = await csrf();
  }

  const response = await fetch(endpoint(path), {
    method,
    credentials: "same-origin",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await responsePayload(response);

  if (!response.ok) {
    const error = errorFromResponse(response.status, payload);
    if (isMutation && canRetryCsrf && error.code === "csrf_failed") {
      clearCsrfToken();
      return requestEnvelope<T>(path, options, false);
    }
    throw error;
  }
  if (!isRecord(payload) || !("data" in payload)) {
    throw new ApiError({ code: "invalid_response", message: "The server returned an invalid response.", status: response.status });
  }
  return payload as ApiSuccessEnvelope<T>;
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const payload = await requestEnvelope<T>(path, options);
  return payload.data;
}

function isPaginationMeta(value: unknown): value is PaginationMeta {
  if (!isRecord(value)) {
    return false;
  }
  return ["page", "pages", "per_page", "total"].every(
    (field) => typeof value[field] === "number" && Number.isInteger(value[field]) && value[field] >= 0,
  );
}

async function requestPage<T>(path: string): Promise<PaginatedResult<T>> {
  const payload = await requestEnvelope<T[]>(path);
  if (!Array.isArray(payload.data) || !isPaginationMeta(payload.meta)) {
    throw new ApiError({ code: "invalid_response", message: "The server returned an invalid paginated response.", status: 200 });
  }

  return { data: payload.data, meta: payload.meta };
}

// export api client
export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  getPage: <T>(path: string) => requestPage<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function clearCsrfToken(): void {
  csrfToken = null;
}
