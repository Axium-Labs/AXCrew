import { defineConfig } from '../../apps/desktop/node_modules/@playwright/test'

export default defineConfig({
  testDir:'../..',
  testMatch:['**/apps/desktop/e2e/tool-cards.spec.ts','**/apps/desktop/e2e/session-actions.spec.ts','**/tests/desktop/work-turns.browser.spec.ts'],
  outputDir:'../../apps/desktop/test-results/transcript-browser',
  use:{baseURL:'http://127.0.0.1:1421',channel:'msedge',headless:true,trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --port 1421',cwd:'../../apps/desktop',url:'http://127.0.0.1:1421',reuseExistingServer:false},
  reporter:'list',
  projects:[{name:'desktop',use:{deviceScaleFactor:1}},{name:'hidpi',use:{deviceScaleFactor:1.5}}],
})
