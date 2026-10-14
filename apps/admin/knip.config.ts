import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: ['src/components/ui/**'],
  ignoreDependencies: [
    '@jsquash/avif',
    '@jsquash/resize',
    '@jsquash/webp',
    'recharts',
  ],
}

export default config
