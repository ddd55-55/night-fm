// Auto-reconnect SSH tunnel for Night FM
// Managed by pm2: pm2 start tunnel.js

const { spawn } = require('child_process');

function startTunnel() {
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', '80:localhost:3000',
    'nokey@localhost.run'
  ]);

  ssh.stdout.on('data', data => process.stdout.write(data.toString()));
  ssh.stderr.on('data', data => process.stderr.write(data.toString()));

  ssh.on('close', code => {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] Tunnel closed (code ${code}), restarting in 3s...`);
    setTimeout(startTunnel, 3000);
  });

  ssh.on('error', err => {
    console.error('SSH error:', err.message);
  });
}

console.log('🎧 Night FM tunnel starting...');
startTunnel();
