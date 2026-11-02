import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ flow: vi.fn(), content: vi.fn(), image: vi.fn(), analytics: vi.fn(), cards: vi.fn() }));
vi.mock('../../config', () => ({ config: { dbPath: ':memory:', skillBridgeMode: 'trae' } }));
vi.mock('../../utils/logger', () => ({ createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('../business-flow.service', () => ({ getFlow: deps.flow }));
vi.mock('../content.service', () => ({ generateContent: deps.content }));
vi.mock('../image-studio.service', () => ({ generateImage: deps.image, renderAutoRedbookCards: deps.cards }));
vi.mock('../analytics.service', () => ({ trackAnalytics: deps.analytics }));
vi.mock('../trend.service', () => ({ discoverTrends: vi.fn() }));
vi.mock('../hashtag.service', () => ({ researchHashtags: vi.fn() }));
vi.mock('../video-studio.service', () => ({ getUnifiedRecord: vi.fn(), processVideoUnified: vi.fn() }));
vi.mock('../llm-service', () => ({ callLLM: vi.fn() }));
vi.mock('../publish-engine.service', () => ({ getDefaultPublishEngineName: () => 'xhs-skill', publishWithEngine: vi.fn() }));
import { closeDb, getDb, initDb } from '../../db';
import * as service from '../project-workflow.service';

function project(modules: string[], edges: Array<{ source: string; target: string }> = []) {
  const nodes = modules.map((refName, index) => ({ id: String(index), refName, label: refName, type: 'module', position: { x: index * 100, y: 0 }, config: {} }));
  const id = Number(getDb().prepare('INSERT INTO business_flows (name, nodes, edges) VALUES (?,?,?)').run('fixture', JSON.stringify(nodes), JSON.stringify(edges)).lastInsertRowid);
  deps.flow.mockReturnValue({ id, name: 'fixture', nodes, edges });
  return service.createProjectWorkflow({ flowId: id, name: 'test', initialInput: { keyword: '测试' } });
}
describe('project workflow execution contract', () => {
  beforeEach(() => { vi.clearAllMocks(); initDb(); });
  afterEach(() => closeDb());
  it('executes a real image adapter and waits for artifact selection', async () => {
    const p = project(['image-studio']); deps.image.mockResolvedValue({ uid: 'img-1', url: '/api/contents/images/1.png', status: 'completed', engine: 'internal-cogview' });
    const result = await service.executeProjectNode(p.id, '0');
    expect(deps.image).toHaveBeenCalledTimes(1);
    expect(result.nodes?.[0]).toMatchObject({ status: 'waiting_review', provider: 'internal-cogview' });
    expect(service.getProjectNodeWorkbench(p.id, '0').capabilities.blockedReason).toBeUndefined();
  });
  it('blocks analytics without a real published record', async () => {
    const p = project(['analytics']); const result = await service.executeProjectNode(p.id, '0');
    expect(result.nodes?.[0]).toMatchObject({ status: 'blocked', error: expect.stringContaining('发布') });
    expect(deps.analytics).not.toHaveBeenCalled();
  });
  it('renders the full confirmed body rather than the 180-character summary',async()=>{
    const p=project(['content','image-studio'],[{source:'0',target:'1'}]);const db=getDb();
    const body='完整正文。'.repeat(100); const candidate={id:'chosen',type:'content',value:{title:'完整标题',body}};
    db.prepare("UPDATE project_workflow_nodes SET status='completed',output_snapshot=? WHERE workflow_id=? AND node_id='0'").run(JSON.stringify({candidates:[candidate],selected:candidate}),p.id);
    db.prepare("UPDATE project_workflow_nodes SET config=? WHERE workflow_id=? AND node_id='1'").run(JSON.stringify({engine:'auto-redbook'}),p.id);
    const input=service.getProjectNodeWorkbench(p.id,'1').inputs[0];
    deps.cards.mockResolvedValue({allImages:['/api/contents/images/full.png']});
    await service.executeProjectNode(p.id,'1',{selectedInput:input});
    expect(deps.cards).toHaveBeenCalledWith(expect.objectContaining({content:body,title:'完整标题'}));
  });
  it('attaches the confirmed image to the content handed to publishing', async () => {
    const p=project(['image-studio']); const db=getDb();
    const contentId=Number(db.prepare("INSERT INTO contents(title,body,images) VALUES('t','b','[]')").run().lastInsertRowid);
    db.prepare('UPDATE project_workflows SET final_content_id=? WHERE id=?').run(contentId,p.id);
    deps.image.mockResolvedValue({uid:'img',url:'/api/contents/images/selected.png',status:'completed',engine:'internal-cogview'});
    const result=await service.executeProjectNode(p.id,'0');
    const output=result.nodes?.[0].output as {candidates:Array<{id:string}>};
    service.selectProjectNodeResult(p.id,'0',output.candidates[0].id);
    const row=db.prepare('SELECT images FROM contents WHERE id=?').get(contentId) as {images:string};
    expect(JSON.parse(row.images)).toEqual(['/api/contents/images/selected.png']);
  });
  it('creates one pending publication without calling the external publish engine', async () => {
    const p = project(['publish']); const db = getDb();
    const contentId = Number(db.prepare("INSERT INTO contents(title,body,tags,images,status) VALUES('t','b','[]','[]','approved')").run().lastInsertRowid);
    db.prepare('UPDATE project_workflows SET final_content_id=? WHERE id=?').run(contentId, p.id);
    const result = await service.executeProjectNode(p.id, '0');
    expect(result.status).toBe('ready_to_publish');
    expect(db.prepare('SELECT content_id,status FROM publications').get()).toEqual({ content_id: contentId, status: 'pending' });
    await service.executeProjectNode(p.id, '0');
    expect((db.prepare('SELECT count(*) AS n FROM publications').get() as { n: number }).n).toBe(1);
  });
  it('rejects concurrent execution of a running node', async () => {
    const p = project(['content']); let resolve!: (v: unknown) => void;
    deps.content.mockImplementation(() => new Promise(r => { resolve = r; }));
    const first = service.executeProjectNode(p.id, '0');
    await expect(service.executeProjectNode(p.id, '0')).rejects.toThrow('执行中');
    const id = Number(getDb().prepare("INSERT INTO contents(title,body) VALUES('t','b')").run().lastInsertRowid);
    resolve({ id, title: 't', body: 'b' }); await first;
    expect(deps.content).toHaveBeenCalledTimes(1);
  });
  it('does not execute a completed node again', async () => {
    const p = project(['content']); getDb().prepare("UPDATE project_workflow_nodes SET status='completed' WHERE workflow_id=?").run(p.id);
    expect((await service.executeProjectNode(p.id, '0')).nodes?.[0].status).toBe('completed'); expect(deps.content).not.toHaveBeenCalled();
  });
  it('exposes only the confirmed upstream artifact', () => {
    const p = project(['content', 'image-studio'], [{ source: '0', target: '1' }]);
    const a = { id: 'chosen', value: 'A' }, b = { id: 'discarded', value: 'B' };
    getDb().prepare("UPDATE project_workflow_nodes SET status='completed',output_snapshot=? WHERE workflow_id=? AND node_id='0'").run(JSON.stringify({ candidates: [a,b], selected: a }), p.id);
    expect(service.getProjectNodeWorkbench(p.id, '1').inputs.map(item => item.id)).toEqual(['chosen']);
  });
  it('rejects a cyclic blueprint instead of creating an unusable instance', () => {
    expect(() => project(['content','image-studio'], [{ source: '0', target: '1' }, { source: '1', target: '0' }])).toThrow('循环');
  });
});
