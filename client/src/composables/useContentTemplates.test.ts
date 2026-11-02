import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
const api=vi.hoisted(()=>({getList:vi.fn(),getCategories:vi.fn(),recordUse:vi.fn().mockResolvedValue({success:true})}))
vi.mock('@/api',()=>({templateApi:api}))
vi.mock('element-plus',()=>({ElMessage:{success:vi.fn()}}))
import { useContentTemplates } from './useContentTemplates'
beforeEach(()=>vi.clearAllMocks())
it('preserves the existing user prompt when applying a template',()=>{
  const input=ref('用户原有要求');const state=useContentTemplates(input)
  state.selectTemplate({id:1,name:'示例',titleFormula:'标题',contentStructure:'结构'} as Parameters<typeof state.selectTemplate>[0])
  expect(input.value).toContain('用户原有要求');expect(input.value).toContain('标题公式：标题');expect(api.recordUse).toHaveBeenCalledWith(1)
})
it('loads filtered templates through the shared API',async()=>{
  api.getList.mockResolvedValue({success:true,data:{data:[{id:3,name:'模板'}]}})
  const state=useContentTemplates(ref(''));state.selectedCategory.value='生活';state.templateSearchKeyword.value='关键词';await state.loadTemplates()
  expect(api.getList).toHaveBeenCalledWith({category:'生活',keyword:'关键词'});expect(state.templates.value).toHaveLength(1);expect(state.templateLoading.value).toBe(false)
})
