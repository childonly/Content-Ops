import type Database from 'better-sqlite3';

export class RuntimeConfigValidationError extends Error {}

export interface ModuleRuntimeConfigInput {
  enabled?: boolean | number;
  label?: string;
  selected_skill?: string;
  selected_llms?: string[];
}

interface ModuleRuntimeConfigRow {
  id: string;
  label: string;
  category: string;
  enabled: number;
  description: string;
  access_url: string;
  selected_skill: string | null;
  selected_llms: string | null;
  updated_at: string;
}

export interface ModuleRuntimeConfig
  extends Omit<ModuleRuntimeConfigRow, 'selected_skill' | 'selected_llms'> {
  selected_skill: string;
  selected_llms: string[];
}

function parseSelectedLlms(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function toModuleRuntimeConfig(row: ModuleRuntimeConfigRow): ModuleRuntimeConfig {
  return {
    ...row,
    selected_skill: row.selected_skill || '',
    selected_llms: parseSelectedLlms(row.selected_llms),
  };
}

export function listModuleRuntimeConfigs(
  db: Database.Database,
): ModuleRuntimeConfig[] {
  const rows = db
    .prepare('SELECT * FROM module_settings ORDER BY category, id')
    .all() as ModuleRuntimeConfigRow[];
  return rows.map(toModuleRuntimeConfig);
}

export function updateModuleRuntimeConfig(
  db: Database.Database,
  rawId: string,
  input: ModuleRuntimeConfigInput,
): ModuleRuntimeConfig {
  const id = rawId.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new RuntimeConfigValidationError('模块 ID 格式无效');
  }

  const existing = db
    .prepare('SELECT * FROM module_settings WHERE id = ?')
    .get(id) as ModuleRuntimeConfigRow | undefined;
  if (!existing) {
    throw new RuntimeConfigValidationError(`模块不存在: ${id}`);
  }

  const fields: string[] = [];
  const values: Array<string | number> = [];
  if (input.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(Number(Boolean(input.enabled)));
  }
  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) throw new RuntimeConfigValidationError('模块名称不能为空');
    fields.push('label = ?');
    values.push(label);
  }
  if (input.selected_skill !== undefined) {
    const selectedSkill = input.selected_skill.trim();
    if (selectedSkill && !/^[a-zA-Z0-9._-]{1,128}$/.test(selectedSkill)) {
      throw new RuntimeConfigValidationError('Skill 名称格式无效');
    }
    fields.push('selected_skill = ?');
    values.push(selectedSkill);
  }
  if (input.selected_llms !== undefined) {
    if (!Array.isArray(input.selected_llms)) {
      throw new RuntimeConfigValidationError('selected_llms 必须为字符串数组');
    }
    const selectedLlms = [...new Set(input.selected_llms.map((item) => item.trim()))]
      .filter(Boolean);
    if (
      selectedLlms.length > 16 ||
      selectedLlms.some((provider) => !/^[a-zA-Z0-9._-]{1,64}$/.test(provider))
    ) {
      throw new RuntimeConfigValidationError('LLM provider 列表格式无效');
    }
    fields.push('selected_llms = ?');
    values.push(JSON.stringify(selectedLlms));
  }

  if (fields.length === 0) {
    throw new RuntimeConfigValidationError('无更新字段');
  }

  fields.push("updated_at = datetime('now','localtime')");
  values.push(id);
  db.prepare(`UPDATE module_settings SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = db
    .prepare('SELECT * FROM module_settings WHERE id = ?')
    .get(id) as ModuleRuntimeConfigRow;
  return toModuleRuntimeConfig(updated);
}
