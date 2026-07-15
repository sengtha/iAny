// Metro config so the mobile app can bundle the shared @iany/core package,
// which lives outside the app root (../packages/core). Standard Expo-monorepo
// pattern: watch the core folder + map the module name to it.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const coreRoot = path.resolve(projectRoot, '../packages/core')

const config = getDefaultConfig(projectRoot)

// Bundle changes in the shared package during dev.
config.watchFolders = [coreRoot]
// Resolve '@iany/core' to the package; its (zero) deps + RN come from the app.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@iany/core': coreRoot,
}
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]

module.exports = config
