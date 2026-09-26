// Tests for static file serving: correct status codes, conditional requests
// and byte ranges for the video.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { devEnv, startServer } from './helpers.mjs';

describe('static files', () => {
  let server;
  before(async () => { server = await startServer(devEnv); });
  after(async () => { await server.stop(); });

  it('answers the health check', async () => {
    const response = await server.fetch('/healthz');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
  });

  it('serves the app shell at the root', async () => {
    const response = await server.fetch('/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
  });

  it('404s a missing asset instead of returning the app shell', async () => {
    // Returning HTML with a 200 hid broken references from browsers and
    // from monitoring.
    const response = await server.fetch('/does-not-exist.png');
    assert.equal(response.status, 404);
  });

  it('refuses to escape the document root', async () => {
    const response = await server.fetch('/../../../../etc/hosts.txt');
    assert.equal(response.status, 404);

    const encoded = await server.fetch('/%2e%2e%2f%2e%2e%2fetc%2fhosts.txt');
    assert.equal(encoded.status, 404);
  });

  it('revalidates with an ETag', async () => {
    const first = await server.fetch('/logo.png');
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'should send an ETag');

    const second = await server.fetch('/logo.png', { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
  });

  it('serves byte ranges so media can be scrubbed', async () => {
    // Without this the whole 86MB video was re-sent for every seek.
    const response = await server.fetch('/placeholder.mp4', { headers: { Range: 'bytes=100-199' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-length'), '100');
    assert.match(response.headers.get('content-range'), /^bytes 100-199\/\d+$/);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');

    const body = await response.arrayBuffer();
    assert.equal(body.byteLength, 100);
  });

  it('handles a suffix range and an unsatisfiable range', async () => {
    const suffix = await server.fetch('/placeholder.mp4', { headers: { Range: 'bytes=-50' } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-length'), '50');

    const tooFar = await server.fetch('/placeholder.mp4', { headers: { Range: 'bytes=99999999999-' } });
    assert.equal(tooFar.status, 416);
    assert.match(tooFar.headers.get('content-range'), /^bytes \*\/\d+$/);
  });

  it('answers HEAD with headers and no body', async () => {
    const response = await server.fetch('/logo.png', { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.ok(Number(response.headers.get('content-length')) > 0);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
});

describe('malformed requests', () => {
  let server;
  before(async () => { server = await startServer(devEnv); });
  after(async () => { await server.stop(); });

  it('survives a malformed body and an oversized body', async () => {
    const badJson = await server.fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all'
    });
    assert.equal(badJson.status, 400);

    const oversized = await server.fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9'.repeat(40000) })
    });
    assert.equal(oversized.status, 413);

    // The process must still be serving traffic.
    assert.equal((await server.fetch('/healthz')).status, 200);
  });

  it('rejects an unsupported method', async () => {
    const response = await server.fetch('/api/me', { method: 'PUT' });
    assert.equal(response.status, 405);
  });
});
