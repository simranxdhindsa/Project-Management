import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "glass" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    const baseClasses = "btn"
    const variantClasses = {
      primary: "btn-primary",
      secondary: "btn-secondary",
      glass: "glass-button",
      ghost: "btn-ghost",
      danger: "btn-danger",
    }
    const sizeClasses = {
      sm: "btn-sm",
      md: "btn-md",
      lg: "btn-lg",
    }

    return (
      <button
        className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
