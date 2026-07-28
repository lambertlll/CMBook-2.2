'use client'
import Image from "next/image"
import React, { useEffect, useRef, useState } from "react";
import { convertImage } from '@/lib/utils'
import { getRecordImageThumbnailPath } from "@/lib/record-image-thumbnail";

const BLANK_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

type LocalImageProps = React.ComponentProps<typeof Image> & {
  onResolvedSrc?: (src: string) => void
  useThumbnail?: boolean
}

function getImageSrcString(src: LocalImageProps['src']) {
  if (typeof src === 'string') {
    return src
  }

  return 'src' in src ? src.src : src.default.src
}

export function LocalImage({
  onLoad,
  onResolvedSrc,
  useThumbnail = false,
  src,
  alt = '',
  width = 0,
  height = 0,
  loading,
  decoding,
  ...props
}: LocalImageProps) {
  const [localSrc, setLocalSrc] = useState<string>('')
  const [shouldResolve, setShouldResolve] = useState(loading === 'eager')
  const imageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (loading === 'eager') {
      setShouldResolve(true)
    }
  }, [loading])

  useEffect(() => {
    if (!onResolvedSrc) {
      return
    }

    let cancelled = false

    async function resolveOriginalSrc() {
      const sourcePath = getImageSrcString(src)
      const originalSrc = await convertImage(sourcePath)

      if (!cancelled) {
        onResolvedSrc?.(originalSrc)
      }
    }

    void resolveOriginalSrc()

    return () => {
      cancelled = true
    }
  }, [onResolvedSrc, src])

  useEffect(() => {
    if (shouldResolve) {
      return
    }

    const imageElement = imageRef.current
    if (!imageElement || typeof IntersectionObserver === 'undefined') {
      setShouldResolve(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldResolve(true)
        observer.disconnect()
      }
    }, {
      rootMargin: '320px',
    })

    observer.observe(imageElement)

    return () => {
      observer.disconnect()
    }
  }, [shouldResolve])

  useEffect(() => {
    if (!shouldResolve) {
      return
    }

    let cancelled = false

    async function resolveSrc() {
      const sourcePath = getImageSrcString(src)
      const originalSrc = await convertImage(sourcePath)
      const thumbnailPath = useThumbnail
        ? await getRecordImageThumbnailPath(sourcePath)
        : null
      const nextSrc = thumbnailPath
        ? await convertImage(thumbnailPath)
        : originalSrc

      if (cancelled) {
        return
      }

      setLocalSrc(nextSrc)
    }

    void resolveSrc()

    return () => {
      cancelled = true
    }
  }, [onResolvedSrc, shouldResolve, src, useThumbnail])

  return (
    <Image
      ref={imageRef}
      {...props}
      onLoad={localSrc ? onLoad : undefined}
      src={localSrc || BLANK_IMAGE_SRC}
      alt={alt}
      width={width}
      height={height}
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
      unoptimized
    />
  )
}
