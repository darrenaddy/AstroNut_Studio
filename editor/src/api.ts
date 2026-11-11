// Thin wrapper around the editor server's JSON API.
async function req(method: string, url: string, body?: any) {
  const res = await fetch('/api' + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url: string) => req('GET', url),
  post: (url: string, body: any = {}) => req('POST', url, body),
  put: (url: string, body: any = {}) => req('PUT', url, body),
  del: (url: string) => req('DELETE', url),
  async upload(file: File) {
    const res = await fetch('/api/media?name=' + encodeURIComponent(file.name), { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Upload failed');
    return data as { file: string; url: string };
  },
};

export const q = (o: Record<string, string>) => '?' + new URLSearchParams(o).toString();
