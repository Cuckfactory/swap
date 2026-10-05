GITHUB PAGES DEPLOYMENT

1. Create/open a GitHub repository.
2. Upload ALL files from this folder to the ROOT of the repository.
   Important: package.json, index.html, src/, public/, vite.config.js and .github/ must be at repo root.
3. Commit to the main branch.
4. GitHub repo -> Settings -> Pages.
5. Under Build and deployment, set Source to: GitHub Actions.
6. Open the Actions tab. The workflow "Deploy to GitHub Pages" will install dependencies, build the Vite app, and publish ./dist automatically.
7. After it finishes, GitHub shows the live Pages URL.

Do NOT use index.html directly from the source folder as the deployed page. GitHub Actions builds the source first.
