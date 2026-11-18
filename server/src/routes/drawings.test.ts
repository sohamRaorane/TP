import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Drawing } from '../../../shared/protocol';
import { BACKENDS, DEFAULT_BACKEND, makeElement, scene, startTestServer, type Backend } from '../test/helpers';

type TestServer = Awaited<ReturnType<typeof startTestServer>>;

describe.each<Backend>(BACKENDS)('REST API (%s storage)', (backend) => {
  let server: TestServer;
  const api = () => request(server.app);
  const create = async (body: object = {}) => {
    const res = await api().post('/api/drawings').send(body).expect(201);
    return res.body as Drawing;
  };

  beforeEach(async () => {
    server = await startTestServer(backend);
  });
  afterEach(async () => {
    await server.cleanup();
  });

  it('reports health and storage kind', async () => {
    const res = await api().get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true, db: backend === 'postgres', storage: backend });
  });

  it('creates a drawing with an empty default scene', async () => {
    const d = await create();
    expect(d.name).toBe('Untitled drawing');
    expect(d.revision).toBe(1);
    expect(d.elementCount).toBe(0);
    expect(d.data).toEqual({ type: 'sketchboard', version: 1, elements: [], appState: {}, files: {} });
    expect(new Date(d.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('creates with data and counts only visible elements', async () => {
    const d = await create({
      name: 'Flow',
      data: scene([makeElement(), makeElement(), makeElement({ isDeleted: true })]),
    });
    expect(d.elementCount).toBe(2);
    const got = await api().get(`/api/drawings/${d.id}`).expect(200);
    expect(got.body.data.elements).toHaveLength(3);
    expect(got.body.name).toBe('Flow');
  });

  it('lists summaries newest first with search, limit and offset', async () => {
    const a = await create({ name: 'Alpha plan' });
    await create({ name: 'Beta' });
    const c = await create({ name: 'alphabet soup' });
    await api().put(`/api/drawings/${a.id}`).send({ name: 'Alpha plan v2' }).expect(200);

    const all = await api().get('/api/drawings').expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.drawings[0].id).toBe(a.id);
    expect(all.body.drawings[0]).not.toHaveProperty('data');

    const search = await api().get('/api/drawings?search=ALPHA').expect(200);
    expect(search.body.total).toBe(2);
    expect(search.body.drawings.map((d: Drawing) => d.id)).toEqual([a.id, c.id]);

    const page = await api().get('/api/drawings?limit=1&offset=1').expect(200);
    expect(page.body.total).toBe(3);
    expect(page.body.drawings).toHaveLength(1);
  });

  it('validates query, params and bodies with 400 + details', async () => {
    const q = await api().get('/api/drawings?limit=0').expect(400);
    expect(q.body.error).toMatch(/Invalid query/);
    expect(Array.isArray(q.body.details)).toBe(true);

    await api().get('/api/drawings/..%2Fetc').expect(400);

    const bad = await api()
      .post('/api/drawings')
      .send({ data: { type: 'sketchboard', version: 1, elements: [{ id: 'x', type: 'blob' }] } })
      .expect(400);
    expect(bad.body.error).toBe('Invalid body');
    expect(bad.body.details[0].path).toMatch(/^data\.elements\.0/);

    await api().post('/api/drawings').set('content-type', 'application/json').send('{oops').expect(400);
    await api().post('/api/drawings').send({ name: '' }).expect(400);
  });

  it('returns 404 for unknown drawings and routes', async () => {
    const res = await api().get('/api/drawings/does-not-exist').expect(404);
    expect(res.body).toEqual({ error: 'Drawing not found' });
    await api().put('/api/drawings/nope').send({ name: 'x' }).expect(404);
    await api().delete('/api/drawings/nope').expect(404);
    await api().get('/api/nothing-here').expect(404);
  });

  it('rejects bodies over 25mb with 413', async () => {
    const huge = 'a'.repeat(26 * 1024 * 1024);
    const res = await api().post('/api/drawings').set('content-type', 'application/json').send(`{"name":"${huge}"}`);
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Payload too large');
  });

  it('updates name, data and thumbnail and increments revision', async () => {
    const d = await create();
    const thumb = 'data:image/png;base64,AAAA';
    const res = await api()
      .put(`/api/drawings/${d.id}`)
      .send({ name: 'Renamed', data: scene([makeElement()]), thumbnail: thumb })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Renamed', thumbnail: thumb, revision: 2, elementCount: 1 });
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(d.updatedAt).getTime());
  });

  it('enforces optimistic concurrency with baseRevision (409)', async () => {
    const d = await create();
    await api().put(`/api/drawings/${d.id}`).send({ name: 'one', baseRevision: 1 }).expect(200);
    const res = await api().put(`/api/drawings/${d.id}`).send({ name: 'two', baseRevision: 1 }).expect(409);
    expect(res.body.error).toMatch(/modified/);
    expect(res.body.details).toEqual({ currentRevision: 2 });
    const ok = await api().put(`/api/drawings/${d.id}`).send({ name: 'two', baseRevision: 2 }).expect(200);
    expect(ok.body.revision).toBe(3);
  });

  it('deletes drawings', async () => {
    const d = await create();
    await api().delete(`/api/drawings/${d.id}`).expect(204);
    await api().get(`/api/drawings/${d.id}`).expect(404);
  });

  it('duplicates a drawing as "<name> (copy)"', async () => {
    const d = await create({ name: 'Plan', data: scene([makeElement()]) });
    const res = await api().post(`/api/drawings/${d.id}/duplicate`).expect(201);
    expect(res.body.id).not.toBe(d.id);
    expect(res.body.name).toBe('Plan (copy)');
    expect(res.body.data.elements).toEqual(d.data.elements);
    expect(res.body.elementCount).toBe(1);
  });

  it('snapshots versions automatically and caps them', async () => {
    const d = await create();
    const el = makeElement({ id: 'v1' });
    await api().put(`/api/drawings/${d.id}`).send({ data: scene([el]) }).expect(200);
    // second save shortly after with a small change: no new snapshot
    await api()
      .put(`/api/drawings/${d.id}`)
      .send({ data: scene([{ ...el, version: 2 }, makeElement()]) })
      .expect(200);
    let versions = (await api().get(`/api/drawings/${d.id}/versions`).expect(200)).body.versions;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ elementCount: 1, label: null });

    // a jump of > 20 elements forces a snapshot
    const many = Array.from({ length: 25 }, () => makeElement());
    await api().put(`/api/drawings/${d.id}`).send({ data: scene(many) }).expect(200);
    versions = (await api().get(`/api/drawings/${d.id}/versions`).expect(200)).body.versions;
    expect(versions).toHaveLength(2);
    expect(versions[0].elementCount).toBe(25);

    const v = await api().get(`/api/drawings/${d.id}/versions/${versions[1].id}`).expect(200);
    expect(v.body.data.elements.map((e: { id: string }) => e.id)).toEqual(['v1']);
    await api().get(`/api/drawings/${d.id}/versions/missing`).expect(404);
  });

  it('keeps at most 50 versions (oldest deleted)', async () => {
    const d = await create();
    for (let i = 0; i < 53; i++) {
      await server.repo.createVersion(d.id, { data: scene([]), elementCount: i, label: `v${i}` });
    }
    const many = Array.from({ length: 30 }, () => makeElement());
    await api().put(`/api/drawings/${d.id}`).send({ data: scene(many) }).expect(200);
    const versions = (await api().get(`/api/drawings/${d.id}/versions`).expect(200)).body.versions;
    expect(versions).toHaveLength(50);
    expect(versions[0].elementCount).toBe(30);
    expect(versions.some((v: { label: string }) => v.label === 'v0')).toBe(false);
  });

  it('restores a version, snapshotting the current state first', async () => {
    const a = makeElement({ id: 'keep' });
    const d = await create({ data: scene([a]) });
    const [original] = (await api().get(`/api/drawings/${d.id}/versions`).expect(200)).body.versions;
    const b = makeElement({ id: 'added' });
    await api()
      .put(`/api/drawings/${d.id}`)
      .send({ data: scene([{ ...a, x: 999, version: 5 }, b]) })
      .expect(200);

    const res = await api().post(`/api/drawings/${d.id}/versions/${original.id}/restore`).expect(200);
    const restored = res.body as Drawing;
    const keep = restored.data.elements.find((e) => e.id === 'keep')!;
    const added = restored.data.elements.find((e) => e.id === 'added')!;
    expect(keep.x).toBe(a.x);
    expect(keep.version).toBe(6); // above the current copy so clients accept it
    expect(added.isDeleted).toBe(true);
    expect(restored.elementCount).toBe(1);

    const versions = (await api().get(`/api/drawings/${d.id}/versions`).expect(200)).body.versions;
    const before = versions.find((v: { label: string | null }) => v.label === 'Before restore');
    expect(before).toBeTruthy();
    expect(before.elementCount).toBe(2);
  });

  it('creates share links: edit = drawing id, view = reusable opaque id', async () => {
    const d = await create();
    const edit = await api().post(`/api/drawings/${d.id}/share`).send({ mode: 'edit' }).expect(200);
    expect(edit.body.roomId).toBe(d.id);
    expect(edit.body.mode).toBe('edit');
    expect(edit.body.url).toMatch(new RegExp(`/\\?room=${d.id}$`));

    const view = await api()
      .post(`/api/drawings/${d.id}/share`)
      .set('Origin', 'http://localhost:5173')
      .send({ mode: 'view' })
      .expect(200);
    expect(view.body.mode).toBe('view');
    expect(view.body.roomId).not.toBe(d.id);
    expect(view.body.url).toBe(`http://localhost:5173/?room=${view.body.roomId}`);
    const again = await api().post(`/api/drawings/${d.id}/share`).send({ mode: 'view' }).expect(200);
    expect(again.body.roomId).toBe(view.body.roomId);

    await api().post(`/api/drawings/${d.id}/share`).send({ mode: 'admin' }).expect(400);
    await api().post('/api/drawings/missing/share').send({ mode: 'view' }).expect(404);
  });
});
