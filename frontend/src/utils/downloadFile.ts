import { redirectOnSessionExpired } from '../api/client';

// Fetches a binary file (an .xlsx export) with the session cookie attached
// and triggers a browser download. The api client (api/client.ts) always
// parses JSON, so a binary download needs its own fetch call rather than
// going through it — same reasoning as the PDF/PNG report downloads on the
// backend, just triggered from here instead of a direct link. Extracted
// 2026-10-14 — previously copy-pasted identically into Employees.tsx and
// Insights.tsx.
export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    redirectOnSessionExpired(res.status);
    throw new Error('Failed to download file.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
