const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Explicitly mapping physical absolute boundaries traversing the monorepo logically.
const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

/**
 * Strict Monorepo Metro Custom Configuration
 * Enforces purely logical execution isolation eradicating arbitrary 'Multiple React Instances' crashes natively.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  // CRITICAL REQUIREMENT: Instructs Metro to securely scan memory directories outside the immediate physical app folder limit!
  watchFolders: [workspaceRoot], 

  resolver: {
    // Dynamically traces structural dependencies rigidly up strictly targeting the Master Root Node Module array natively.
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // Strongly prevents Metro from incorrectly executing local generic recursive lookup algorithms safely globally.
    // This perfectly prevents the classic "Multiple copies of React" deadlock physically mapping the generic UI bindings dynamically natively.
    disableHierarchicalLookup: true,
  },
};

// Generates structural merge overriding default React Native boundaries implicitly securely.
module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
