export function getEditorContentContainerClass(options: {
  centeredContent: boolean
  isMobile: boolean
  outlineOpen?: boolean
  outlinePosition?: 'left' | 'right'
  contentInset?: boolean
}) {
  if (options.contentInset === false) {
    return ''
  }

  if (options.isMobile) {
    return ''
  }

  if (options.centeredContent) {
    return 'max-w-3xl mx-auto px-4'
  }

  return 'px-10'
}
