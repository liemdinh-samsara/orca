import {
  mountMarkdownViewer,
  type MarkdownViewerLabels,
  type MarkdownViewerMountResult
} from './markdown-viewer-mount'

// Why: bundled as an IIFE by the guest-script plugin; main calls OrcaGuestScript.mount(labels) next.
export function mount(labels: MarkdownViewerLabels): MarkdownViewerMountResult {
  return mountMarkdownViewer(document, labels)
}
