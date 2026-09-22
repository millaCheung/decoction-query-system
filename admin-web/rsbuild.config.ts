import { defineConfig } from '@rsbuild/core';
import { pluginVue } from '@rsbuild/plugin-vue';

export default defineConfig({
  plugins: [pluginVue()],
  html: { title: '安心煎药 · 管理后台' },
  server: { port: 3000, proxy: { '/api': 'http://localhost:3001' } }
});
