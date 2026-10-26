// File: engineClient.ts
// Path: src/services/pipeline/engineClient.ts
//
// Outbound calls to an external service (the CSR pipeline engine).
// Never throws on HTTP errors — callers get { ok, status, data, error }.

import axios, { AxiosError } from "axios";

export type EngineService = {
  baseUrl: string | null;
  outboundKeyEnv: string | null;
};

export type EngineReply<T = any> = {
  ok: boolean;
  status: number | null; // null = never reached the service
  data: T | null;
  error: string | null;
};

const call = async <T>(
  svc: EngineService,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 20_000,
): Promise<EngineReply<T>> => {
  if (!svc.baseUrl) return { ok: false, status: null, data: null, error: "Service has no base URL" };
  const key = svc.outboundKeyEnv ? process.env[svc.outboundKeyEnv] : undefined;
  if (!key) {
    return { ok: false, status: null, data: null, error: `Env ${svc.outboundKeyEnv ?? "(none)"} is not set` };
  }

  try {
    const res = await axios.request<T>({
      method,
      url: `${svc.baseUrl.replace(/\/+$/, "")}${path}`,
      data: body,
      timeout: timeoutMs,
      headers: { "X-Service-Key": key },
      validateStatus: () => true,
    });
    const ok = res.status >= 200 && res.status < 300;
    const err = ok ? null : (res.data as any)?.error ?? (res.data as any)?.detail ?? `HTTP ${res.status}`;
    return { ok, status: res.status, data: res.data, error: err ? String(err) : null };
  } catch (e) {
    const err = e as AxiosError;
    return { ok: false, status: null, data: null, error: err.code ?? err.message };
  }
};

export const engine = {
  dispatch: (svc: EngineService, payload: unknown) =>
    call<{ jobId: string | number; status?: string }>(svc, "POST", "/api/crm/jobs", payload),
  status: (svc: EngineService, jobId: string) =>
    call<{
      status: string;
      progress?: number | null;
      note?: string | null;
      result?: unknown;
    }>(svc, "GET", `/api/crm/jobs/${encodeURIComponent(jobId)}`),
  stop: (svc: EngineService, jobId: string) =>
    call(svc, "POST", `/api/crm/jobs/${encodeURIComponent(jobId)}/stop`, {}),
  health: (svc: EngineService) => call<Record<string, unknown>>(svc, "GET", "/api/crm/health", undefined, 8_000),
  testKey: (svc: EngineService, provider: string) =>
    call<{ ok: boolean; detail?: string }>(svc, "POST", "/api/crm/keys/test", { provider }, 90_000),
};
