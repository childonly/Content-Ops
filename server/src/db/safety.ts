import type Database from 'better-sqlite3';

/** VACUUM INTO takes a consistent SQLite snapshot, including committed WAL pages. */
export function backupSqliteDatabase(db: Database.Database, destination: string): void {
  db.prepare('VACUUM INTO ?').run(destination);
}

/** Additive, idempotent migration. Legacy provenance is deliberately unknown. */
export function addAnalyticsProvenance(db: Database.Database): void {
  const columns = db.pragma('table_info(analytics)') as Array<{ name: string }>;
  const additions: Record<string, string> = {
    source_type: "TEXT NOT NULL DEFAULT 'unknown'",
    provider: 'TEXT', source_url: 'TEXT', source_id: 'TEXT', available_metrics: "TEXT NOT NULL DEFAULT '[]'",
  };
  for (const [column, definition] of Object.entries(additions)) {
    if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE analytics ADD COLUMN ${column} ${definition}`);
  }
}

export function createNodeJobs(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS project_node_jobs (
    id TEXT PRIMARY KEY, workflow_id INTEGER NOT NULL, node_id TEXT NOT NULL,
    kind TEXT NOT NULL, status TEXT NOT NULL, params TEXT NOT NULL,
    message TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(workflow_id,node_id) REFERENCES project_workflow_nodes(workflow_id,node_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_node_job_active ON project_node_jobs(workflow_id,node_id) WHERE status='running';`);
}

export function recoverNodeJobs(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`UPDATE project_workflow_nodes SET status='failed', error='执行进程中断，请检查已有成果后重试'
      WHERE status='running' AND EXISTS (SELECT 1 FROM project_node_jobs j WHERE j.workflow_id=project_workflow_nodes.workflow_id AND j.node_id=project_workflow_nodes.node_id AND j.status='running');
    UPDATE project_workflows SET status='failed' WHERE EXISTS (SELECT 1 FROM project_node_jobs j WHERE j.workflow_id=project_workflows.id AND j.status='running');
    UPDATE project_node_jobs SET status='interrupted', error='执行进程中断，请检查已有成果后重试', updated_at=datetime('now') WHERE status='running';`);
  })();
}

