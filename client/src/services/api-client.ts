/**
 * 后端 API 客户端（架构文档 §3.3）
 * 统一错误格式 { code, message, detail? }；baseUrl 按端配置。
 */

/** 后端服务地址（部署后替换；小程序需加入 request 合法域名白名单） */
export const API_BASE_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL ??
  'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface UniRequestSuccess<T = unknown> {
  statusCode: number;
  data: T;
  header: Record<string, string>;
}

function uniRequest<T>(options: {
  url: string;
  method: 'GET' | 'POST';
  data?: unknown;
  responseType?: 'text' | 'arraybuffer';
  header?: Record<string, string>;
}): Promise<UniRequestSuccess<T>> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: options.url,
      method: options.method,
      data: options.data as never,
      responseType: options.responseType,
      header: { 'Content-Type': 'application/json', ...options.header },
      success: (res) => resolve(res as unknown as UniRequestSuccess<T>),
      fail: (err) => reject(new ApiError('network-error', err.errMsg || '网络请求失败', 0))
    });
  });
}

/** JSON POST */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await uniRequest<T>({ url: `${API_BASE_URL}${path}`, method: 'POST', data: body });
  return unwrap<T>(res);
}

/** GET JSON */
export async function getJson<T>(path: string): Promise<T> {
  const res = await uniRequest<T>({ url: `${API_BASE_URL}${path}`, method: 'GET' });
  return unwrap<T>(res);
}

/** multipart 上传（音频 + 表单字段） */
export function uploadMultipart<T>(path: string, options: {
  /** H5 Blob 或小程序临时文件路径 */
  file: Blob | string;
  fileFieldName?: string;
  fileName?: string;
  fields?: Record<string, string>;
}): Promise<T> {
  // #ifdef H5
  const form = new FormData();
  form.append(options.fileFieldName ?? 'audio', options.file as Blob, options.fileName ?? 'audio.wav');
  for (const [k, v] of Object.entries(options.fields ?? {})) form.append(k, v);
  return fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: form }).then(async (res) => {
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new ApiError(
        String(data.code ?? 'unknown'),
        String(data.message ?? '请求失败'),
        res.status,
        data.detail
      );
    }
    return data as T;
  });
  // #endif
  // #ifdef MP-WEIXIN
  return new Promise<T>((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE_URL}${path}`,
      filePath: options.file as string,
      name: options.fileFieldName ?? 'audio',
      formData: options.fields,
      success: (res) => {
        try {
          const data = JSON.parse(res.data) as Record<string, unknown>;
          if (res.statusCode >= 400) {
            reject(
              new ApiError(
                String(data.code ?? 'unknown'),
                String(data.message ?? '请求失败'),
                res.statusCode,
                data.detail
              )
            );
          } else {
            resolve(data as T);
          }
        } catch {
          reject(new ApiError('parse-error', '响应解析失败', res.statusCode));
        }
      },
      fail: (err) => reject(new ApiError('network-error', err.errMsg || '上传失败', 0))
    });
  });
  // #endif
}

function unwrap<T>(res: UniRequestSuccess<unknown>): T {
  const data = res.data as Record<string, unknown>;
  if (res.statusCode >= 400) {
    throw new ApiError(
      String(data?.code ?? 'unknown'),
      String(data?.message ?? '请求失败'),
      res.statusCode,
      data?.detail
    );
  }
  return res.data as T;
}
