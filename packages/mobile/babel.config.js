module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
      [
        'module-resolver',
        {
          root: ['./src'],
          extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
          alias: {
            '@': './src',
            '@/features': './src/features',
            '@/design-system': './src/design-system',
            '@/shared': './src/shared',
            '@/navigation': './src/navigation',
          },
        },
      ],
      // Strip console.log in production builds
      ...(process.env.NODE_ENV === 'production'
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
    ],
  };
};
