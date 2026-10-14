import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type PackageInfo = {
  name: string
  dir: string
}

export const PUBLISHABLE_PACKAGES: readonly PackageInfo[] = [
  { name: 'create-edgecms-app', dir: 'packages/create-app' },
  { name: '@edgecms/plugin-sdk', dir: 'packages/plugin-sdk' },
  { name: '@edgecms/runtime', dir: 'packages/runtime' },
  { name: '@edgecms/client', dir: 'packages/client' },
] as const

export type PublishOptions = {
  dryRun: boolean
  tag: string
  access: 'public' | 'restricted'
}

export type PackQualification = {
  name: string
  version: string
  filename: string
  fileCount: number
  unpackedSize: number
  dryRunPassed: boolean
}

export function parsePublishOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env
): PublishOptions {
  const isPublish = args.includes('--publish') || env.NPM_PUBLISH === '1'
  const isDryRun = args.includes('--dry-run') || !isPublish
  const tag =
    args.find((a) => a.startsWith('--tag='))?.slice(6) ??
    args[args.indexOf('--tag') + 1] ??
    'latest'
  const access = (args.find((a) => a.startsWith('--access='))?.slice(9) ?? 'public') as
    | 'public'
    | 'restricted'
  return { dryRun: isDryRun, tag, access }
}

export function qualifyPackage(repoRoot: string, pkg: PackageInfo): PackQualification {
  const pkgDir = join(repoRoot, pkg.dir)
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgDir,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed for ${pkg.name}:\n${result.stderr || result.stdout}`)
  }
  const jsonIndex = result.stdout.indexOf('[')
  if (jsonIndex === -1) {
    throw new Error(`Invalid npm pack output for ${pkg.name}:\n${result.stdout}`)
  }
  const [pack] = JSON.parse(result.stdout.slice(jsonIndex))
  return {
    name: pack.name ?? pkg.name,
    version: pack.version ?? '0.0.0',
    filename: pack.filename ?? `${pkg.name}.tgz`,
    fileCount: pack.files?.length ?? 0,
    unpackedSize: pack.unpackedSize ?? 0,
    dryRunPassed: true,
  }
}

export async function runPublishPackages(
  options: PublishOptions,
  repoRoot: string = process.cwd()
): Promise<{ success: boolean; qualifications: PackQualification[]; dryRun: boolean }> {
  console.log(`Starting package qualification (dryRun=${options.dryRun})...`)
  const qualifications: PackQualification[] = []

  for (const pkg of PUBLISHABLE_PACKAGES) {
    const qual = qualifyPackage(repoRoot, pkg)
    qualifications.push(qual)
    console.log(
      `✓ Qualified ${qual.name}@${qual.version} (${qual.fileCount} files, ${qual.unpackedSize} bytes)`
    )
  }

  if (options.dryRun) {
    console.log('Dry-run qualification complete. Packages are qualified for publication.')
    return { success: true, qualifications, dryRun: true }
  }

  // Publish path
  const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN
  if (!token) {
    throw new Error('Publication requires NODE_AUTH_TOKEN or NPM_TOKEN in environment')
  }

  for (const pkg of PUBLISHABLE_PACKAGES) {
    const pkgDir = join(repoRoot, pkg.dir)
    const pkgJsonPath = join(pkgDir, 'package.json')
    const originalJsonText = readFileSync(pkgJsonPath, 'utf8')
    const pkgJson = JSON.parse(originalJsonText)

    try {
      // Temporarily toggle private to false for publication
      pkgJson.private = false
      writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8')

      console.log(`Publishing ${pkg.name} to npm (tag: ${options.tag})...`)
      const pubResult = spawnSync(
        'npm',
        ['publish', '--access', options.access, '--tag', options.tag],
        {
          cwd: pkgDir,
          encoding: 'utf8',
          env: { ...process.env, NODE_AUTH_TOKEN: token },
        }
      )

      if (pubResult.status !== 0) {
        throw new Error(`Failed to publish ${pkg.name}:\n${pubResult.stderr || pubResult.stdout}`)
      }
      console.log(`✓ Published ${pkg.name} successfully`)
    } finally {
      // Always restore original package.json
      writeFileSync(pkgJsonPath, originalJsonText, 'utf8')
    }
  }

  return { success: true, qualifications, dryRun: false }
}

if (import.meta.main) {
  const options = parsePublishOptions(process.argv.slice(2))
  runPublishPackages(options)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2))
      process.exit(0)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
