import { defineConfig } from '../../apps/desktop/node_modules/@playwright/test'
export default defineConfig({
  testDir:'.',testMatch:'composer-controls.browser.spec.ts',outputDir:'../../apps/desktop/test-results/composer-browser',
  use:{baseURL:'http://127.0.0.1:1422',channel:'msedge',headless:true,trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --port 1422',cwd:'../../apps/desktop',url:'http://127.0.0.1:1422',reuseExistingServer:false},reporter:'list',
  projects:[{name:'desktop',use:{deviceScaleFactor:1}},{name:'hidpi',use:{deviceScaleFactor:1.5}}],
})
