'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface SwipeBackProps {
  children: React.ReactNode
  edgeWidth?: number // 左侧边缘触发区域宽度（百分比）
  threshold?: number // 触发返回的滑动距离阈值（像素）
  enabled?: boolean
  onBack?: () => void
}

export function SwipeBack({
  children,
  edgeWidth = 15,
  threshold = 80,
  enabled = true,
  onBack,
}: SwipeBackProps) {
  const router = useRouter()
  const [canGoBack, setCanGoBack] = useState(false)

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const isDragging = useRef(false)

  // 检查是否可以返回
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCanGoBack(Boolean(onBack) || window.history.length > 1)
    }
  }, [onBack])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0]
    const screenWidth = window.innerWidth
    const touchX = touch.clientX

    // 只在左侧边缘区域响应
    if (touchX < screenWidth * (edgeWidth / 100)) {
      touchStartX.current = touch.clientX
      touchStartY.current = touch.clientY
      isDragging.current = true
    }
  }, [edgeWidth])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current || touchStartX.current === null) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - touchStartX.current
    const deltaY = Math.abs(touch.clientY - (touchStartY.current || 0))

    // 如果是向右滑动且水平位移大于垂直位移
    if (deltaX > 0 && deltaX > deltaY) {
      // 阻止默认滚动行为
      e.preventDefault()
    }
  }, [])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!isDragging.current || touchStartX.current === null) {
      isDragging.current = false
      return
    }

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - touchStartX.current
    const deltaY = Math.abs(touch.clientY - (touchStartY.current || 0))

    // 如果向右滑动超过阈值，且水平位移大于垂直位移
    if (deltaX > threshold && deltaX > deltaY) {
      if (onBack) {
        onBack()
      } else {
        router.back()
      }
    }

    touchStartX.current = null
    touchStartY.current = null
    isDragging.current = false
  }, [onBack, router, threshold])

  useEffect(() => {
    if (!enabled || !canGoBack) return

    const container = document.body

    container.addEventListener('touchstart', handleTouchStart, { passive: false })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd, { passive: false })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [canGoBack, enabled, handleTouchStart, handleTouchMove, handleTouchEnd])

  if (!canGoBack) {
    return <>{children}</>
  }

  return <>{children}</>
}
