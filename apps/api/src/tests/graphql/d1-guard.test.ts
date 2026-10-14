import { describe, expect, it } from 'bun:test'
import { parse } from 'graphql'
import { validateD1Guards } from '@/graphql/d1-guard'

describe('D1 Guard (Depth and Complexity Limits)', () => {
  it('allows query with depth <= 3', () => {
    // Depth 1: posts
    // Depth 2: id, title, slug
    const query = `
      query GetPosts {
        posts {
          id
          title
          slug
        }
      }
    `
    const doc = parse(query)
    const result = validateD1Guards(doc, { maxDepth: 3 })
    expect(result.valid).toBe(true)
    expect(result.depth).toBe(2)
  })

  it('allows query with depth exactly 3', () => {
    // Depth 1: posts
    // Depth 2: author
    // Depth 3: name
    const query = `
      query GetPostsWithAuthor {
        posts {
          author {
            name
          }
        }
      }
    `
    const doc = parse(query)
    const result = validateD1Guards(doc, { maxDepth: 3 })
    expect(result.valid).toBe(true)
    expect(result.depth).toBe(3)
  })

  it('rejects query with depth 4 (> 3)', () => {
    // Depth 1: posts
    // Depth 2: author
    // Depth 3: profile
    // Depth 4: bio
    const query = `
      query DeepQuery {
        posts {
          author {
            profile {
              bio
            }
          }
        }
      }
    `
    const doc = parse(query)
    const result = validateD1Guards(doc, { maxDepth: 3 })
    expect(result.valid).toBe(false)
    expect(result.depth).toBe(4)
    expect(result.error).toContain('Query depth of 4 exceeds the maximum depth limit of 3')
  })

  it('calculates depth correctly with fragments', () => {
    const query = `
      query WithFragment {
        posts {
          ...PostFields
        }
      }

      fragment PostFields on Post {
        author {
          company {
            name
          }
        }
      }
    `
    const doc = parse(query)
    const result = validateD1Guards(doc, { maxDepth: 3 })
    expect(result.valid).toBe(false)
    expect(result.depth).toBe(4)
  })

  it('rejects queries exceeding node complexity limit', () => {
    // Generates a query with many fields
    const fields = Array.from({ length: 60 }, (_, i) => `f${i}: field`).join('\n')
    const query = `
      query BigQuery {
        posts {
          ${fields}
        }
      }
    `
    const doc = parse(query)
    const result = validateD1Guards(doc, { maxDepth: 3, maxComplexity: 50 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('complexity')
  })

  it('allows deeply nested introspection queries (__type and __schema) without depth limit violation', () => {
    const introspectionQuery = `
      query IntrospectPostType {
        __type(name: "Post") {
          name
          fields {
            name
            type {
              name
              kind
              ofType {
                name
                kind
                ofType {
                  name
                }
              }
            }
          }
        }
      }
    `
    const doc = parse(introspectionQuery)
    const result = validateD1Guards(doc, { maxDepth: 3 })
    expect(result.valid).toBe(true)
  })
})
