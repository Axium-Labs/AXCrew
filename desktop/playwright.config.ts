import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./e2e',
  use:{baseURL:'http://127.0.0.1:1421',channel:'msedge',headless:true,trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --port 1421',url:'http://127.0.0.1:1421',reuseExistingServer:false},
  reporter:'list',
  projects:[{name:'desktop',use:{deviceScaleFactor:1}},{name:'hidpi',use:{deviceScaleFactor:1.5}}],
})
