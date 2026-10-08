type RouterWithNavigate<TArgs extends unknown[], TResult> = {
  navigate: (...args: TArgs) => TResult
}

type ViewTransitionLike = {
  finished: Promise<unknown>
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike
}

const isViewTransitionDisabled = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  return (
    'viewTransition' in value && (value as { viewTransition?: unknown }).viewTransition === false
  )
}

export function enableNavigationViewTransitions<TArgs extends unknown[], TResult>(
  router: RouterWithNavigate<TArgs, TResult>,
  doc: Document = document
) {
  const documentWithViewTransition = doc as DocumentWithViewTransition

  if (!documentWithViewTransition.startViewTransition) {
    return false
  }

  const originalNavigate = router.navigate.bind(router)

  router.navigate = ((...args: TArgs) => {
    if (isViewTransitionDisabled(args[0])) {
      return originalNavigate(...args)
    }

    try {
      const transition = documentWithViewTransition.startViewTransition(() => {
        const result = originalNavigate(...args)
        if (result instanceof Promise) {
          return result.then(() => undefined)
        }
      })

      return transition.finished.then(() => undefined) as TResult
    } catch {
      return originalNavigate(...args)
    }
  }) as typeof router.navigate

  return true
}
