import { z } from 'zod'

export const tabGroupSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  activeTabId: z.string().nullable(),
  tabOrder: z.array(z.string()),
  recentTabIds: z.array(z.string()).optional(),
  // Why: catch keeps a group whose orientation came from a newer build instead of dropping it.
  tabStripOrientation: z.enum(['horizontal', 'vertical']).optional().catch(undefined)
})
