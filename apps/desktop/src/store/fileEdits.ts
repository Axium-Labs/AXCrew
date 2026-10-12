import { create } from 'zustand'

export type FileEdit = { original: string; text: string; saving: boolean; error?: string }
export const fileEditKey = (root: string | undefined, path: string) => JSON.stringify([root, path.replace(/\\/g, '/')])
export const editableText = (text: string) => text.replace(/\r\n/g, '\n')
export const savedText = (edit: FileEdit) => edit.original.includes('\r\n') && !/(?<!\r)\n/.test(edit.original)
  ? edit.text.replace(/\n/g, '\r\n') : edit.text

// Keep drafts across file tabs, panel closure and conversation navigation for this app run.
export const useFileEdits = create<{
  edits: Record<string, FileEdit>
  put: (key: string, edit: FileEdit) => void
  remove: (key: string) => void
}>((set) => ({
  edits: {},
  put: (key, edit) => set(state => ({ edits: { ...state.edits, [key]: edit } })),
  remove: key => set(state => {
    const edits = { ...state.edits }; delete edits[key]; return { edits }
  }),
}))
