import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const publish = vi.hoisted(() => vi.fn());
vi.mock('../../config', () => ({ config: { dbPath: ':memory:' } }));
vi.mock('../../utils/logger', () => ({ createServiceLogger: () => ({ info: vi.fn(),warn:vi.fn(),error:vi.fn() }) }));
vi.mock('../publish-engine.service', () => ({ getDefaultPublishEngineName: () => 'xhs-skill', publishWithEngine: publish }));
import { closeDb, getDb, initDb } from '../../db';
import { preparePublication, publishContent } from '../publish.service';
let contentId: number;
beforeEach(() => { publish.mockReset(); initDb(); contentId=Number(getDb().prepare("INSERT INTO contents(title,body,tags,images,status) VALUES('t','b','[]','[]','approved')").run().lastInsertRowid); });
afterEach(() => closeDb());
const success={success:true,url:'https://www.xiaohongshu.com/explore/0123456789abcdef01234567',engine:'xhs-skill'};
it('preserves the project handoff identifier after failed publication retry',async()=>{
  const pending=preparePublication(contentId);publish.mockResolvedValueOnce({success:false,error:'temporary',engine:'xhs-skill'}).mockResolvedValueOnce(success);
  expect((await publishContent({contentId})).status).toBe('failed');
  const retried=await publishContent({contentId});expect(retried.id).toBe(pending.id);expect(retried.status).toBe('published');
});
it('updates the pending handoff instead of leaving an orphan queue entry',async () => {
  const pending=preparePublication(contentId);publish.mockResolvedValue(success);
  const result=await publishContent({contentId});expect(result.id).toBe(pending.id);expect(result.status).toBe('published');
  expect((getDb().prepare('SELECT count(*) AS n FROM publications').get() as {n:number}).n).toBe(1);
});
it('does not publish an already confirmed publication again',async () => {
  publish.mockResolvedValue(success);const first=await publishContent({contentId});const second=await publishContent({contentId});
  expect(second.id).toBe(first.id);expect(publish).toHaveBeenCalledTimes(1);
});
it('rejects a second request while the publishing engine is still running',async () => {
  let resolve!: (value:typeof success)=>void;publish.mockImplementation(()=>new Promise(r=>{resolve=r}));
  const first=publishContent({contentId});await expect(publishContent({contentId})).rejects.toThrow('发布中');resolve(success);await first;
});
