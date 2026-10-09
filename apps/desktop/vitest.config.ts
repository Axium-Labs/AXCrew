import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()], resolve:{dedupe:['react','react-dom','@testing-library/react','@testing-library/user-event','react-router-dom','@tanstack/react-query','@tauri-apps/api','@tauri-apps/plugin-dialog']}, server:{fs:{allow:['../..']}}, test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}', '../../tests/desktop/**/*.test.{ts,tsx}'] } })
