module.exports = {
  apps: [{
    name: 'universal-id-server',
    script: './server.js',
    cwd: '/home/ubuntu/universal-id-server',
    instances: 1,
    autorestart: true,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      PORT: 3210
    }
  }]
};
