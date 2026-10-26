import { moduleConfigs, type ModuleConfig } from './moduleConfigs'

/** 业务模块的推荐后继。顺序即右键菜单中的推荐优先级。 */
const NEXT_MODULE_IDS: Record<string, string[]> = {
  radar: ['trends', 'hashtags', 'video-studio'],
  trends: ['hashtags', 'content'],
  hashtags: ['content'],
  'video-studio': ['content'],
  content: ['draft-review', 'publish'],
  'xhs-pipeline': ['draft-review'],
  'draft-review': ['publish'],
  publish: ['analytics'],
  analytics: ['pipeline'],
  pipeline: ['trends'],
}

export interface WorkflowRecommendation {
  module: ModuleConfig
  recommended: boolean
}

export function getNodeModuleId(node: { id: string; data?: Record<string, unknown> }): string {
  const config = node.data?.config as Partial<ModuleConfig> | undefined
  if (config?.id) return config.id
  return node.id.replace(/-\d+$/, '')
}

export function getWorkflowRecommendations(moduleId: string): WorkflowRecommendation[] {
  const recommendedIds = NEXT_MODULE_IDS[moduleId] || []
  const recommended = recommendedIds
    .map(id => moduleConfigs.find(module => module.id === id))
    .filter((module): module is ModuleConfig => Boolean(module))
    .map(module => ({ module, recommended: true }))

  const recommendedSet = new Set(recommendedIds)
  const optional = moduleConfigs
    .filter(module => module.id !== moduleId && !recommendedSet.has(module.id))
    .map(module => ({ module, recommended: false }))

  return [...recommended, ...optional]
}
