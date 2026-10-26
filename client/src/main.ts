import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import { useAppStore } from './stores/app'
import './styles/global.css'

const app = createApp(App)

// 注册 Element Plus 全部图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

// 在挂载前初始化主题（避免首屏闪烁）
const appStore = useAppStore()
appStore.initTheme()

app.mount('#app')
