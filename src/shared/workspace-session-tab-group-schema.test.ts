import { describe, expect, it } from 'vitest'
import { tabGroupSchema } from './workspace-session-tab-group-schema'

const group = { id: 'g1', worktreeId: 'w1', activeTabId: null, tabOrder: ['t1'] }

describe('tabGroupSchema tab strip orientation', () => {
  it('keeps a persisted orientation', () => {
    expect(tabGroupSchema.parse({ ...group, tabStripOrientation: 'vertical' })).toMatchObject({
      tabStripOrientation: 'vertical'
    })
    expect(tabGroupSchema.parse({ ...group, tabStripOrientation: 'horizontal' })).toMatchObject({
      tabStripOrientation: 'horizontal'
    })
  })

  it('drops an unknown orientation without dropping the group', () => {
    const parsed = tabGroupSchema.parse({ ...group, tabStripOrientation: 'diagonal' })
    expect(parsed.tabStripOrientation).toBeUndefined()
    expect(parsed.tabOrder).toEqual(['t1'])
  })
})
