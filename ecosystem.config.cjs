// PM2 process definition. Usage: pm2 start ecosystem.config.cjs
// The app reads its configuration from the `.env` file next to this file.
module.exports = {
  apps: [
    {
      name: 'tlg-to-task',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
