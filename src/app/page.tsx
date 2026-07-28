'use client'
import { Store } from '@tauri-apps/plugin-store'
import { useRouter  } from 'next/navigation'
import { useEffect } from 'react'

export default function Home() {
  const router = useRouter()
  async function init() {
    const store = await Store.load('store.json')
    let currentPage = await store.get<string>('currentPage')

    // 将旧路径重定向到新的 /core/main
    if (currentPage === '/core/article' || currentPage === '/core/record') {
      currentPage = '/core/main'
      await store.set('currentPage', '/core/main')
      await store.save()
    }

    // 旧移动端路径重定向到桌面端首页
    if (currentPage?.includes('/mobile')) {
      router.push('/core/main')
    } else {
      router.push(currentPage || '/core/main')
    }
  }
  useEffect(() => {
    init()
  }, [])
}
