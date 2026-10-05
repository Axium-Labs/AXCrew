import { defineConfig } from '../../apps/desktop/node_modules/@playwright/test'

export default defineConfig({
  testDir:'.',testMatch:'distributed.browser.spec.ts',
  outputDir:'../../apps/desktop/test-results/distributed-browser',
  use:{baseURL:'http://127.0.0.1:1423',channel:'msedge',headless:true,trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --port 1423',cwd:'../../apps/desktop',url:'http://127.0.0.1:1423',reuseExistingServer:false},
  reporter:'list',
})
