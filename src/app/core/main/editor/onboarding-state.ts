// 新手引导步骤（「记录」功能摘除后，原 create-record 步骤已移除）
export type OnboardingStepId = 'organize-note' | 'ai-polish'
export type OnboardingCompletionFeedbackMode = 'inline' | 'dialog'

export interface OnboardingProgress {
  dismissed: boolean
  steps: Record<OnboardingStepId, boolean>
}

const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  'organize-note',
  'ai-polish',
]

export function createDefaultOnboardingProgress(): OnboardingProgress {
  return {
    dismissed: false,
    steps: {
      'organize-note': false,
      'ai-polish': false,
    },
  }
}

export function normalizeOnboardingProgress(value: unknown): OnboardingProgress {
  const defaults = createDefaultOnboardingProgress()

  if (!value || typeof value !== 'object') {
    return defaults
  }

  const candidate = value as Partial<OnboardingProgress>
  const candidateSteps = candidate.steps && typeof candidate.steps === 'object'
    ? candidate.steps as Partial<Record<OnboardingStepId, boolean>>
    : {}

  return {
    dismissed: candidate.dismissed === true,
    steps: {
      'organize-note': candidateSteps['organize-note'] === true,
      'ai-polish': candidateSteps['ai-polish'] === true,
    },
  }
}

export function markOnboardingStepDone(
  progress: OnboardingProgress,
  step: OnboardingStepId
): OnboardingProgress {
  return {
    ...progress,
    steps: {
      ...progress.steps,
      [step]: true,
    },
  }
}

export function getActiveOnboardingStep(progress: OnboardingProgress): OnboardingStepId | null {
  return ONBOARDING_STEP_ORDER.find((step) => !progress.steps[step]) ?? null
}

export function getNextOnboardingStep(
  progress: OnboardingProgress,
  completedStep: OnboardingStepId | null
): OnboardingStepId | null {
  if (completedStep) {
    return null
  }

  return getActiveOnboardingStep(progress)
}

export function isOnboardingComplete(progress: OnboardingProgress): boolean {
  return ONBOARDING_STEP_ORDER.every((step) => progress.steps[step])
}

export function shouldShowOnboardingTasks(progress: OnboardingProgress): boolean {
  return !progress.dismissed && !isOnboardingComplete(progress)
}

export function getCompletionFeedbackMode(
  completedStep: OnboardingStepId,
  activeStep: OnboardingStepId | null
): OnboardingCompletionFeedbackMode {
  if (completedStep === 'organize-note' && activeStep === 'organize-note') {
    return 'dialog'
  }

  return 'inline'
}
