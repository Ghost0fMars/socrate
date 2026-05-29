import fs from 'fs';
import path from 'path';

const dirsToClean = [
  'dist',
  'electron-dist',
  'release',
  'server/__pycache__',
  'api/__pycache__'
];

console.log('Cleaning project directories...');

dirsToClean.forEach((dir) => {
  const fullPath = path.resolve(dir);
  if (fs.existsSync(fullPath)) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`Successfully removed: ${dir}`);
    } catch (err) {
      console.error(`Failed to remove ${dir}: ${err.message}`);
    }
  }
});

console.log('Clean complete!');
