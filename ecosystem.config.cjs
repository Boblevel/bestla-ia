module.exports = {
  apps: [
    {
      name: 'bestla-ia-bot',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '700M',
      kill_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
