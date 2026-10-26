// @ts-expect-error @types/node@20 does not declare the Node 22 node:sqlite module.
import { DatabaseSync } from 'node:sqlite';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listModuleRuntimeConfigs,
  RuntimeConfigValidationError,
  updateModuleRuntimeConfig,
} from '../runtime-config.service';

describe('runtime-config.service', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE module_settings (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        category TEXT DEFAULT 'content-ops',
        enabled INTEGER DEFAULT 1,
        description TEXT,
        access_url TEXT,
        selected_skill TEXT DEFAULT '',
        selected_llms TEXT DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      INSERT INTO module_settings (id, label) VALUES ('content', '内容工作室');
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('persists and reloads module Skill/LLM selections', () => {
    const updated = updateModuleRuntimeConfig(
      db as unknown as Database.Database,
      'content',
      {
        selected_skill: 'xhs-content',
        selected_llms: ['ollama', 'deepseek', 'ollama'],
      },
    );

    expect(updated.selected_skill).toBe('xhs-content');
    expect(updated.selected_llms).toEqual(['ollama', 'deepseek']);

    const reloaded = listModuleRuntimeConfigs(
      db as unknown as Database.Database,
    ).find((item) => item.id === 'content');
    expect(reloaded?.selected_skill).toBe('xhs-content');
    expect(reloaded?.selected_llms).toEqual(['ollama', 'deepseek']);
  });

  it('supports clearing module selections', () => {
    const updated = updateModuleRuntimeConfig(
      db as unknown as Database.Database,
      'content',
      { selected_skill: '', selected_llms: [] },
    );
    expect(updated.selected_skill).toBe('');
    expect(updated.selected_llms).toEqual([]);
  });

  it('rejects unknown modules and invalid provider names', () => {
    expect(() => updateModuleRuntimeConfig(
      db as unknown as Database.Database,
      'missing',
      { selected_skill: 'xhs-content' },
    )).toThrow('模块不存在');
    expect(() => updateModuleRuntimeConfig(
      db as unknown as Database.Database,
      'content',
      { selected_llms: ['bad/provider'] },
    )).toThrow(RuntimeConfigValidationError);
  });
});
