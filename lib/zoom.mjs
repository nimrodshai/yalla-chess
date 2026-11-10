// Zoom through a Server-to-Server OAuth app: finds the recording of one
// lesson's meeting and reads its audio transcript.
//
// A lesson's Zoom link carries the meeting's number. A group's link is a
// recurring meeting, so the same number comes back every week; each time it
// runs is an "instance" with its own UUID and start time, and the recording
// belongs to the instance. So: list the meeting's past instances, take the
// one that started around the lesson's time, and fetch that instance's
// recording files. The transcript is there once Zoom has finished it, which
// can take a while after the lesson ends.

import { config } from './config.mjs';

const env = (name) => (process.env[name] || '').trim();

export function getZoomConfig() {
  const accountId = env('ZOOM_ACCOUNT_ID');
  const clientId = env('ZOOM_CLIENT_ID');
  const clientSecret = env('ZOOM_CLIENT_SECRET');
  // Tests point these at a stub. Never in production, where credentials
  // must only ever go to Zoom.
  const apiBase = (!config.isProduction && env('ZOOM_API_BASE')) || 'https://api.zoom.us/v2';
  const oauthBase = (!config.isProduction && env('ZOOM_OAUTH_BASE')) || 'https://zoom.us';
  return { accountId, clientId, clientSecret, apiBase, oauthBase, ready: Boolean(accountId && clientId && clientSecret) };
}

// The meeting number in a Zoom link: https://us02web.zoom.us/j/81234567890?pwd=…
// or a /w/ webinar or /s/ start link. A personal link by name (/my/dolev)
// has no number and cannot be looked up.
export function meetingIdFromLink(link) {
  const match = /\/(?:j|w|s|wc\/join)\/(\d{9,12})(?:[/?#]|$)/.exec(String(link || ''));
  return match ? match[1] : '';
}

// One token serves every call until shortly before it expires (an hour).
let cachedToken = { value: '', expiresAt: 0, key: '' };

async function accessToken(zoom) {
  const key = `${zoom.oauthBase}|${zoom.accountId}|${zoom.clientId}`;
  if (cachedToken.key === key && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch(`${zoom.oauthBase}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(zoom.accountId)}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${zoom.clientId}:${zoom.clientSecret}`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new Error(`Zoom sign-in failed (${response.status}${data?.reason ? `: ${data.reason}` : ''}).`);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000, key };
  return cachedToken.value;
}

// A GET on the Zoom API; null when Zoom says there is no such thing (yet).
async function zoomGet(zoom, path) {
  const response = await fetch(`${zoom.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken(zoom)}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Zoom ${path.split('?')[0]} failed (${response.status}${data?.message ? `: ${data.message}` : ''}).`);
  return data;
}

// A UUID that starts with "/" or contains "//" has to be encoded twice.
const encodeUuid = (uuid) => (uuid.startsWith('/') || uuid.includes('//') ? encodeURIComponent(encodeURIComponent(uuid)) : encodeURIComponent(uuid));

// How early before the lesson a meeting may have been opened and still be
// that lesson's: teachers open the room a little early.
const EARLY_START_MS = 45 * 60_000;

// The transcript of the meeting held for a lesson between startAt and endAt,
// as plain "Speaker: words" lines, or null while there is none.
export async function findLessonTranscript({ meetingId, startAt, endAt }, zoom = getZoomConfig()) {
  if (!zoom.ready || !meetingId) return null;
  const from = Date.parse(startAt) - EARLY_START_MS;
  const to = Date.parse(endAt);
  const past = await zoomGet(zoom, `/past_meetings/${encodeURIComponent(meetingId)}/instances`);
  const instances = (past?.meetings || [])
    .filter((instance) => {
      const started = Date.parse(instance.start_time);
      return started >= from && started <= to;
    })
    // The one that started closest to the lesson's time.
    .sort((a, b) => Math.abs(Date.parse(a.start_time) - Date.parse(startAt)) - Math.abs(Date.parse(b.start_time) - Date.parse(startAt)));

  for (const instance of instances) {
    const recording = await zoomGet(zoom, `/meetings/${encodeUuid(instance.uuid)}/recordings`);
    const file = (recording?.recording_files || []).find((entry) => entry.file_type === 'TRANSCRIPT' && entry.status !== 'processing' && entry.download_url);
    if (!file) continue;
    const response = await fetch(file.download_url, {
      headers: { Authorization: `Bearer ${await accessToken(zoom)}` },
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new Error(`Zoom transcript download failed (${response.status}).`);
    const text = vttToText(await response.text());
    if (text) return { meetingUuid: instance.uuid, text };
  }
  return null;
}

// A WebVTT transcript as "Speaker: words" lines, with consecutive cues by
// the same speaker joined. Zoom writes each cue as a number, a time range
// and "Name: words".
export function vttToText(vtt) {
  const lines = [];
  let last = { speaker: null, index: -1 };
  for (const block of String(vtt || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const cue = block.split('\n').filter((line) => line && line !== 'WEBVTT' && !/^\d+$/.test(line) && !line.includes('-->')).join(' ').trim();
    if (!cue) continue;
    const match = /^([^:]{1,60}):\s*(.*)$/.exec(cue);
    const speaker = match ? match[1].trim() : '';
    const words = (match ? match[2] : cue).trim();
    if (!words) continue;
    if (speaker === last.speaker && last.index >= 0) {
      lines[last.index] += ` ${words}`;
    } else {
      lines.push(speaker ? `${speaker}: ${words}` : words);
      last = { speaker, index: lines.length - 1 };
    }
  }
  return lines.join('\n');
}
