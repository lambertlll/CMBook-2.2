import * as React from "react"
import { cn } from "@/lib/utils"

const Kbd = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded px-1 py-0 text-[10px] text-muted-foreground/70",
        className
      )}
      {...props}
    />
  )
})
Kbd.displayName = "Kbd"

const KbdGroup = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => {
  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  )
})
KbdGroup.displayName = "KbdGroup"

export { Kbd, KbdGroup }
