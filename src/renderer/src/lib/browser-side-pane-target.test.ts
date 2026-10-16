import { describe, expect, it } from 'vitest'
import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import { isInRightSplit, resolveBrowserSidePaneTarget } from './browser-side-pane-target'

const leaf = (groupId: string): TabGroupLayoutNode => ({ type: 'leaf', groupId })
const split = (
  direction: 'horizontal' | 'vertical',
  first: TabGroupLayoutNode,
  second: TabGroupLayoutNode
): TabGroupLayoutNode => ({ type: 'split', direction, first, second })

const base = { sourceHasBrowser: false, sourceIsEmpty: false }

describe('isInRightSplit', () => {
  it('finds groups in the right half of a left/right split', () => {
    const layout = split('horizontal', leaf('left'), split('vertical', leaf('top'), leaf('bottom')))
    expect(isInRightSplit(layout, 'left')).toBe(false)
    expect(isInRightSplit(layout, 'top')).toBe(true)
    expect(isInRightSplit(layout, 'bottom')).toBe(true)
  })

  it('ignores top/bottom splits and single panes', () => {
    expect(isInRightSplit(split('vertical', leaf('a'), leaf('b')), 'b')).toBe(false)
    expect(isInRightSplit(leaf('a'), 'a')).toBe(false)
    expect(isInRightSplit(undefined, 'a')).toBe(false)
  })
})

describe('resolveBrowserSidePaneTarget', () => {
  it('splits a right pane off a lone terminal pane', () => {
    expect(
      resolveBrowserSidePaneTarget({ ...base, layout: leaf('terminal'), sourceGroupId: 'terminal' })
    ).toEqual({ kind: 'split-right', sourceGroupId: 'terminal' })
  })

  it('reuses the existing right pane when opened from the left pane', () => {
    const layout = split('horizontal', leaf('terminal'), leaf('browser'))
    expect(resolveBrowserSidePaneTarget({ ...base, layout, sourceGroupId: 'terminal' })).toEqual({
      kind: 'group',
      groupId: 'browser',
      isSidePane: true
    })
  })

  it('reuses the right pane when the left column is split top/bottom', () => {
    const layout = split('horizontal', split('vertical', leaf('a'), leaf('b')), leaf('browser'))
    expect(resolveBrowserSidePaneTarget({ ...base, layout, sourceGroupId: 'b' })).toMatchObject({
      groupId: 'browser'
    })
  })

  it('stays in a right pane that opened the tab', () => {
    const layout = split('horizontal', leaf('terminal'), leaf('browser'))
    expect(resolveBrowserSidePaneTarget({ ...base, layout, sourceGroupId: 'browser' })).toEqual({
      kind: 'group',
      groupId: 'browser',
      isSidePane: true
    })
  })

  it('keeps a left pane that already shows a browser', () => {
    const layout = split('horizontal', leaf('left'), leaf('right'))
    expect(
      resolveBrowserSidePaneTarget({
        ...base,
        layout,
        sourceGroupId: 'left',
        sourceHasBrowser: true
      })
    ).toEqual({ kind: 'group', groupId: 'left', isSidePane: false })
  })

  it('fills an empty lone pane instead of splitting it', () => {
    expect(
      resolveBrowserSidePaneTarget({
        ...base,
        layout: leaf('empty'),
        sourceGroupId: 'empty',
        sourceIsEmpty: true
      })
    ).toEqual({ kind: 'group', groupId: 'empty', isSidePane: false })
  })

  it.each([
    split('horizontal', leaf('empty'), leaf('right')),
    split('vertical', leaf('top'), split('horizontal', leaf('empty'), leaf('right')))
  ])('reuses an existing right pane before filling an empty left pane (%#)', (layout) => {
    expect(
      resolveBrowserSidePaneTarget({
        ...base,
        layout,
        sourceGroupId: 'empty',
        sourceIsEmpty: true
      })
    ).toEqual({ kind: 'group', groupId: 'right', isSidePane: true })
  })

  it('splits right when the layout is undefined and the source is non-empty', () => {
    expect(
      resolveBrowserSidePaneTarget({ ...base, layout: undefined, sourceGroupId: 'terminal' })
    ).toEqual({ kind: 'split-right', sourceGroupId: 'terminal' })
  })
})
