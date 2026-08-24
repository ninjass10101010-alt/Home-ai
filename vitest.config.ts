import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    // Tests mock @/lib/pb entirely, but pb-auth's ensureAuth() guard still
    // requires these before the mocked authWithPassword can run. Values are
    // dummies — no real PocketBase is contacted in tests.
    env: {
      PB_ADMIN_EMAIL: 'test-admin@example.test',
      PB_ADMIN_PASS: 'test-password',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
