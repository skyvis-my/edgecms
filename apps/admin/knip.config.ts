import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: ['src/components/ui/**', 'src/routeTree.gen.ts'],
  ignoreDependencies: [
    '@jsquash/avif',
    '@jsquash/resize',
    '@jsquash/webp',
    'edgecms-api',
    'recharts',
  ],
}

export default config
