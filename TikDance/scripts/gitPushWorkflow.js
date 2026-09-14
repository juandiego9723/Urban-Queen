const { execSync } = require('child_process');

try {
  console.log('Adding workflow file to git...');
  execSync('git add .github/workflows/deploy.yml', { stdio: 'inherit' });
  
  console.log('Committing workflow file...');
  execSync('git commit -m "ci: add GitHub Actions workflow for Cloud Run & Firebase Hosting automated deployment"', { stdio: 'inherit' });
  
  console.log('Pushing to GitHub branch gcp...');
  execSync('git push origin gcp', { stdio: 'inherit' });
  
  console.log('Successfully pushed GitHub Actions workflow!');
} catch (error) {
  console.error('Error during git push:', error.message);
}
