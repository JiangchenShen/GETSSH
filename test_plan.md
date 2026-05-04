1. **Analyze existing Error Handlers in `electron/main/index.ts`:**
   - Review IPC handlers that execute file operations inside `try/catch` and return error structures.
   - Specifically, we'll write tests for the `save-profiles` and `ssh-connect` IPC endpoints which have these structures.
     - `save-profiles` unlinks `PROFILES_ENC_PATH` inside a `try/catch`.
     - `ssh-connect` reads the `privateKeyPath` inside a `try/catch`.

2. **Create Mock Setup for `index.ts` Tests:**
   - Create a new file `electron/main/__tests__/index.test.ts`.
   - Setup mocks for `electron` (`app`, `ipcMain`, `safeStorage`).
   - Setup mock for `fs.promises` to simulate errors.

3. **Write Tests for `ssh-connect` Error Path:**
   - Write a test to ensure `ssh-connect` returns an error payload if `fs.promises.readFile` throws when reading the private key.
   - The test should verify `{ success: false, error: 'Failed to read private key: ...' }` is returned.

4. **Complete Pre-Commit Steps:**
   - Ensure `npm run test` or `npx vitest` successfully runs our new test.
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

5. **Submit PR:**
   - Push branch and create a PR summarizing the added test coverage.
