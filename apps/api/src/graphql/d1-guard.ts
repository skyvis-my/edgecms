import {
  type DocumentNode,
  type FragmentDefinitionNode,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql'

export interface D1GuardOptions {
  /** Maximum allowed query depth (default: 3) */
  maxDepth?: number
  /** Maximum allowed node complexity / field count (default: 50) */
  maxComplexity?: number
}

export interface GuardValidationResult {
  valid: boolean
  depth: number
  complexity: number
  error?: string
}

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_COMPLEXITY = 50

/**
 * Traverses a GraphQL Document AST to calculate maximum query depth
 * and field node complexity, protecting Cloudflare D1 from SQLite
 * recursion and CPU starvation.
 */
export function validateD1Guards(
  document: DocumentNode,
  options: D1GuardOptions = {}
): GuardValidationResult {
  const maxDepthAllowed = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxComplexityAllowed = options.maxComplexity ?? DEFAULT_MAX_COMPLEXITY

  // Extract fragments map
  const fragments = new Map<string, FragmentDefinitionNode>()
  const operations: OperationDefinitionNode[] = []

  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(def.name.value, def)
    } else if (def.kind === Kind.OPERATION_DEFINITION) {
      operations.push(def)
    }
  }

  let overallMaxDepth = 0
  let totalComplexity = 0

  for (const op of operations) {
    const depth = calculateDepth(op.selectionSet, 1, fragments)
    if (depth > overallMaxDepth) {
      overallMaxDepth = depth
    }

    const opComplexity = calculateComplexity(op.selectionSet, fragments)
    totalComplexity += opComplexity
  }

  if (overallMaxDepth > maxDepthAllowed) {
    return {
      valid: false,
      depth: overallMaxDepth,
      complexity: totalComplexity,
      error: `Query depth of ${overallMaxDepth} exceeds the maximum depth limit of ${maxDepthAllowed}.`,
    }
  }

  if (totalComplexity > maxComplexityAllowed) {
    return {
      valid: false,
      depth: overallMaxDepth,
      complexity: totalComplexity,
      error: `Query complexity of ${totalComplexity} exceeds the maximum complexity limit of ${maxComplexityAllowed}.`,
    }
  }

  return {
    valid: true,
    depth: overallMaxDepth,
    complexity: totalComplexity,
  }
}

function calculateDepth(
  selectionSet: SelectionSetNode,
  currentDepth: number,
  fragments: Map<string, FragmentDefinitionNode>,
  visitedFragments = new Set<string>()
): number {
  let maxDepth = currentDepth

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      // Ignore meta and introspection fields (__typename, __schema, __type, etc.)
      if (selection.name.value.startsWith('__')) {
        continue
      }

      if (selection.selectionSet) {
        const childDepth = calculateDepth(
          selection.selectionSet,
          currentDepth + 1,
          fragments,
          visitedFragments
        )
        if (childDepth > maxDepth) {
          maxDepth = childDepth
        }
      } else {
        if (currentDepth > maxDepth) {
          maxDepth = currentDepth
        }
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const fragmentDepth = calculateDepth(
        selection.selectionSet,
        currentDepth,
        fragments,
        visitedFragments
      )
      if (fragmentDepth > maxDepth) {
        maxDepth = fragmentDepth
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragName = selection.name.value
      if (!visitedFragments.has(fragName)) {
        visitedFragments.add(fragName)
        const fragment = fragments.get(fragName)
        if (fragment) {
          const fragmentDepth = calculateDepth(
            fragment.selectionSet,
            currentDepth,
            fragments,
            visitedFragments
          )
          if (fragmentDepth > maxDepth) {
            maxDepth = fragmentDepth
          }
        }
        visitedFragments.delete(fragName)
      }
    }
  }

  return maxDepth
}

function calculateComplexity(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visitedFragments = new Set<string>()
): number {
  let complexity = 0

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value.startsWith('__')) {
        continue
      }

      let multiplier = 1
      if (selection.arguments) {
        for (const arg of selection.arguments) {
          if (
            (arg.name.value === 'limit' ||
              arg.name.value === 'perPage' ||
              arg.name.value === 'first') &&
            arg.value.kind === Kind.INT
          ) {
            const val = Number.parseInt(arg.value.value, 10)
            if (val > 1) {
              // Add a proportional complexity penalty capped at 10
              multiplier = Math.min(10, val)
            }
          }
        }
      }

      complexity += 1 * multiplier

      if (selection.selectionSet) {
        complexity += calculateComplexity(selection.selectionSet, fragments, visitedFragments)
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      complexity += calculateComplexity(selection.selectionSet, fragments, visitedFragments)
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragName = selection.name.value
      if (!visitedFragments.has(fragName)) {
        visitedFragments.add(fragName)
        const fragment = fragments.get(fragName)
        if (fragment) {
          complexity += calculateComplexity(fragment.selectionSet, fragments, visitedFragments)
        }
        visitedFragments.delete(fragName)
      }
    }
  }

  return complexity
}
