import { describe, expect, it } from 'vitest'
import { toLocalAssetUrl } from '../src/utils/localAssetUrl'

describe('toLocalAssetUrl', () => {
  it('encodes Chinese and spaces in relative attachment paths', () => {
    expect(toLocalAssetUrl('测试 图片.png', 'attachments')).toBe(
      'local://attachments/%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E7%89%87.png',
    )
  })

  it('keeps legacy Windows absolute paths behind the local protocol', () => {
    expect(toLocalAssetUrl('C:\\Users\\27296\\AppData\\Roaming\\minddiary\\mistake_images\\测试 图片.png')).toBe(
      'local:///C:/Users/27296/AppData/Roaming/minddiary/mistake_images/%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E7%89%87.png',
    )
  })

  it('rejects path traversal references', () => {
    expect(toLocalAssetUrl('../secret.png', 'attachments')).toBe('')
  })
})
